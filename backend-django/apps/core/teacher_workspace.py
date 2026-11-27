"""Teacher Workspace 2.0 — one simple read/write model over the EXISTING services.

Nothing here owns data: attendance stays in ``Attendance`` (Prisma), grammar tests in the ClassQuiz engine,
lesson / vocabulary / exam homework in ``HomeworkAssignment`` + ``HomeworkSubmission``, notifications in the durable
Telegram outbox. This module only

* aggregates them for the teacher dashboard, a group's homework list and live results;
* gives the student ONE "My homework" list over both homework sources with honest statuses;
* creates homework in one idempotent call (a double click returns the first assignment instead of a second one);
* queues reminders / "new homework" notices through the outbox (delivery stays opt-in: the worker is not started here).

Scores are never computed here: they come from the ClassQuiz grader, the vocabulary snapshot scorer, the exam attempt
(``homework_scoring.sync_from_exam``) or a teacher grade.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.legacy_schema.models import Attendance, Group, MockExam, User
from common.api.exceptions import ContractAPIException

from .classroom_roster import active_enrollments, member_profiles
from . import class_quiz as cq
from . import classrooms, groups
from .models import (ClassQuiz, ClassQuizAppeal, ClassQuizAssignment, ClassQuizAttempt, ClassroomArchive, ClassroomEnrollment,
                     HomeworkAssignment, HomeworkSubmission, Lesson, VocabularySet)

STAFF = ('teacher', 'admin', 'super_admin')
KINDS = ('quiz', 'vocabulary', 'exam', 'lesson')
WEEKDAYS = ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
DEDUPE_WINDOW = timedelta(minutes=10)
UPCOMING_DAYS = 7

# Student-facing statuses (one vocabulary for both homework sources)
NOT_STARTED, IN_PROGRESS, SUBMITTED, AWAITING_REVIEW, GRADED, OVERDUE = (
    'not_started', 'in_progress', 'submitted', 'awaiting_review', 'graded', 'overdue')


def fail(code, message, status=400):
    raise ContractAPIException(code, message, status)


def site_url(path: str) -> str:
    base = (os.environ.get('FRONTEND_URL') or 'https://bestwayec.uz').rstrip('/')
    return base + path


def _require_staff(actor):
    if getattr(actor, 'role', None) not in STAFF:
        fail('FORBIDDEN', 'Bu amal uchun rolingiz yetarli emas', 403)


def _own_groups(actor):
    rows = Group.objects.exclude(id__in=ClassroomArchive.objects.values('group_id'))
    if actor.role == 'teacher':
        rows = rows.filter(teacher_id=actor.id)
    return list(rows.order_by('name', 'id')[:100])


def _group(actor, group_id):
    group = groups.get_group(group_id)
    groups.assert_manages_group(actor, group)        # Teacher B: FORBIDDEN for Teacher A's group
    return group


def _today_slots(group, day):
    code = WEEKDAYS[day.weekday()]
    slots = [s for s in (group.schedule or []) if isinstance(s, dict) and s.get('day') == code]
    return sorted(slots, key=lambda s: str(s.get('startTime') or ''))


def homework_kind(assignment: HomeworkAssignment) -> str:
    if assignment.vocabulary_set_id:
        return 'vocabulary'
    if assignment.exam_id:
        return 'exam'
    return 'lesson'


# ================================================================================================ dashboard

def overview(actor) -> dict:
    """First screen: today's groups, today's attendance, active homework, work awaiting review, deadlines."""
    _require_staff(actor)
    now = timezone.now()
    today = timezone.localdate()
    own = _own_groups(actor)
    ids = [g.id for g in own]
    counts = dict(active_enrollments(group_id__in=ids).values('group_id').annotate(n=Count('pk')).values_list('group_id', 'n'))
    marks = {}
    for row in Attendance.objects.filter(group_id__in=ids, date=today).values('group_id', 'state').annotate(n=Count('pk')):
        marks.setdefault(row['group_id'], {})[row['state']] = row['n']
    group_rows = []
    for g in own:
        slots = _today_slots(g, today)
        m = marks.get(g.id, {})
        group_rows.append(dict(id=g.id, name=g.name, studentCount=counts.get(g.id, 0), scheduledToday=bool(slots),
                               todaySlots=[dict(startTime=s.get('startTime'), endTime=s.get('endTime')) for s in slots],
                               attendance=dict(present=m.get('present', 0), late=m.get('late', 0), absent=m.get('absent', 0),
                                               marked=sum(m.values()))))
    group_rows.sort(key=lambda r: (not r['scheduledToday'], (r['todaySlots'][0]['startTime'] or '') if r['todaySlots'] else '', r['name']))

    homework = HomeworkAssignment.objects.filter(cohort__classroom_id__in=ids)
    quizzes = ClassQuizAssignment.objects.filter(group_id__in=ids, status='active')
    names = {g.id: g.name for g in own}
    upcoming = []
    horizon = now + timedelta(days=UPCOMING_DAYS)
    for a in homework.filter(deadline__gt=now, deadline__lte=horizon).select_related('cohort').order_by('deadline')[:20]:
        upcoming.append(dict(kind=homework_kind(a), id=a.id, title=a.title, groupId=a.cohort.classroom_id,
                             groupName=names.get(a.cohort.classroom_id, ''), deadline=a.deadline))
    for a in quizzes.filter(deadline__gt=now, deadline__lte=horizon).order_by('deadline')[:20]:
        upcoming.append(dict(kind='quiz', id=a.id, title=a.snapshot['title'], groupId=a.group_id,
                             groupName=names.get(a.group_id, ''), deadline=a.deadline))
    upcoming.sort(key=lambda r: r['deadline'])
    awaiting = (HomeworkSubmission.objects.filter(assignment__cohort__classroom_id__in=ids, status='awaiting_review').count()
                + ClassQuizAppeal.objects.filter(attempt__assignment__group_id__in=ids, status='pending').count())
    return dict(
        date=today.isoformat(),
        groups=group_rows,
        todayGroups=sum(1 for r in group_rows if r['scheduledToday']),
        today=dict(present=sum(r['attendance']['present'] for r in group_rows), late=sum(r['attendance']['late'] for r in group_rows),
                   absent=sum(r['attendance']['absent'] for r in group_rows)),
        activeHomework=homework.filter(deadline__gt=now).count() + quizzes.filter(deadline__gt=now).count(),
        awaitingReview=awaiting,
        upcoming=upcoming[:8],
    )


# ================================================================================================ attendance

def attendance_day(actor, group_id, day_value=None) -> dict:
    """The one-screen attendance sheet: the FULL active roster with the stored mark of each student (or None).

    Nothing is pre-filled: an unmarked student stays unmarked until the teacher chooses. ``revision`` lets the save
    detect that somebody else changed this day after the sheet was loaded (no silent overwrite)."""
    from . import attendance as att
    group = att.manage_group(actor, group_id)
    day = _parse_day(day_value)
    profiles = list(member_profiles(group_id).select_related('user').order_by('user__name', 'user_id'))
    stored = {r.student_id: r for r in Attendance.objects.filter(group_id=group_id, date=day)}
    students = [dict(studentId=p.user_id, name=p.user.name, active=bool(p.user.is_active),
                     state=stored[p.user_id].state if p.user_id in stored else None) for p in profiles]
    counts = {s: sum(1 for r in stored.values() if r.state == s) for s in ('present', 'absent', 'late')}
    return dict(groupId=group.id, groupName=group.name, date=day.isoformat(), scheduled=bool(_today_slots(group, day)),
                slots=[dict(startTime=s.get('startTime'), endTime=s.get('endTime')) for s in _today_slots(group, day)],
                students=students, marked=len(stored), total=len(profiles), counts=counts, excusedSupported=False,
                revision=day_revision(group_id, day), archived=ClassroomArchive.objects.filter(group_id=group_id).exists())


def day_revision(group_id, day) -> str:
    import hashlib
    rows = Attendance.objects.filter(group_id=group_id, date=day).order_by('student_id').values_list('student_id', 'state', 'updated_at')
    return hashlib.sha256('|'.join(f'{s}:{st}:{u.isoformat() if u else ""}' for s, st, u in rows).encode()).hexdigest()[:16]


def _parse_day(value):
    if value in (None, ''):
        return timezone.localdate()
    try:
        day = datetime.strptime(str(value), '%Y-%m-%d').date()
    except ValueError:
        fail('VALIDATION_ERROR', "Sana YYYY-MM-DD formatida bo'lsin")
    if day > timezone.localdate() + timedelta(days=1):
        fail('ATTENDANCE_FUTURE_DATE', "Kelajakdagi kun uchun davomat olib bo'lmaydi")
    return day


def save_attendance(actor, group_id, data: dict) -> dict:
    """Save the sheet through the EXISTING bulk service (permissions, roster, blocked students, parent/student
    notices) after checking, under the group's row lock, that nobody changed the day since it was loaded."""
    from . import attendance as att
    att.manage_group(actor, group_id)
    day = _parse_day(data.get('date'))
    records = data.get('records')
    if not isinstance(records, list) or not records or len(records) > 300:
        fail('VALIDATION_ERROR', "Kamida bitta o'quvchini belgilang")
    seen = set()
    for row in records:
        if not isinstance(row, dict) or not isinstance(row.get('studentId'), str) or row.get('state') not in ('present', 'absent', 'late'):
            fail('VALIDATION_ERROR', "Har bir o'quvchi uchun: keldi, kelmadi yoki kechikdi")
        if row['studentId'] in seen:
            fail('DUPLICATE_STUDENT', "Bir o'quvchi ro'yxatda ikki marta bor")
        seen.add(row['studentId'])
    with transaction.atomic():
        groups.get_group(group_id, lock=True)                          # serialises concurrent saves of this group
        if data.get('revision') is not None and data.get('revision') != day_revision(group_id, day):
            fail('ATTENDANCE_CHANGED', "Bu kunning davomati boshqa joyda o'zgartirildi. Sahifa yangilandi — tekshirib, qayta saqlang.", 409)
        result = att.bulk(actor, dict(groupId=group_id, date=day.isoformat(), records=[dict(studentId=r['studentId'], state=r['state']) for r in records]))
    sheet = attendance_day(actor, group_id, day.isoformat())
    return dict(result, summary=sheet['counts'], marked=sheet['marked'], total=sheet['total'], revision=sheet['revision'], date=sheet['date'])


