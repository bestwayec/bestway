"""Vocabulary practice and spaced-repetition review for the Telegram bot, on top of the existing vocabulary services.

Nothing here invents a second scoring or scheduling system:
  * practice runs create a normal VocabularyPracticeSession and finish through vocabulary_service.submit_quiz_attempt
    (attempt row, weak-word / review updates, points, parent notice - all idempotent per session);
  * review runs apply every answer through vocabulary_review.update_review - the same deterministic 1/3/7/14/30-day
    engine the website uses - inside the transaction that records the answer, so a repeated tap changes nothing twice.
The server owns questions, expected answers and the clock; the bot only forwards the student's response.
"""
from __future__ import annotations

import random
from datetime import timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.legacy_schema.models import StudentProfile
from common.api.exceptions import ContractAPIException

from . import vocabulary_answers as va
from . import vocabulary_review, vocabulary_service, vocabulary_views
from .models import (BotVocabRun, UserWeakWord, VocabularyAnswerReport, VocabularyAnswerVariant, VocabularyAttempt,
                     VocabularyPracticeSession, VocabularySet, VocabularyWord)

MODES = {"A": "eng_uzb", "B": "uzb_eng", "C": "spelling", "D": "choice", "E": "mixed"}
MAX_RUN_QUESTIONS = 50
REVIEW_BATCH = 15
RUN_LIFETIME = timedelta(minutes=55)   # inside the 1h practice-session lifetime


def _fail(code, message, status=404):
    raise ContractAPIException(code, message, status)


# ------------------------------------------------------------------------------------------------- sets

def visible_sets(user, limit=12):
    """Sets this student may study (their group's, their teacher's public sets, their own) with active word counts."""
    rows = VocabularySet.objects.all()
    visible = vocabulary_views.student_visibility(user)
    if visible is not None:
        rows = rows.filter(visible)
    rows = rows.annotate(wordCount=Count("words", filter=Q(words__is_archived=False))).filter(wordCount__gt=0)
    return list(rows.order_by("-created_at")[:limit])


def get_visible_set(user, set_id):
    for row in visible_sets(user, limit=500):
        if row.id == set_id:
            return row
    _fail("VOCABULARY_SET_NOT_FOUND", "set not found")


# ------------------------------------------------------------------------------------------------- run construction

def _question(word, q_type, options, input_kind, variants):
    expected = word.uzbek if q_type == "eng_uzb" else word.english
    return {
        "wordId": word.id, "type": q_type, "input": input_kind, "options": options,
        "prompt": word.english if q_type == "eng_uzb" else word.uzbek,
        "firstLetter": word.english[:1].upper() if q_type == "spelling" else "",
        "expected": expected,
        "accepted": va.accepted_forms(word, q_type, variants.get((word.id, q_type), ())),
    }


def _variants_for(word_ids):
    out = {}
    for row in VocabularyAnswerVariant.objects.filter(word_id__in=word_ids):
        out.setdefault((row.word_id, row.direction), []).append(row.text)
    return out


def _input_kind(letter, q_type):
    if letter == "D":
        return "mcq"
    if letter == "E":
        return "mcq" if q_type == "eng_uzb" else "text"
    return "text"


