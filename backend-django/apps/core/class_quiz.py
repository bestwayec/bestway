"""Classroom quiz engine: teacher-created grammar / vocabulary / mixed tests shared by the website and the Telegram bot.

Not an IELTS/Multilevel mock: results are counts and percentages, never bands. One authoritative implementation:

* authoring is owner-scoped (a teacher sees and edits only their own quizzes; admins see all);
* assigning a quiz to a group the actor manages takes an IMMUTABLE snapshot (questions + keys + settings);
  editing the quiz later never changes what students saw or how they were graded;
* the server owns the clock: attempt deadline = min(assignment deadline, start + time limit);
* start / answer / finish are idempotent, safe to repeat after a lost response or a bot restart;
* answer keys are never part of a student payload before submission.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import random
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.legacy_schema.models import Group, StudentProfile, User
from common.api.exceptions import ContractAPIException

from . import groups
from .mock_scoring import variants as _text_variants
from .models import ClassQuiz, ClassQuizAcceptedAnswer, ClassQuizAnswer, ClassQuizAssignment, ClassQuizAttempt, ClassQuizQuestion

STAFF = ('teacher', 'admin', 'super_admin')
CATEGORIES = ('grammar', 'vocabulary', 'mixed')
MAX_QUESTIONS = 100
MIN_PUBLISH_QUESTIONS = 1
TF_OPTIONS = ['True', 'False']
GRADING_VERSION = 1


def fail(code: str, message: str, status: int = 400):
    raise ContractAPIException(code, message, status)


def _audit(actor, action, entity, entity_id, **kwargs):
    from .mock_authoring import audit_event
    audit_event(actor, action, entity, entity_id, **kwargs)


# ----------------------------------------------------------------------------------------------- validation

def _clean_text(value, label, *, minimum=1, maximum=2000):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum:
        fail('VALIDATION_ERROR', f'{label} must be text of {minimum}-{maximum} characters')
    return value.strip()


def validate_question(data: dict) -> dict:
    if not isinstance(data, dict):
        fail('VALIDATION_ERROR', 'question must be an object')
    qtype = data.get('type')
    if qtype not in ('mcq', 'tf', 'text'):
        fail('VALIDATION_ERROR', 'question type must be mcq, tf or text')
    prompt = _clean_text(data.get('prompt'), 'prompt')
    explanation = data.get('explanation') or ''
    if not isinstance(explanation, str) or len(explanation) > 1000:
        fail('VALIDATION_ERROR', 'explanation must be text of at most 1000 characters')
    points = data.get('points', 1)
    if type(points) is not int or not 1 <= points <= 5:
        fail('VALIDATION_ERROR', 'points must be an integer 1-5')
    value = dict(type=qtype, prompt=prompt, explanation=explanation.strip(), points=points,
                 options=[], correct_answers=[], accepted_variants=[], vocabulary_word_id=data.get('vocabularyWordId'))
    if qtype == 'text':
        answers = data.get('correctAnswers')
        if not isinstance(answers, list) or not 1 <= len(answers) <= 10:
            fail('VALIDATION_ERROR', 'text questions need 1-10 accepted answers')
        value['correct_answers'] = [_clean_text(a, 'accepted answer', maximum=200) for a in answers]
        extra = data.get('acceptedVariants') or []
        if not isinstance(extra, list) or len(extra) > 20:
            fail('VALIDATION_ERROR', 'acceptedVariants must be a list of at most 20 entries')
        value['accepted_variants'] = [_clean_text(a, 'accepted variant', maximum=200) for a in extra]
        return value
    if qtype == 'tf':
        raw = data.get('correctAnswers')
        raw = raw[0] if isinstance(raw, list) and len(raw) == 1 else raw
        if isinstance(raw, bool):
            key = 0 if raw else 1
        elif isinstance(raw, int) and raw in (0, 1):
            key = raw
        elif isinstance(raw, str) and raw.strip().lower() in ('true', 't', 'false', 'f'):
            key = 0 if raw.strip().lower() in ('true', 't') else 1
        else:
            fail('VALIDATION_ERROR', 'true/false questions need a "True" or "False" answer')
        value.update(options=list(TF_OPTIONS), correct_answers=[key])
        return value
    options = data.get('options')
    if not isinstance(options, list) or not 2 <= len(options) <= 6:
        fail('VALIDATION_ERROR', 'multiple-choice questions need 2-6 options')
    cleaned = [_clean_text(o, 'option', maximum=300) for o in options]
    if len({o.lower() for o in cleaned}) != len(cleaned):
        fail('VALIDATION_ERROR', 'options must be distinct')
    answer = data.get('correctAnswers')
    answer = answer[0] if isinstance(answer, list) and len(answer) == 1 else answer
    index = _option_index(answer, len(cleaned))
    if index is None:
        fail('VALIDATION_ERROR', 'the correct answer must be one of the options (index or letter)')
    value.update(options=cleaned, correct_answers=[index])
    return value


def _option_index(value, count):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value < count else None
    if isinstance(value, str):
        text = value.strip()
        if len(text) == 1 and text.isalpha():
            index = ord(text.upper()) - 65
            return index if 0 <= index < count else None
        if text.isdigit():
            index = int(text)
            return index if 0 <= index < count else None
    return None


def _quiz_values(data: dict, *, partial=False) -> dict:
    values = {}
    if not partial or 'title' in data:
        values['title'] = _clean_text(data.get('title'), 'title', minimum=3, maximum=200)
    if 'description' in data:
        if not isinstance(data['description'], str) or len(data['description']) > 2000:
            fail('VALIDATION_ERROR', 'description must be text of at most 2000 characters')
        values['description'] = data['description'].strip()
    if not partial or 'category' in data:
        if data.get('category', 'grammar') not in CATEGORIES:
            fail('VALIDATION_ERROR', 'category must be grammar, vocabulary or mixed')
        values['category'] = data.get('category', 'grammar')
    if 'timeLimitMinutes' in data:
        limit = data['timeLimitMinutes']
        if limit is not None and (type(limit) is not int or not 1 <= limit <= 300):
            fail('VALIDATION_ERROR', 'timeLimitMinutes must be 1-300 or null')
        values['time_limit_minutes'] = limit
    if 'maxAttempts' in data:
        attempts = data['maxAttempts']
        if type(attempts) is not int or not 1 <= attempts <= 10:
            fail('VALIDATION_ERROR', 'maxAttempts must be 1-10')
        values['max_attempts'] = attempts
    if 'shuffleQuestions' in data:
        if type(data['shuffleQuestions']) is not bool:
            fail('VALIDATION_ERROR', 'shuffleQuestions must be boolean')
        values['shuffle_questions'] = data['shuffleQuestions']
    return values


# ----------------------------------------------------------------------------------------------- authoring

def _require_staff(actor):
    if getattr(actor, 'role', None) not in STAFF:
        fail('FORBIDDEN', 'Bu amal uchun rolingiz yetarli emas', 403)


def _own_quiz(actor, quiz_id, *, lock=False) -> ClassQuiz:
    _require_staff(actor)
    rows = ClassQuiz.objects.select_for_update() if lock else ClassQuiz.objects
    quiz = rows.filter(id=quiz_id).first()
    # Another teacher's quiz is reported as not found: its existence is not disclosed.
    if quiz is None or (actor.role == 'teacher' and quiz.owner_id != actor.id):
        fail('QUIZ_NOT_FOUND', 'Test topilmadi', 404)
    return quiz


def quiz_payload(quiz: ClassQuiz, *, with_questions=False) -> dict:
    questions = list(quiz.questions.order_by('position'))
    value = dict(id=quiz.id, title=quiz.title, description=quiz.description, category=quiz.category, status=quiz.status,
                 timeLimitMinutes=quiz.time_limit_minutes, maxAttempts=quiz.max_attempts, shuffleQuestions=quiz.shuffle_questions,
                 revision=quiz.revision, questionCount=len(questions), ownerId=quiz.owner_id, updatedAt=quiz.updated_at)
    if with_questions:
        value['questions'] = [dict(id=q.id, position=q.position, type=q.type, prompt=q.prompt, options=q.options,
                                   correctAnswers=q.correct_answers, acceptedVariants=q.accepted_variants,
                                   explanation=q.explanation, points=q.points) for q in questions]
    return value


def create_quiz(actor, data: dict) -> dict:
    _require_staff(actor)
    values = _quiz_values(data)
    quiz = ClassQuiz.objects.create(owner_id=actor.id, **values)
    _audit(actor, 'class_quiz.create', 'classQuiz', quiz.id, new=dict(title=quiz.title, category=quiz.category))
    return quiz_payload(quiz, with_questions=True)


def list_quizzes(actor) -> list[dict]:
    _require_staff(actor)
    rows = ClassQuiz.objects.all() if actor.role in ('admin', 'super_admin') else ClassQuiz.objects.filter(owner_id=actor.id)
    return [quiz_payload(q) for q in rows.exclude(status='archived')]


def get_quiz(actor, quiz_id) -> dict:
    return quiz_payload(_own_quiz(actor, quiz_id), with_questions=True)


def update_quiz(actor, quiz_id, data: dict) -> dict:
    with transaction.atomic():
        quiz = _own_quiz(actor, quiz_id, lock=True)
        values = _quiz_values(data, partial=True)
        for field, value in values.items():
            setattr(quiz, field, value)
        quiz.revision += 1
        quiz.save()
    _audit(actor, 'class_quiz.update', 'classQuiz', quiz.id, new=dict(revision=quiz.revision))
    return quiz_payload(quiz, with_questions=True)


def replace_questions(actor, quiz_id, questions: list) -> dict:
    """Replace the draft question list (validated as a whole). Issued snapshots are unaffected by design."""
    if not isinstance(questions, list) or len(questions) > MAX_QUESTIONS:
        fail('VALIDATION_ERROR', f'send a list of at most {MAX_QUESTIONS} questions')
    cleaned = [validate_question(q) for q in questions]
    with transaction.atomic():
        quiz = _own_quiz(actor, quiz_id, lock=True)
        quiz.questions.all().delete()
        ClassQuizQuestion.objects.bulk_create([ClassQuizQuestion(quiz=quiz, position=i + 1, **q) for i, q in enumerate(cleaned)])
        quiz.revision += 1
        quiz.save()
    _audit(actor, 'class_quiz.questions', 'classQuiz', quiz.id, new=dict(count=len(cleaned), revision=quiz.revision))
    return quiz_payload(quiz, with_questions=True)


def parse_answer_key(text: str) -> dict[int, str]:
    """'1 B, 2 A' or one answer per line ('3: cold / cool') -> {1:'B', 2:'A', 3:'cold / cool'}."""
    import re
    out: dict[int, str] = {}
    for line in re.split(r'[\n;]+', text or ''):
        line = line.strip()
        if not line:
            continue
        if re.fullmatch(r'(?:\d{1,3}\s*[.:)\-]?\s*[A-Za-z]\s*[,\s]*)+', line):  # compact "1 A, 2 B, 3 C"
            for number, answer in re.findall(r'(\d{1,3})\s*[.:)\-]?\s*([A-Za-z])', line):
                out[int(number)] = answer
            continue
        match = re.match(r'(\d{1,3})\s*[.:)\-]?\s*(.+)$', line)
        if match:
            out[int(match.group(1))] = match.group(2).strip()
    return out


def import_questions(actor, quiz_id, text: str, answer_key: str, *, replace=True) -> dict:
    """Existing paste parser (mock_parse) + an answer key -> validated classroom questions."""
    from .mock_parse import parse_questions
    parsed = parse_questions(text or '')['questions']
    keys = parse_answer_key(answer_key or '')
    questions = []
    for row in parsed:
        answer = keys.get(row['number'])
        if answer is None:
            fail('MISSING_ANSWER', f'question {row["number"]} has no answer in the key')
        if row.get('options'):
            questions.append(dict(type='mcq', prompt=row['prompt'], options=row['options'], correctAnswers=[answer]))
        elif answer.strip().lower() in ('true', 'false', 't', 'f'):
            questions.append(dict(type='tf', prompt=row['prompt'], correctAnswers=[answer]))
        else:
            questions.append(dict(type='text', prompt=row['prompt'], correctAnswers=[a.strip() for a in answer.split('/') if a.strip()]))
    if not replace:
        existing = get_quiz(actor, quiz_id)['questions']
        questions = [dict(type=q['type'], prompt=q['prompt'], options=q['options'], correctAnswers=q['correctAnswers'],
                          acceptedVariants=q['acceptedVariants'], explanation=q['explanation'], points=q['points']) for q in existing] + questions
    return replace_questions(actor, quiz_id, questions)


def preview(actor, quiz_id) -> dict:
    """Exactly what a student would see (no keys), plus the settings, for the teacher before publishing."""
    quiz = _own_quiz(actor, quiz_id)
    snapshot = _build_snapshot(quiz)
    return dict(quiz=quiz_payload(quiz), student_view=_public_snapshot(snapshot), issues=_publish_issues(quiz))


def _publish_issues(quiz: ClassQuiz) -> list[str]:
    issues = []
    count = quiz.questions.count()
    if count < MIN_PUBLISH_QUESTIONS:
        issues.append('the quiz has no questions')
    if count > MAX_QUESTIONS:
        issues.append(f'more than {MAX_QUESTIONS} questions')
    return issues


def publish_quiz(actor, quiz_id) -> dict:
    with transaction.atomic():
        quiz = _own_quiz(actor, quiz_id, lock=True)
        issues = _publish_issues(quiz)
        if issues:
            fail('QUIZ_NOT_READY', 'Test tayyor emas: ' + '; '.join(issues), 400)
        quiz.status = 'published'
        quiz.save()
    _audit(actor, 'class_quiz.publish', 'classQuiz', quiz.id)
    return quiz_payload(quiz)


# ----------------------------------------------------------------------------------------------- snapshots / assignment

def _build_snapshot(quiz: ClassQuiz) -> dict:
    return dict(
        quizId=quiz.id, revision=quiz.revision, title=quiz.title, description=quiz.description, category=quiz.category,
        timeLimitMinutes=quiz.time_limit_minutes, maxAttempts=quiz.max_attempts, shuffleQuestions=quiz.shuffle_questions,
        questions=[dict(id=q.id, type=q.type, prompt=q.prompt, options=q.options, correctAnswers=q.correct_answers,
                        acceptedVariants=q.accepted_variants, explanation=q.explanation, points=q.points)
                   for q in quiz.questions.order_by('position')])


def _public_question(q: dict) -> dict:
    return dict(id=q['id'], type=q['type'], prompt=q['prompt'], options=q['options'], points=q['points'])


def _public_snapshot(snapshot: dict) -> dict:
    return dict(title=snapshot['title'], description=snapshot['description'], category=snapshot['category'],
                timeLimitMinutes=snapshot['timeLimitMinutes'], questionCount=len(snapshot['questions']),
                questions=[_public_question(q) for q in snapshot['questions']])


def assign_quiz(actor, quiz_id, group_ids: list, deadline, *, time_limit_minutes=None, max_attempts=None) -> list[dict]:
    """Issue the quiz to groups the actor manages. Each assignment owns an immutable snapshot."""
    if not isinstance(group_ids, list) or not 1 <= len(group_ids) <= 20 or not all(isinstance(g, str) for g in group_ids):
        fail('VALIDATION_ERROR', 'choose 1-20 groups')
    now = timezone.now()
    if deadline is None or deadline <= now + timedelta(minutes=1):
        fail('VALIDATION_ERROR', 'the deadline must be in the future')
    created = []
    with transaction.atomic():
        quiz = _own_quiz(actor, quiz_id, lock=True)
        if quiz.status != 'published':
            fail('QUIZ_NOT_PUBLISHED', 'Avval testni nashr qiling', 409)
        limit = quiz.time_limit_minutes if time_limit_minutes is None else time_limit_minutes
        attempts = quiz.max_attempts if max_attempts is None else max_attempts
        if limit is not None and (type(limit) is not int or not 1 <= limit <= 300):
            fail('VALIDATION_ERROR', 'time limit must be 1-300 minutes')
        if type(attempts) is not int or not 1 <= attempts <= 10:
            fail('VALIDATION_ERROR', 'maxAttempts must be 1-10')
        snapshot = _build_snapshot(quiz)
        if not snapshot['questions']:
            fail('QUIZ_NOT_READY', 'the quiz has no questions', 400)
        digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        for group_id in dict.fromkeys(group_ids):
            group = groups.get_group(group_id)
            groups.assert_manages_group(actor, group)  # a teacher can only assign to their own groups
            row = ClassQuizAssignment.objects.create(quiz=quiz, group_id=group.id, assigned_by_id=actor.id, snapshot=snapshot,
                                                     snapshot_hash=digest, deadline=deadline, time_limit_minutes=limit,
                                                     max_attempts=attempts)
            created.append(row)
    for row in created:
        _audit(actor, 'class_quiz.assign', 'classQuizAssignment', row.id, new=dict(group=row.group_id, deadline=str(row.deadline)))
    return [assignment_summary(row) for row in created]


def assignment_summary(row: ClassQuizAssignment) -> dict:
    return dict(id=row.id, quizId=row.quiz_id, groupId=row.group_id, title=row.snapshot['title'],
                category=row.snapshot['category'], questionCount=len(row.snapshot['questions']), deadline=row.deadline,
                timeLimitMinutes=row.time_limit_minutes, maxAttempts=row.max_attempts, status=row.status, createdAt=row.created_at)


# ----------------------------------------------------------------------------------------------- student side

def _require_student(actor):
    if getattr(actor, 'role', None) != 'student':
        fail('FORBIDDEN', "Faqat o'quvchi test topshira oladi", 403)


def _assert_member(student_id, assignment: ClassQuizAssignment):
    if not StudentProfile.objects.filter(user_id=student_id, group_id=assignment.group_id).exists():
        # Not disclosed: someone outside the group cannot learn the assignment exists.
        fail('QUIZ_NOT_FOUND', 'Test topilmadi', 404)


def _attempt_payload(attempt: ClassQuizAttempt, *, resumed=False) -> dict:
    snapshot = attempt.assignment.snapshot
    by_id = {q['id']: q for q in snapshot['questions']}
    saved = {a.question_id: a.response for a in attempt.answers.all()}
    order = attempt.question_order or [q['id'] for q in snapshot['questions']]
    questions = [_public_question(by_id[qid]) for qid in order if qid in by_id]
    next_index = next((i for i, q in enumerate(questions) if q['id'] not in saved), None)
    now = timezone.now()
    return dict(attemptId=attempt.id, assignmentId=attempt.assignment_id, status=attempt.status, resumed=resumed,
                title=snapshot['title'], category=snapshot['category'], questionCount=len(questions), questions=questions,
                savedAnswers=saved, nextIndex=next_index, startedAt=attempt.started_at, deadlineAt=attempt.deadline_at,
                serverTime=now, secondsLeft=max(0, int((attempt.deadline_at - now).total_seconds())), attemptNo=attempt.attempt_no)


def my_assignments(actor) -> list[dict]:
    _require_student(actor)
    profile = StudentProfile.objects.filter(user_id=actor.id).first()
    if profile is None or not profile.group_id:
        return []
    now = timezone.now()
    out = []
    for row in ClassQuizAssignment.objects.filter(group_id=profile.group_id, status='active').order_by('deadline'):
        attempts = list(ClassQuizAttempt.objects.filter(assignment=row, student_id=actor.id).order_by('attempt_no'))
        submitted = [a for a in attempts if a.status == 'submitted']
        active = next((a for a in attempts if a.status == 'in_progress'), None)
        if active and now >= active.deadline_at:
            finalize(active.id, auto=True)
            active = None
            submitted = [a for a in ClassQuizAttempt.objects.filter(assignment=row, student_id=actor.id, status='submitted')]
        state = 'in_progress' if active else 'submitted' if submitted and len(attempts) >= row.max_attempts else \
            'closed' if now >= row.deadline else 'available'
        best = max((a.percent for a in submitted if a.percent is not None), default=None)
        out.append(dict(assignment_summary(row), state=state, attemptsUsed=len(submitted), attemptsLeft=max(0, row.max_attempts - len(attempts)),
                        bestPercent=best, activeAttemptId=active.id if active else None))
    return out


def start_attempt(actor, assignment_id) -> dict:
    _require_student(actor)
    with transaction.atomic():
        assignment = ClassQuizAssignment.objects.select_for_update().filter(id=assignment_id).first()
        if assignment is None:
            fail('QUIZ_NOT_FOUND', 'Test topilmadi', 404)
        _assert_member(actor.id, assignment)
        now = timezone.now()
        existing = ClassQuizAttempt.objects.select_for_update().filter(assignment=assignment, student_id=actor.id, status='in_progress').first()
        if existing is not None:
            if now < existing.deadline_at:
                return _attempt_payload(existing, resumed=True)  # idempotent start / recovery after a lost connection
            _finalize_locked(existing, auto=True)
        if assignment.status != 'active' or now >= assignment.deadline:
            fail('QUIZ_CLOSED', 'Test muddati tugagan', 403)
        used = ClassQuizAttempt.objects.filter(assignment=assignment, student_id=actor.id).count()
        if used >= assignment.max_attempts:
            fail('NO_ATTEMPTS_LEFT', 'Urinishlar tugagan', 409)
        snapshot = assignment.snapshot
        order = [q['id'] for q in snapshot['questions']]
        if snapshot.get('shuffleQuestions'):
            random.SystemRandom().shuffle(order)
        limit = assignment.time_limit_minutes
        deadline_at = min(assignment.deadline, now + timedelta(minutes=limit)) if limit else assignment.deadline
        try:
            with transaction.atomic():
                attempt = ClassQuizAttempt.objects.create(assignment=assignment, student_id=actor.id, attempt_no=used + 1, question_order=order,
                                                          started_at=now, deadline_at=deadline_at, question_count=len(order))
        except IntegrityError:  # a concurrent start won the unique constraint: return that attempt
            attempt = ClassQuizAttempt.objects.get(assignment=assignment, student_id=actor.id, status='in_progress')
            return _attempt_payload(attempt, resumed=True)
        return _attempt_payload(attempt)


def _own_attempt(actor, attempt_id, *, lock=False) -> ClassQuizAttempt:
    _require_student(actor)
    rows = ClassQuizAttempt.objects.select_for_update() if lock else ClassQuizAttempt.objects
    attempt = rows.select_related('assignment').filter(id=attempt_id).first()
    if attempt is None or attempt.student_id != actor.id:  # Student A cannot probe Student B's attempt ids
        fail('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    return attempt


def get_attempt(actor, attempt_id) -> dict:
    attempt = _own_attempt(actor, attempt_id)
    if attempt.status == 'in_progress' and timezone.now() >= attempt.deadline_at:
        finalize(attempt.id, auto=True)
        attempt = _own_attempt(actor, attempt_id)
    if attempt.status == 'submitted':
        return result_payload(attempt)
    return _attempt_payload(attempt, resumed=True)


def _normalise_response(question: dict, response) -> str:
    if question['type'] == 'text':
        if not isinstance(response, str) or len(response.strip()) > 500:
            fail('VALIDATION_ERROR', 'answer must be text of at most 500 characters')
        return response.strip()
    index = _option_index(response, len(question['options']))
    if index is None:
        fail('VALIDATION_ERROR', 'choose one of the options')
    return str(index)


def save_answer(actor, attempt_id, question_id, response) -> dict:
    """Idempotent: saving the same answer twice (duplicate callback) changes nothing; the last answer wins until the deadline."""
    timed_out = False
    with transaction.atomic():
        attempt = _own_attempt(actor, attempt_id, lock=True)
        if attempt.status != 'in_progress':
            fail('ATTEMPT_FINISHED', 'Urinish yakunlangan', 409)
        now = timezone.now()
        if now >= attempt.deadline_at:
            _finalize_locked(attempt, auto=True)
            timed_out = True
        else:
            question = next((q for q in attempt.assignment.snapshot['questions'] if q['id'] == question_id), None)
            if question is None:
                fail('QUESTION_NOT_FOUND', 'Savol topilmadi', 404)
            stored = _normalise_response(question, response)
            ClassQuizAnswer.objects.update_or_create(attempt=attempt, question_id=question_id,
                                                     defaults=dict(response=stored, saved_at=now))
    if timed_out:  # raised after the commit so the automatic finalisation is kept
        fail('TIME_UP', "Vaqt tugadi, javoblaringiz saqlandi va natija hisoblandi", 409)
    answered = ClassQuizAnswer.objects.filter(attempt_id=attempt_id).count()
    return dict(attemptId=attempt_id, questionId=question_id, saved=True, answered=answered, total=attempt.question_count,
                secondsLeft=max(0, int((attempt.deadline_at - timezone.now()).total_seconds())))


# ----------------------------------------------------------------------------------------------- grading

def grade_response(question: dict, response, extra=None) -> tuple[bool, float]:
    """Deterministic, server-owned. Choice questions compare the chosen option; text answers must equal an approved
    answer or variant after punctuation/case/hyphen/article normalisation (no fuzzy matching)."""
    if response is None or str(response).strip() == '':
        return False, 0.0
    if question['type'] in ('mcq', 'tf'):
        return (str(response).strip() == str(question['correctAnswers'][0]), float(question['points']))
    approved: set[str] = set()
    for text in list(question['correctAnswers']) + list(question.get('acceptedVariants') or []) + list(extra or []):
        approved |= _text_variants(text)
    ok = bool(_text_variants(str(response)) & approved)
    return ok, float(question['points'])


def _finalize_locked(attempt: ClassQuizAttempt, *, auto: bool) -> ClassQuizAttempt:
    if attempt.status == 'submitted':
        return attempt
    now = timezone.now()
    snapshot = attempt.assignment.snapshot
    saved = {a.question_id: a for a in attempt.answers.all()}
    # answers a teacher approved after an appeal also count for attempts submitted later (e.g. a late student)
    extras: dict[str, list] = {}
    for qid, text in ClassQuizAcceptedAnswer.objects.filter(assignment_id=attempt.assignment_id).values_list('question_id', 'text'):
        extras.setdefault(qid, []).append(text)
    score = max_score = 0.0
    correct = 0
    for question in snapshot['questions']:
        max_score += question['points']
        answer = saved.get(question['id'])
        ok, points = grade_response(question, answer.response if answer else None, extra=extras.get(question['id']))
        if answer is not None:
            answer.is_correct, answer.points = ok, (points if ok else 0.0)
            answer.save(update_fields=['is_correct', 'points'])
        if ok:
            score += points
            correct += 1
    ended = min(now, attempt.deadline_at)
    attempt.status = 'submitted'
    attempt.submitted_at = ended
    attempt.auto_submitted = auto
    attempt.correct_count = correct
    attempt.question_count = len(snapshot['questions'])
    attempt.score, attempt.max_score = score, max_score
    attempt.percent = round(score / max_score * 100, 1) if max_score else 0.0
    attempt.duration_seconds = max(0, int((ended - attempt.started_at).total_seconds()))
    attempt.save()
    return attempt


def finalize(attempt_id, *, auto=False) -> ClassQuizAttempt:
    with transaction.atomic():
        attempt = ClassQuizAttempt.objects.select_for_update().select_related('assignment').get(id=attempt_id)
        return _finalize_locked(attempt, auto=auto)


def finish_attempt(actor, attempt_id) -> dict:
    """Idempotent: a repeated Finish (duplicate callback, lost response) returns the same stored result."""
    with transaction.atomic():
        attempt = _own_attempt(actor, attempt_id, lock=True)
        attempt = _finalize_locked(attempt, auto=timezone.now() >= attempt.deadline_at)
    return result_payload(attempt)


def result_payload(attempt: ClassQuizAttempt, *, detail=True) -> dict:
    snapshot = attempt.assignment.snapshot
    value = dict(attemptId=attempt.id, assignmentId=attempt.assignment_id, status=attempt.status, title=snapshot['title'],
                 category=snapshot['category'], correct=attempt.correct_count, total=attempt.question_count,
                 score=attempt.score, maxScore=attempt.max_score, percent=attempt.percent, durationSeconds=attempt.duration_seconds,
                 startedAt=attempt.started_at, submittedAt=attempt.submitted_at, autoSubmitted=attempt.auto_submitted,
                 attemptNo=attempt.attempt_no, resultVersion=attempt.result_version, isIeltsBand=False)
    if detail and attempt.status == 'submitted':
        saved = {a.question_id: a for a in attempt.answers.all()}
        appeals = {a.question_id: a.status for a in attempt.appeals.all()}
        rows = []
        for index, question in enumerate(snapshot['questions']):
            answer = saved.get(question['id'])
            if question['type'] == 'text':
                correct_display = ' / '.join(question['correctAnswers'])
                given = answer.response if answer else ''
            else:
                correct_display = question['options'][question['correctAnswers'][0]]
                given = question['options'][int(answer.response)] if answer and answer.response.isdigit() and int(answer.response) < len(question['options']) else ''
            rows.append(dict(questionId=question['id'], prompt=question['prompt'], yourAnswer=given, correctAnswer=correct_display,
                             isCorrect=bool(answer and answer.is_correct), answered=answer is not None, explanation=question['explanation'],
                             index=index, type=question['type'], appeal=appeals.get(question['id'])))
        value['review'] = rows
        value['incorrect'] = [r for r in rows if not r['isCorrect']]
    return value


def my_result(actor, attempt_id) -> dict:
    attempt = _own_attempt(actor, attempt_id)
    if attempt.status != 'submitted':
        fail('RESULT_NOT_READY', "Natija test yakunlangach ochiladi", 409)
    return result_payload(attempt)


# ----------------------------------------------------------------------------------------------- teacher / parent reads

def _assignment_for_staff(actor, assignment_id) -> ClassQuizAssignment:
    _require_staff(actor)
    row = ClassQuizAssignment.objects.filter(id=assignment_id).first()
    if row is None:
        fail('QUIZ_NOT_FOUND', 'Test topilmadi', 404)
    group = Group.objects.filter(id=row.group_id).first()
    if actor.role == 'teacher' and (group is None or group.teacher_id != actor.id):
        fail('QUIZ_NOT_FOUND', 'Test topilmadi', 404)  # Teacher B cannot see Teacher A's group results
    return row


def assignment_overview(actor, assignment_id) -> dict:
    row = _assignment_for_staff(actor, assignment_id)
    now = timezone.now()
    for attempt in ClassQuizAttempt.objects.filter(assignment=row, status='in_progress', deadline_at__lte=now):
        finalize(attempt.id, auto=True)
    roster = list(StudentProfile.objects.filter(group_id=row.group_id).values_list('user_id', flat=True))
    names = dict(User.objects.filter(id__in=roster).values_list('id', 'name'))
    attempts = list(ClassQuizAttempt.objects.filter(assignment=row, student_id__in=roster).order_by('student_id', 'attempt_no'))
    by_student: dict[str, list] = {}
    for attempt in attempts:
        by_student.setdefault(attempt.student_id, []).append(attempt)
    participants = []
    for student_id in roster:
        mine = by_student.get(student_id, [])
        submitted = [a for a in mine if a.status == 'submitted']
        best = max(submitted, key=lambda a: a.percent or 0, default=None)
        participants.append(dict(studentId=student_id, name=names.get(student_id, ''),
                                 state='submitted' if submitted else 'in_progress' if mine else 'not_started',
                                 attempts=len(mine), bestPercent=best.percent if best else None,
                                 correct=best.correct_count if best else None, submittedAt=best.submitted_at if best else None,
                                 durationSeconds=best.duration_seconds if best else None,
                                 lastAttemptId=submitted[-1].id if submitted else None))
    done = sum(p['state'] == 'submitted' for p in participants)
    return dict(assignment=assignment_summary(row), participants=participants, total=len(participants), submitted=done,
                pending=[p for p in participants if p['state'] != 'submitted'],
                completionPercent=round(done / len(participants) * 100, 1) if participants else 0.0)


def export_csv(actor, assignment_id) -> str:
    overview = assignment_overview(actor, assignment_id)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['student', 'state', 'attempts', 'best_percent', 'correct', 'total_questions', 'duration_seconds', 'submitted_at'])
    total = overview['assignment']['questionCount']
    for p in overview['participants']:
        writer.writerow([_csv_safe(p['name']), p['state'], p['attempts'], p['bestPercent'] if p['bestPercent'] is not None else '',
                         p['correct'] if p['correct'] is not None else '', total, p['durationSeconds'] if p['durationSeconds'] is not None else '',
                         p['submittedAt'].isoformat() if p['submittedAt'] else ''])
    return out.getvalue()


def _csv_safe(value: str) -> str:
    """Neutralise spreadsheet formula injection from student-controlled names."""
    return "'" + value if value[:1] in ('=', '+', '-', '@', '\t', '\r') else value


def attempt_for_staff(actor, attempt_id) -> dict:
    _require_staff(actor)
    attempt = ClassQuizAttempt.objects.select_related('assignment').filter(id=attempt_id).first()
    if attempt is None:
        fail('ATTEMPT_NOT_FOUND', 'Urinish topilmadi', 404)
    _assignment_for_staff(actor, attempt.assignment_id)
    return result_payload(attempt)


def parent_results(actor, student_id) -> list[dict]:
    """A parent sees only a summary (title, percent, date) of a linked child's submitted attempts: no keys, no answers."""
    from django.db import connection
    if getattr(actor, 'role', None) != 'parent':
        fail('FORBIDDEN', "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)
    with connection.cursor() as cursor:
        cursor.execute('SELECT 1 FROM "ParentStudent" WHERE "parentUserId"=%s AND "studentId"=%s', [actor.id, student_id])
        if cursor.fetchone() is None:
            fail('FORBIDDEN', "Bu ma'lumotni ko'rish huquqingiz yo'q", 403)
    return [dict(title=a.assignment.snapshot['title'], percent=a.percent, correct=a.correct_count, total=a.question_count, submittedAt=a.submitted_at)
            for a in ClassQuizAttempt.objects.select_related('assignment').filter(student_id=student_id, status='submitted').order_by('-submitted_at')[:50]]