def attendance_history(actor, group_id, limit=30) -> list[dict]:
    from . import attendance as att
    att.manage_group(actor, group_id)
    rows = (Attendance.objects.filter(group_id=group_id).values('date', 'state').annotate(n=Count('pk')).order_by('-date'))
    days: dict = {}
    for row in rows:
        days.setdefault(row['date'], dict(present=0, absent=0, late=0))[row['state']] = row['n']
    return [dict(date=d.isoformat(), **c) for d, c in list(days.items())[:limit]]


# ================================================================================================ homework: creation

def _parse_deadline(value):
    parsed = parse_datetime(value) if isinstance(value, str) else None
    if parsed is None or timezone.is_naive(parsed):
        fail('VALIDATION_ERROR', "Muddatni tanlang (sana va vaqt)")
    if parsed <= timezone.now() + timedelta(minutes=5):
        fail('DEADLINE_IN_PAST', "Muddat kamida 5 daqiqadan keyin bo'lishi kerak")
    if parsed > timezone.now() + timedelta(days=366):
        fail('VALIDATION_ERROR', "Muddat bir yildan uzoq bo'lmasin")
    return parsed


def _title(value, minimum=3):
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= 200:
        fail('VALIDATION_ERROR', f"Vazifa nomi {minimum}–200 belgi bo'lsin")
    return value.strip()