def start_practice(user, set_id, letter):
    """Create (or resume) the student's active practice run for a set and mode letter A-E."""
    if letter not in MODES:
        _fail("VALIDATION_ERROR", "mode", 400)
    vocab_set = get_visible_set(user, set_id)
    now = timezone.now()
    with transaction.atomic():
        vocabulary_service.lock_practice_actor(user)
        existing = (BotVocabRun.objects.select_for_update().filter(student_id=user.id, kind="practice", status="active",
                                                                    set_id=vocab_set.id, mode_letter=letter,
                                                                    started_at__gt=now - RUN_LIFETIME).first())
        if existing:
            return existing
        # one unfinished run per student at a time: stale ones are closed so the menu never offers two
        BotVocabRun.objects.filter(student_id=user.id, status="active").update(status="finished", finished_at=now)
        words = list(VocabularyWord.objects.filter(set_id=vocab_set.id, is_archived=False))
        if not words:
            _fail("EMPTY_VOCABULARY_SET", "empty", 400)
        random.shuffle(words)
        words = words[:MAX_RUN_QUESTIONS]
        variants = _variants_for([w.id for w in words])
        if letter == "D":
            first = {q["wordId"]: q for q in vocabulary_service.quiz_from_words(vocab_set, list(words), "eng_uzb")["questions"]}
            second = {q["wordId"]: q for q in vocabulary_service.quiz_from_words(vocab_set, list(words), "uzb_eng")["questions"]}
            order = [w for w in words]
            built = []
            for index, word in enumerate(order):
                source = first if index % 2 == 0 else second
                q = source[word.id]
                built.append(_question(word, q["type"], q["options"], "mcq", variants))
        else:
            mode = {"A": "eng_uzb", "B": "uzb_eng", "C": "spelling", "E": "mixed"}[letter]
            quiz = vocabulary_service.quiz_from_words(vocab_set, list(words), mode)
            by_id = {w.id: w for w in words}
            built = [_question(by_id[q["wordId"]], q["type"], q["options"], _input_kind(letter, q["type"]), variants)
                     for q in quiz["questions"]]
        session = VocabularyPracticeSession.objects.create(
            student_id=user.id, vocabulary_set=vocab_set, mode=("mixed" if letter in "DE" else MODES[letter]), legacy=False,
            questions=[{"question": {"wordId": q["wordId"], "type": q["type"], "id": q["wordId"], "prompt": q["prompt"], "options": q["options"]},
                        "english": next(w.english for w in words if w.id == q["wordId"]),
                        "uzbek": next(w.uzbek for w in words if w.id == q["wordId"]),
                        "expected": q["expected"], "accepted": q["accepted"]} for q in built],
            expires_at=now + vocabulary_service.PRACTICE_LIFETIME,
        )
        return BotVocabRun.objects.create(student_id=user.id, kind="practice", mode_letter=letter, set=vocab_set,
                                          practice_session_id=session.id, questions=built, answers={}, started_at=now)


def start_review(user):
    """Run over today's due weak words (same selection and ordering as the website), at most REVIEW_BATCH."""
    now = timezone.now()
    with transaction.atomic():
        vocabulary_service.lock_practice_actor(user)
        existing = BotVocabRun.objects.select_for_update().filter(student_id=user.id, kind="review", status="active",
                                                                   started_at__gt=now - RUN_LIFETIME).first()
        if existing:
            return existing
        BotVocabRun.objects.filter(student_id=user.id, status="active").update(status="finished", finished_at=now)
        rows = list(vocabulary_review.due(user.id, now).select_related("word")
                    .order_by("-mistake_count", "-last_reviewed", "word_id")[:REVIEW_BATCH])
        if not rows:
            return None
        words = [r.word for r in rows]
        variants = _variants_for([w.id for w in words])
        all_uzbek, all_english = [w.uzbek for w in words], [w.english for w in words]
        built = []
        for index, row in enumerate(rows):
            word, cycle = row.word, index % 3
            if cycle == 0:
                pool = [u for u in all_uzbek if u.lower() != word.uzbek.lower()]
                options = list({word.uzbek, *random.sample(pool, min(3, len(pool)))})
                q = _question(word, "eng_uzb", options, "mcq", variants)
            elif cycle == 1:
                q = _question(word, "uzb_eng", [], "text", variants)
            else:
                q = _question(word, "spelling", [], "text", variants)
            random.shuffle(q["options"])
            q["reviewCount"] = row.review_count     # staleness guard: if the website answered it meanwhile, no double update
            q["revision"] = vocabulary_review.word_revision(word)
            built.append(q)
        return BotVocabRun.objects.create(student_id=user.id, kind="review", questions=built, answers={}, started_at=now)


# ------------------------------------------------------------------------------------------------- answering

def get_run(user, run_id):
    run = BotVocabRun.objects.filter(pk=run_id, student_id=user.id).first()
    if run is None:
        _fail("RUN_NOT_FOUND", "not found")
    return run


def next_index(run):
    for index, q in enumerate(run.questions):
        if q["wordId"] not in run.answers:
            return index
    return None