def assignable_exams():
    from .teacher_views import assignable_exams as existing
    return existing()                       # published AND free/demo — a DRAFT (e.g. Mock 27) is never offered


def _validate(actor, group, data: dict) -> dict:
    """Shared by preview and assign. Returns a normalised plan; raises a clear error otherwise."""
    kind = data.get('type')
    if kind not in KINDS:
        fail('VALIDATION_ERROR', "Vazifa turini tanlang")
    deadline = _parse_deadline(data.get('deadline'))
    plan = dict(type=kind, deadline=deadline, groupId=group.id, groupName=group.name,
                studentCount=member_profiles(group.id).count())
    if kind == 'quiz':
        limit, attempts = data.get('timeLimitMinutes'), data.get('maxAttempts', 1)
        if limit is not None and (type(limit) is not int or not 1 <= limit <= 300):
            fail('VALIDATION_ERROR', "Vaqt chegarasi 1–300 daqiqa bo'lsin")
        if type(attempts) is not int or not 1 <= attempts <= 10:
            fail('VALIDATION_ERROR', "Urinishlar soni 1–10 bo'lsin")
        plan.update(timeLimitMinutes=limit, maxAttempts=attempts)
        if data.get('quizId'):
            quiz = cq._own_quiz(actor, data['quizId'])           # 404 for another teacher's quiz
            count = quiz.questions.count()
            if not count:
                fail('QUIZ_NOT_READY', "Bu testda savol yo'q")
            plan.update(quizId=quiz.id, title=quiz.title, questionCount=count, newQuiz=None)
        else:
            new = data.get('newQuiz')
            if not isinstance(new, dict):
                fail('VALIDATION_ERROR', "Testni tanlang yoki yangi test savollarini kiriting")
            from .mock_parse import parse_questions
            parsed = parse_questions(new.get('questionsText') or '')['questions']
            keys = cq.parse_answer_key(new.get('answerKey') or '')
            if not parsed:
                fail('QUIZ_NOT_READY', "Savollar topilmadi. Namuna: 1. Savol?  A) …  B) …")
            missing = [str(q['number']) for q in parsed if q['number'] not in keys]
            if missing:
                fail('MISSING_ANSWER', "Javob kaliti yo'q savollar: " + ', '.join(missing[:10]))
            if len(parsed) > cq.MAX_QUESTIONS:
                fail('VALIDATION_ERROR', f"Ko'pi bilan {cq.MAX_QUESTIONS} ta savol")
            category = new.get('category', 'grammar')
            if category not in ('grammar', 'vocabulary', 'mixed'):
                fail('VALIDATION_ERROR', "Test turi noto'g'ri")
            plan.update(quizId=None, title=_title(data.get('title')), questionCount=len(parsed),
                        newQuiz=dict(questionsText=new['questionsText'], answerKey=new['answerKey'], category=category))
        return plan
    score = data.get('minPassPercent', 60)
    if type(score) is not int or not 0 <= score <= 100:
        fail('VALIDATION_ERROR', "O'tish bali 0–100 oralig'ida bo'lsin")
    plan.update(minPassPercent=score)
    if kind == 'vocabulary':
        from .vocabulary_views import assert_manages_set
        vocab = VocabularySet.objects.select_related('group').filter(id=data.get('vocabularySetId')).first() if isinstance(data.get('vocabularySetId'), str) else None
        if vocab is None:
            fail('VOCABULARY_SET_NOT_FOUND', "Lug'at to'plamini tanlang", 404)
        assert_manages_set(actor, vocab)
        if vocab.group_id and vocab.group_id != group.id:
            fail('VALIDATION_ERROR', "Bu lug'at boshqa guruhga tegishli")
        words = vocab.words.filter(is_archived=False).count()
        if not words:
            fail('VALIDATION_ERROR', "To'plamda so'zlar yo'q")
        mode = data.get('vocabularyMode')
        if mode is not None:
            from .models import QuizMode
            from .vocabulary_views import question_type_counts
            if mode not in QuizMode.values:
                fail('VALIDATION_ERROR', "Savol turi yaroqsiz")
            if question_type_counts(vocab).get(mode, words) == 0:
                fail('VALIDATION_ERROR', "Bu to'plamdagi so'zlarda ushbu savol turi uchun ma'lumot yo'q")
        plan.update(vocabularySetId=vocab.id, title=_title(data.get('title') or vocab.title), questionCount=words,
                    vocabularyMode=mode)
    elif kind == 'exam':
        exam = assignable_exams().filter(id=data.get('examId')).first() if isinstance(data.get('examId'), str) else None
        if exam is None:
            fail('EXAM_NOT_ASSIGNABLE', "Faqat nashr qilingan va o'quvchilarga ochiq imtihonni tanlash mumkin", 404)
        plan.update(examId=exam.id, title=_title(data.get('title') or exam.title), examType=exam.type)
    else:
        lesson = None
        if data.get('lessonId'):
            lesson = Lesson.objects.filter(id=data['lessonId']).first() if isinstance(data['lessonId'], str) else None
            if lesson is None:
                fail('LESSON_NOT_FOUND', "Dars topilmadi", 404)
        plan.update(lessonId=lesson.id if lesson else None, lessonTitle=lesson.title if lesson else None, title=_title(data.get('title')))
    return plan


def _public_plan(plan: dict) -> dict:
    out = {k: v for k, v in plan.items() if k != 'newQuiz'}
    out['deadline'] = plan['deadline']
    return out


def preview_homework(actor, group_id, data: dict) -> dict:
    """What 'Assign to group' would create — validated, nothing written, no answer keys returned."""
    _require_staff(actor)
    group = _group(actor, group_id)
    return _public_plan(_validate(actor, group, data))


def assign_homework(actor, group_id, data: dict) -> dict:
    """Create the homework ONCE. A repeated click (same group, type, source, title, deadline within 10 minutes)
    returns the first assignment with ``created: false`` — serialised by the group's row lock."""
    _require_staff(actor)
    with transaction.atomic():
        group = groups.get_group(group_id, lock=True)
        groups.assert_manages_group(actor, group)
        from .classroom_roster import assert_active
        assert_active(group_id)
        plan = _validate(actor, group, data)
        since = timezone.now() - DEDUPE_WINDOW
        if plan['type'] == 'quiz':
            existing = ClassQuizAssignment.objects.filter(group_id=group.id, assigned_by_id=actor.id, deadline=plan['deadline'],
                                                          created_at__gte=since, snapshot__title=plan['title'])
            if plan['quizId']:
                existing = existing.filter(quiz_id=plan['quizId'])
            row = existing.order_by('created_at').first()
            if row is not None:
                return dict(created=False, kind='quiz', id=row.id, title=plan['title'], groupId=group.id)
            quiz_id = plan['quizId']
            if quiz_id is None:
                quiz_id = cq.create_quiz(actor, dict(title=plan['title'], category=plan['newQuiz']['category'],
                                                     timeLimitMinutes=plan['timeLimitMinutes'], maxAttempts=plan['maxAttempts']))['id']
                cq.import_questions(actor, quiz_id, plan['newQuiz']['questionsText'], plan['newQuiz']['answerKey'])
            if ClassQuiz.objects.filter(id=quiz_id).values_list('status', flat=True).first() != 'published':
                cq.publish_quiz(actor, quiz_id)
            made = cq.assign_quiz(actor, quiz_id, [group.id], plan['deadline'], time_limit_minutes=plan['timeLimitMinutes'],
                                  max_attempts=plan['maxAttempts'])[0]
            return dict(created=True, kind='quiz', id=made['id'], title=plan['title'], groupId=group.id)
        cohort = classrooms.homework_cohort(actor, group_id, create=True)
        source = dict(vocabulary_set_id=plan.get('vocabularySetId'), exam_id=plan.get('examId'), lesson_id=plan.get('lessonId'))
        row = (HomeworkAssignment.objects.filter(cohort=cohort, title=plan['title'], deadline=plan['deadline'], created_at__gte=since, **source)
               .order_by('created_at').first())
        if row is not None:
            return dict(created=False, kind=plan['type'], id=row.id, title=row.title, groupId=group.id)
        from .teacher_views import create_assignment
        vocab = VocabularySet.objects.select_for_update().get(id=plan['vocabularySetId']) if plan.get('vocabularySetId') else None
        made = create_assignment(cohort, dict(lesson_id=plan.get('lessonId'), exam_id=plan.get('examId'), deadline=plan['deadline'].isoformat(),
                                              min_pass_percent=plan['minPassPercent']), plan['title'], vocabulary_set=vocab,
                                  vocabulary_mode=plan.get('vocabularyMode'))
        assignment_id = made['id']
        return dict(created=True, kind=plan['type'], id=assignment_id, title=plan['title'], groupId=group.id)