def _response_for(question, raw):
    """For MCQ the callback carries an option index; resolve it on the server."""
    if question["input"] == "mcq":
        try:
            return question["options"][int(raw)]
        except (ValueError, IndexError, TypeError):
            _fail("VALIDATION_ERROR", "option", 400)
    text = str(raw or "").strip()
    if not text or len(text) > 500:
        _fail("VALIDATION_ERROR", "answer", 400)
    return text


def answer(user, run_id, index, raw):
    """Record one answer (idempotent). Returns {'correct', 'expected', 'repeat', 'run'}.

    A repeated tap/message for an already answered word returns the stored verdict and touches nothing.
    """
    now = timezone.now()
    with transaction.atomic():
        run = BotVocabRun.objects.select_for_update().filter(pk=run_id, student_id=user.id).first()
        if run is None:
            _fail("RUN_NOT_FOUND", "not found")
        if run.status != "active":
            _fail("RUN_FINISHED", "finished", 409)
        if now - run.started_at > RUN_LIFETIME:
            _fail("RUN_EXPIRED", "expired", 409)
        if not 0 <= index < len(run.questions):
            _fail("QUESTION_NOT_FOUND", "question", 404)
        question = run.questions[index]
        stored = run.answers.get(question["wordId"])
        if stored is not None:
            return {"correct": stored["correct"], "expected": question["expected"], "response": stored["response"],
                    "question": question, "repeat": True, "run": run}
        response = _response_for(question, raw)
        correct = va.matches(response, question["expected"], question.get("accepted"))
        if run.kind == "review":
            _apply_review(user, question, correct, now)
        run.answers = {**run.answers, question["wordId"]: {"response": response, "correct": correct, "at": now.isoformat()}}
        run.save(update_fields=["answers"])
        return {"correct": correct, "expected": question["expected"], "response": response,
                "question": question, "repeat": False, "run": run}


def _apply_review(user, question, correct, now):
    row = (UserWeakWord.objects.select_for_update(of=("self",)).select_related("word")
           .filter(student_id=user.id, word_id=question["wordId"]).first())
    if row is None:
        return
    if row.review_count != question.get("reviewCount", row.review_count):
        return   # already reviewed elsewhere (website) since this run was issued: never schedule twice
    if question.get("revision") and question["revision"] != vocabulary_review.word_revision(row.word):
        return   # the word was edited since issue; the old question no longer describes it
    vocabulary_review.update_review(row, correct, now)


def finish(user, run_id):
    """Finish a run (idempotent). Practice: scored by the shared service; review: summarised from stored answers."""
    now = timezone.now()
    with transaction.atomic():
        run = BotVocabRun.objects.select_for_update().filter(pk=run_id, student_id=user.id).first()
        if run is None:
            _fail("RUN_NOT_FOUND", "not found")
        if run.result is not None:
            return run.result
        total = len(run.questions)
        duration = int(max(0, (min(now, run.started_at + RUN_LIFETIME) - run.started_at).total_seconds()))
        wrong = [{"wordId": q["wordId"], "prompt": q["prompt"], "expected": q["expected"],
                  "response": (run.answers.get(q["wordId"]) or {}).get("response", ""), "type": q["type"]}
                 for q in run.questions if not (run.answers.get(q["wordId"]) or {}).get("correct")]
        correct = total - len(wrong)
        result = {"kind": run.kind, "total": total, "correct": correct, "wrong": len(wrong),
                  "percent": round(100 * correct / total, 1) if total else 0.0,
                  "durationSeconds": duration, "wordsToReview": wrong, "answered": len(run.answers)}
        if run.kind == "practice":
            submitted = [{"wordId": q["wordId"], "answer": (run.answers.get(q["wordId"]) or {}).get("response", "")}
                         for q in run.questions]
            session = VocabularyPracticeSession.objects.filter(pk=run.practice_session_id).first()
            if session is not None and session.result is None and session.expires_at > now:
                scored = vocabulary_service.submit_quiz_attempt(user, run.set_id, None, submitted, session_id=session.id)
                result.update(attemptId=scored["attemptId"], pointsAwarded=scored["pointsAwarded"], setTitle=scored["setTitle"],
                              correct=scored["score"], percent=scored["percentage"], wrong=len(scored["wrongAnswers"]))
            else:
                result["setTitle"] = run.set.title if run.set else ""
                result["pointsAwarded"] = 0
        else:
            result["nextDue"] = _next_due_summary(user.id, now)
        run.result, run.status, run.finished_at = result, "finished", now
        run.save(update_fields=["result", "status", "finished_at"])
        return result