def assign_options(actor, group_id) -> dict:
    """Everything step B needs for one group: own quizzes, vocabulary sets, published exams, lessons."""
    _require_staff(actor)
    group = _group(actor, group_id)
    quizzes = ClassQuiz.objects.annotate(n=Count('questions')).filter(n__gt=0).exclude(status='archived')
    if actor.role == 'teacher':
        quizzes = quizzes.filter(owner_id=actor.id)
    sets = VocabularySet.objects.filter(Q(group_id__isnull=True) | Q(group_id=group.id))
    if actor.role == 'teacher':
        sets = sets.filter(Q(created_by_id=actor.id) | Q(group_id=group.id))
    sets = sets.annotate(n=Count('words', filter=Q(words__is_archived=False))).filter(n__gt=0)
    return dict(
        group=dict(id=group.id, name=group.name, studentCount=member_profiles(group.id).count()),
        quizzes=[dict(id=q.id, title=q.title, category=q.category, questionCount=q.n, status=q.status, timeLimitMinutes=q.time_limit_minutes,
                      maxAttempts=q.max_attempts) for q in quizzes.order_by('-updated_at')[:50]],
        vocabularySets=[dict(id=s.id, title=s.title, wordCount=s.n) for s in sets.order_by('title', 'id')[:100]],
        exams=list(assignable_exams().order_by('title', 'id').values('id', 'title', 'type')[:100]),
        lessons=list(Lesson.objects.order_by('order_index', 'title').values('id', 'title')[:200]),
    )


# ================================================================================================ homework: results

def _roster(group_id):
    return dict(member_profiles(group_id).select_related('user').values_list('user_id', 'user__name'))


def _former(group_id, student_ids):
    """Students who left the group but have work for it: shown (marked as removed), never deleted."""
    ids = [s for s in student_ids if s]
    return dict(User.objects.filter(id__in=ids).values_list('id', 'name')) if ids else {}


def _hw_for_staff(actor, assignment_id) -> HomeworkAssignment:
    _require_staff(actor)
    row = HomeworkAssignment.objects.select_related('cohort', 'exam', 'lesson', 'vocabulary_set').filter(id=assignment_id).first()
    if row is None or (actor.role == 'teacher' and classrooms.teacher_id(row.cohort) != actor.id):
        fail('NOT_FOUND', 'Vazifa topilmadi', 404)       # no existence leak across teachers
    return row


def _hw_status(sub, deadline, now):
    if sub is None:
        return OVERDUE if deadline < now else NOT_STARTED
    if sub.status == 'graded':
        return GRADED
    if sub.status == 'awaiting_review':
        return AWAITING_REVIEW
    return SUBMITTED                                       # awaiting_result: exam still being graded


def homework_results(actor, kind, assignment_id) -> dict:
    now = timezone.now()
    if kind == 'quiz':
        return _quiz_results(actor, assignment_id, now)
    if kind not in KINDS:
        fail('NOT_FOUND', 'Vazifa topilmadi', 404)
    a = _hw_for_staff(actor, assignment_id)
    group_id = a.cohort.classroom_id
    roster = _roster(group_id) if group_id else {}
    if a.exam_id:
        from . import homework_scoring as scoring
        for student_id in roster:
            sub = HomeworkSubmission.objects.filter(assignment=a, student_id=student_id).first()
            if sub is None or sub.status != 'graded' or sub.source == 'exam_attempt':
                scoring.sync_from_exam(a, student_id)
    subs = {s.student_id: s for s in HomeworkSubmission.objects.filter(assignment=a)}
    former = _former(group_id, [s for s in subs if s not in roster])
    rows = []
    for student_id, name in list(roster.items()) + list(former.items()):
        sub = subs.get(student_id)
        status = _hw_status(sub, a.deadline, now)
        graded = status == GRADED
        rows.append(dict(studentId=student_id, name=name, removed=student_id not in roster, status=status,
                         percent=sub.score_percent if graded else None, passed=bool(sub and graded and sub.is_passed),
                         submittedAt=sub.completed_at if sub else None, submissionId=sub.id if sub else None,
                         attemptId=sub.attempt_id if sub and sub.source == 'exam_attempt' else None,
                         canGrade=kind == 'lesson' and status == AWAITING_REVIEW and student_id in roster))
    head = dict(kind=homework_kind(a), id=a.id, title=a.title, groupId=group_id, groupName=classrooms.name(a.cohort), deadline=a.deadline,
                minPassPercent=a.min_pass_percent, examId=a.exam_id, vocabularySetId=a.vocabulary_set_id, vocabularyMode=a.vocabulary_mode, lessonTitle=a.lesson.title if a.lesson else None,
                createdAt=a.created_at, closed=a.deadline < now)
    return _with_counts(head, rows)