def _next_due_summary(student_id, now):
    upcoming = (UserWeakWord.objects.filter(student_id=student_id, next_review_at__gt=now)
                .order_by("next_review_at").values_list("next_review_at", flat=True).first())
    return {"dueNow": vocabulary_review.due(student_id, now).count(),
            "nextAt": upcoming.isoformat() if upcoming else None}


# ------------------------------------------------------------------------------------------------- summary

def summary(user):
    """Counts used by /natija. due == the website's due() count by construction (same function)."""
    now = timezone.now()
    attempts = list(VocabularyAttempt.objects.filter(student_id=user.id).select_related("set").order_by("-completed_at")[:5])
    weak = UserWeakWord.objects.filter(student_id=user.id)
    return {
        "recent": [{"title": a.set.title if a.set_id else "", "score": a.score, "total": a.total_words,
                    "percent": float(a.percentage), "at": a.completed_at.isoformat()} for a in attempts],
        "due": vocabulary_review.due(user.id, now).count(),
        "tracked": weak.count(),
        "mastered": weak.filter(is_mastered=True).count(),
        "attemptCount": VocabularyAttempt.objects.filter(student_id=user.id).count(),
    }


# ------------------------------------------------------------------------------------------------- correction reports

def report_answer(user, run_id, index):
    """'My answer should be accepted': queue a report for the teacher. Never changes any score by itself."""
    run = get_run(user, run_id)
    if not 0 <= index < len(run.questions):
        _fail("QUESTION_NOT_FOUND", "question")
    question = run.questions[index]
    stored = run.answers.get(question["wordId"])
    if stored is None or stored["correct"]:
        _fail("NOTHING_TO_REPORT", "nothing to report", 409)
    report, created = VocabularyAnswerReport.objects.get_or_create(
        student_id=user.id, run_id=run.id, word_id=question["wordId"],
        defaults={"direction": question["type"], "response": stored["response"][:500]})
    return report, created


def _manages_word(actor, word):
    """Teacher may decide for words of sets they created or in groups they teach; admins always."""
    if actor.role in ("admin", "super_admin"):
        return True
    vocab_set = word.set
    if vocab_set.created_by_id == actor.id:
        return True
    return bool(vocab_set.group_id and vocab_set.group and vocab_set.group.teacher_id == actor.id)


def decide_report(actor, report_id, approve: bool, note=""):
    """Teacher approves (registers the response as an accepted variant) or rejects. Issued snapshots stay untouched."""
    if actor.role not in ("teacher", "admin", "super_admin"):
        _fail("FORBIDDEN", "forbidden", 403)
    with transaction.atomic():
        report = (VocabularyAnswerReport.objects.select_for_update(of=("self",)).select_related("word__set__group")
                  .filter(pk=report_id).first())
        if report is None or not _manages_word(actor, report.word):
            _fail("REPORT_NOT_FOUND", "not found")      # no existence leak across teachers
        if report.status != "pending":
            return report
        report.status = "approved" if approve else "rejected"
        report.decided_by_id, report.decided_at, report.note = actor.id, timezone.now(), (note or "")[:500]
        report.save(update_fields=["status", "decided_by_id", "decided_at", "note"])
        if approve:
            VocabularyAnswerVariant.objects.get_or_create(
                word=report.word, direction=report.direction, canonical=va.canon(report.response),
                defaults={"text": report.response, "approved_by_id": actor.id, "source": "appeal"})
        student_id, english, note_text, approved = report.student_id, report.word.english, report.note, approve
        report_id = report.id

        def notify():
            try:
                from . import telegram_notify
                telegram_notify.vocab_report_decided(student_id, english, approved, note_text, key=f"vocab_report:{report_id}")
            except Exception:  # noqa: BLE001 - never break the decision
                pass
        transaction.on_commit(notify)
        return report


def pending_reports(actor, limit=20):
    rows = VocabularyAnswerReport.objects.filter(status="pending").select_related("word__set__group").order_by("created_at")
    return [r for r in rows[:200] if _manages_word(actor, r.word)][:limit]