def _quiz_results(actor, assignment_id, now):
    row = cq._assignment_for_staff(actor, assignment_id)          # 404 for another teacher's assignment
    for attempt in ClassQuizAttempt.objects.filter(assignment=row, status='in_progress', deadline_at__lte=now):
        cq.finalize(attempt.id, auto=True)
    roster = _roster(row.group_id)
    attempts: dict[str, list] = {}
    for att in ClassQuizAttempt.objects.filter(assignment=row).order_by('attempt_no'):
        attempts.setdefault(att.student_id, []).append(att)
    former = _former(row.group_id, [s for s in attempts if s not in roster])
    appeals = set(ClassQuizAppeal.objects.filter(attempt__assignment=row, status='pending').values_list('student_id', flat=True))
    closed = row.status != 'active' or now >= row.deadline
    rows = []
    for student_id, name in list(roster.items()) + list(former.items()):
        mine = attempts.get(student_id, [])
        done = [a for a in mine if a.status == 'submitted']
        best = max(done, key=lambda a: (a.percent or 0, -a.attempt_no), default=None)
        active = next((a for a in mine if a.status == 'in_progress'), None)
        status = (AWAITING_REVIEW if student_id in appeals else GRADED) if best else IN_PROGRESS if active else OVERDUE if closed else NOT_STARTED
        rows.append(dict(studentId=student_id, name=name, removed=student_id not in roster, status=status,
                         percent=best.percent if best else None, correct=best.correct_count if best else None, total=best.question_count if best else None,
                         submittedAt=best.submitted_at if best else None, durationSeconds=best.duration_seconds if best else None,
                         attemptId=best.id if best else None, attempts=len(mine), canGrade=False))
    snap = row.snapshot
    head = dict(kind='quiz', id=row.id, title=snap['title'], groupId=row.group_id, groupName=Group.objects.filter(id=row.group_id).values_list('name', flat=True).first() or '',
                deadline=row.deadline, questionCount=len(snap['questions']), timeLimitMinutes=row.time_limit_minutes, maxAttempts=row.max_attempts,
                createdAt=row.created_at, closed=closed)
    return _with_counts(head, rows)


def _with_counts(head, rows):
    current = [r for r in rows if not r['removed']]
    graded = [r['percent'] for r in current if r['status'] == GRADED and r['percent'] is not None]
    finished = {GRADED, SUBMITTED, AWAITING_REVIEW}
    counts = dict(assigned=len(current), submitted=sum(r['status'] in finished for r in current),
                  pending=sum(r['status'] in (NOT_STARTED, IN_PROGRESS) for r in current), overdue=sum(r['status'] == OVERDUE for r in current),
                  awaitingReview=sum(r['status'] in (AWAITING_REVIEW, SUBMITTED) for r in current), graded=len(graded))
    # needs the teacher first, then finished work, then who is still working / has not started
    order = {AWAITING_REVIEW: 0, SUBMITTED: 0, GRADED: 1, IN_PROGRESS: 2, NOT_STARTED: 3, OVERDUE: 4}
    rows.sort(key=lambda r: (r['removed'], order[r['status']], r['name'] or ''))
    return dict(assignment=head, counts=counts, averagePercent=round(sum(graded) / len(graded), 1) if graded else None,
                students=rows, refreshedAt=timezone.now())


def group_homework(actor, group_id) -> list[dict]:
    """A group's homework (both sources), newest first, with server-authoritative progress counts."""
    _require_staff(actor)
    _group(actor, group_id)
    items = []
    for a in ClassQuizAssignment.objects.filter(group_id=group_id).order_by('-created_at')[:50]:
        items.append(_quiz_results(actor, a.id, timezone.now()))
    for a in HomeworkAssignment.objects.filter(cohort__classroom_id=group_id).order_by('-created_at')[:50]:
        items.append(homework_results(actor, homework_kind(a), a.id))
    items.sort(key=lambda r: r['assignment']['createdAt'], reverse=True)
    return [dict(assignment=i['assignment'], counts=i['counts'], averagePercent=i['averagePercent']) for i in items]


def remind_pending(actor, kind, assignment_id) -> dict:
    """Queue a reminder (durable outbox, opt-out + quiet hours respected, one per student per day) for students
    who have not submitted. Nothing is sent from here: delivery is the opt-in outbox worker's job."""
    from . import telegram_notify as notify
    from . import telegram_outbox as outbox
    from . import telegram_state as state
    data = homework_results(actor, kind, assignment_id)
    a = data['assignment']
    if a['closed']:
        fail('ASSIGNMENT_CLOSED', "Muddat tugagan: eslatma yuborilmaydi", 409)
    today = timezone.localdate().isoformat()
    href = site_url(student_href(kind, a['id']))
    queued = 0
    pending = [r for r in data['students'] if not r['removed'] and r['status'] in (NOT_STARTED, IN_PROGRESS)]
    linked = set(User.objects.filter(id__in=[r['studentId'] for r in pending], is_active=True).exclude(telegram_chat_id__isnull=True)
                 .exclude(telegram_chat_id='').values_list('id', flat=True))
    for r in pending:
        if r['studentId'] not in linked:
            continue
        lang = state.language_of(r['studentId'])
        text = notify.tx(r['studentId'], 'homework_reminder', title=notify.esc(a['title']), when=notify.local(a['deadline']))
        if outbox.enqueue(r['studentId'], 'deadlines', f'homework_reminder:{kind}:{a["id"]}:{r["studentId"]}:{today}', text,
                          [[dict(text=notify.T[lang]['open_homework'], url=href)]]):
            queued += 1
    return dict(queued=queued, pending=len(pending), linked=len(linked))


def student_href(kind, assignment_id) -> str:
    return f'/homework/quiz/{assignment_id}' if kind == 'quiz' else '/homework'


# ================================================================================================ student

def student_homework(actor) -> list[dict]:
    """'Mening vazifalarim': both homework sources, the student's own groups only, real statuses and scores."""
    if getattr(actor, 'role', None) != 'student':
        fail('FORBIDDEN', "Faqat o'quvchilar uchun", 403)
    now = timezone.now()
    items = []
    for a in cq.my_assignments(actor):
        if a['attemptsUsed']:
            appeal = ClassQuizAppeal.objects.filter(attempt__assignment_id=a['id'], student_id=actor.id, status='pending').exists()
            status = AWAITING_REVIEW if appeal else GRADED
        else:
            status = IN_PROGRESS if a['state'] == 'in_progress' else OVERDUE if a['state'] == 'closed' else NOT_STARTED
        can_start = a['state'] in ('available', 'in_progress') and a['attemptsLeft'] > 0 or a['state'] == 'in_progress'
        group = Group.objects.filter(id=a['groupId']).select_related('teacher').first()
        items.append(dict(kind='quiz', id=a['id'], title=a['title'], type=a['category'], groupName=group.name if group else '',
                          teacherName=group.teacher.name if group and group.teacher_id and group.teacher else '', deadline=a['deadline'],
                          status=status, percent=a['bestPercent'], questionCount=a['questionCount'], timeLimitMinutes=a['timeLimitMinutes'],
                          attemptsLeft=a['attemptsLeft'], canStart=bool(can_start), href=student_href('quiz', a['id']),
                          activeAttemptId=a['activeAttemptId'],
                          lastAttemptId=ClassQuizAttempt.objects.filter(assignment_id=a['id'], student_id=actor.id, status='submitted')
                          .order_by('-attempt_no').values_list('id', flat=True).first()))
    from .teacher_views import student_assignment_rows
    for row in student_assignment_rows(actor):
        sub_status = row['status']
        status = (GRADED if sub_status in ('passed', 'failed') else AWAITING_REVIEW if sub_status == 'awaiting_review'
                  else SUBMITTED if sub_status == 'awaiting_result' else OVERDUE if sub_status == 'overdue' else NOT_STARTED)
        kind = 'vocabulary' if row['vocabulary_set_id'] else 'exam' if row['exam_id'] else 'lesson'
        if kind == 'vocabulary':
            href = f'/vocabulary/assignment/{row["id"]}'
        elif kind == 'exam':
            href = f'/mock/attempt/{row["exam_attempt_id"]}' if row['exam_attempt_id'] else None
        else:
            href = f'/videos?lesson=lesson-grammar-{row["lesson_order"]}' if row['lesson_order'] else None
        items.append(dict(kind=kind, id=row['id'], title=row['title'], type=kind, groupName=row['cohort_name'], teacherName=row['teacher_name'],
                          deadline=row['deadline'], status=status, percent=row['score_percent'], passed=row['is_passed'],
                          minPassPercent=row['min_pass_percent'], canStart=status == NOT_STARTED and kind != 'exam' or bool(row['can_launch_exam']),
                          canSubmit=kind == 'lesson' and status == NOT_STARTED, examId=row['exam_id'], href=href, completedAt=row['completed_at']))
    rank = {IN_PROGRESS: 0, NOT_STARTED: 1, AWAITING_REVIEW: 2, SUBMITTED: 3, GRADED: 4, OVERDUE: 5}
    items.sort(key=lambda i: (rank[i['status']], str(i['deadline'])))
    return items
