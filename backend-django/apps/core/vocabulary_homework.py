"""Issue and score a single server-owned vocabulary practice session per assignment."""
import csv
import hashlib
import json
from itertools import chain
from tempfile import SpooledTemporaryFile
from types import SimpleNamespace

from django.db import transaction
from django.db.models import Q
from django.http import FileResponse, StreamingHttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view

from apps.legacy_schema.models import StudentProfile, User
from common.api.exceptions import ContractAPIException

from . import classrooms, vocabulary_collections, vocabulary_service
from .domain_contracts import invalid, payload
from .models import ClassroomEnrollment, HomeworkAssignment, HomeworkSubmission, QuizMode, VocabularyAttempt, VocabularyFlashcardProgress, VocabularyFlashcardReceipt, VocabularyHomeworkSession
from .teacher_views import require_authenticated, require_role, success


def assignment_for_student(student_id, assignment_id):
    assignment = HomeworkAssignment.objects.select_related("cohort", "vocabulary_set").filter(
        id=assignment_id, vocabulary_set_id__isnull=False,
    ).first()
    if assignment is None:
        raise ContractAPIException("NOT_FOUND", "Vazifa topilmadi", 404)
    profile = StudentProfile.objects.select_for_update().filter(user_id=student_id).first()
    if not profile or not assignment.cohort.classroom_id or profile.group_id != assignment.cohort.classroom_id:
        raise ContractAPIException("FORBIDDEN", "Vazifa bu o‘quvchiga biriktirilmagan", 403)
    return assignment


def session_payload(session):
    return {
        "sessionId": session.id,
        "mode": session.mode,
        "result": session.result,
        "questions": [] if session.result is not None else [row["question"] for row in session.questions],
    }


def issue(assignment, student_id, mode):
    existing = VocabularyHomeworkSession.objects.filter(assignment=assignment, student_id=student_id).first()
    if existing:
        return existing
    revision = vocabulary_collections.assignment_revision(assignment)
    pinned_words = [SimpleNamespace(
        id=word["id"], english=word["english"], uzbek=word["uzbek"],
        context_sentence=word["contextSentence"], part_of_speech=word["partOfSpeech"],
    ) for word in revision["words"]]
    collection = SimpleNamespace(id=assignment.vocabulary_set_id, title=revision["title"], level=revision["level"])
    quiz = vocabulary_service.quiz_from_words(collection, pinned_words, mode)
    questions = snapshot_questions(assignment.vocabulary_set, quiz, pinned_words)
    return VocabularyHomeworkSession.objects.create(
        assignment=assignment, student_id=student_id, questions=questions, mode=mode,
    )


@api_view(["POST"])
@transaction.atomic
def start_view(request, assignment_id):
    actor = require_authenticated(request)
    require_role(request, "student")
    data = payload(request, {"mode"})
    mode = data.get("mode", QuizMode.MIXED)
    if mode not in QuizMode.values:
        invalid("Mashq turi yaroqsiz")
    assignment = assignment_for_student(actor.id, assignment_id)
    session = issue(assignment, actor.id, mode)
    return success(session_payload(session))


@api_view(["GET"])
@transaction.atomic
def words_view(request, assignment_id):
    actor = require_authenticated(request)
    require_role(request, "student")
    assignment = assignment_for_student(actor.id, assignment_id)
    return success(vocabulary_collections.assignment_revision(assignment)["words"])


def snapshot_questions(vocab_set, quiz, pinned_words=None):
    words = {word.id: word for word in (pinned_words if pinned_words is not None else vocab_set.words.filter(is_archived=False))}
    questions = []
    for question in quiz["questions"]:
        word = words.get(question["wordId"])
        if word is None:
            raise ContractAPIException("VOCABULARY_CHANGED", "To‘plam yangilandi. Qayta urinib ko‘ring", 409)
        questions.append({
            "question": question,
            "english": word.english,
            "uzbek": word.uzbek,
            "expected": word.uzbek if question["type"] == QuizMode.ENG_UZB else word.english,
        })
    return questions


def answer_by_word(answers, allowed):
    if not isinstance(answers, list) or len(answers) != len(allowed):
        invalid("Har bir so‘zga bittadan javob kerak")
    result = {}
    for item in answers:
        if not isinstance(item, dict):
            invalid("Javob formati yaroqsiz")
        word_id, answer = item.get("wordId"), item.get("answer")
        if not isinstance(word_id, str) or word_id not in allowed or word_id in result:
            invalid("Javobda sessiyaga tegishli noyob so‘z kerak")
        if not isinstance(answer, str) or len(answer) > 500:
            invalid("Javob 500 belgidan oshmasligi kerak")
        if "type" in item and isinstance(allowed[word_id], dict):
            if item["type"] != allowed[word_id]["question"]["type"]:
                invalid("Javob yo‘nalishi sessiyaga mos kelmadi")
        result[word_id] = answer.strip()
    return result


def normalize(answer):
    return " ".join(answer.casefold().split())


def score_snapshot(snapshot, submitted):
    questions = {row["question"]["wordId"]: row for row in snapshot}
    answers = answer_by_word(submitted, questions)
    wrong = []
    for word_id, row in questions.items():
        if normalize(answers[word_id]) != normalize(row["expected"]):
            wrong.append({
                "wordId": word_id, "english": row["english"], "uzbek": row["uzbek"],
                "userAnswer": answers[word_id], "correctAnswer": row["expected"], "type": row["question"]["type"],
            })
    total = len(questions)
    correct = total - len(wrong)
    percent = round(100 * correct / total, 1)
    return questions, wrong, correct, total, percent


@api_view(["POST"])
@transaction.atomic
def submit_view(request, assignment_id):
    actor = require_authenticated(request)
    require_role(request, "student")
    assignment = assignment_for_student(actor.id, assignment_id)
    data = payload(request, {"sessionId", "answers"})
    identifier = data.get("sessionId")
    if not isinstance(identifier, str):
        invalid("Mashq sessiyasi kerak")
    session = VocabularyHomeworkSession.objects.select_for_update().filter(
        id=identifier, student_id=actor.id, assignment=assignment,
    ).first()
    if session is None:
        raise ContractAPIException("NOT_FOUND", "Mashq sessiyasi topilmadi", 404)
    if session.result is not None:
        return success(session.result)

    questions, wrong, correct, total, percent = score_snapshot(session.questions, data.get("answers"))
    now = timezone.now()
    attempt = VocabularyAttempt.objects.create(
        student_id=actor.id, set_id=assignment.vocabulary_set_id, mode=session.mode,
        score=correct, total_words=total, percentage=percent, wrong_answers=wrong,
    )
    from .vocabulary_review import record_answer

    missed_ids = {row["wordId"] for row in wrong}
    for word in assignment.vocabulary_set.words.filter(id__in=questions).order_by("id"):
        record_answer(actor.id, word, word.id not in missed_ids, now)

    submission = HomeworkSubmission.objects.create(
        assignment=assignment, student_id=actor.id, score_percent=round(percent),
        is_passed=round(percent) >= assignment.min_pass_percent, status="graded", source="vocabulary_attempt",
        attempt_id=attempt.id, graded_at=now,
    )
    session.result = {
        "attemptId": attempt.id, "score": correct, "totalWords": total, "percentage": percent,
        "pointsAwarded": 0, "mode": session.mode, "wrongAnswers": wrong, "isPassed": submission.is_passed,
    }
    session.save(update_fields=["result"])
    return success(session.result)


@api_view(["GET"])
def results_view(request, group_id, assignment_id):
    actor = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")
    cohort = classrooms.homework_cohort(actor, group_id)
    assignment = HomeworkAssignment.objects.filter(id=assignment_id, cohort=cohort, vocabulary_set_id__isnull=False).first()
    if assignment is None:
        raise ContractAPIException("NOT_FOUND", "Vazifa topilmadi", 404)

    current_members = StudentProfile.objects.filter(group_id=group_id).values_list("user_id", flat=True)
    current = set(current_members)
    periods = ClassroomEnrollment.objects.filter(group_id=group_id).filter(
        Q(ended_at__gte=assignment.created_at) | Q(ended_at__isnull=True),
        Q(started_at__lte=assignment.deadline) | Q(started_at__isnull=True),
    ).values_list("student_id", flat=True)
    sessions = VocabularyHomeworkSession.objects.filter(assignment=assignment, result__isnull=False)
    roster = dict(User.objects.filter(
        Q(id__in=current_members) | Q(id__in=periods) | Q(id__in=sessions.values("student_id")),
    ).values_list("id", "name"))
    misses = {}
    students = []
    for student_id, result in sessions.values_list("student_id", "result").iterator(chunk_size=100):
        for row in result["wrongAnswers"]:
            misses[row["english"]] = misses.get(row["english"], 0) + 1
        if student_id not in roster:
            continue
        students.append({
            "studentId": student_id, "name": roster[student_id],
            "currentlyEnrolled": student_id in current,
            "score": result["score"], "totalWords": result["totalWords"],
            "percentage": result["percentage"], "isPassed": result["isPassed"],
        })
    ranked_misses = sorted(misses.items(), key=lambda row: (-row[1], row[0]))
    students.sort(key=lambda row: (row["name"], row["studentId"]))
    completed = {student["studentId"] for student in students}
    overdue_ids = set(roster) - completed if assignment.deadline < timezone.now() else set()
    overdue_rows = sorted(
        ({"studentId": pk, "name": roster[pk], "currentlyEnrolled": pk in current} for pk in overdue_ids),
        key=lambda row: (row["name"], row["studentId"]),
    )
    download = request.query_params.get("download")
    if download in ("csv", "xlsx"):
        return export_results(download, students, ranked_misses)
    from .domain_contracts import pagination

    query = pagination(request, {"search"})
    term = (query.get("search") or "").strip().casefold()
    filtered = [row for row in students if term in row["name"].casefold()]
    offset = (query["page"] - 1) * query["limit"]
    return success({
        "assignedCount": len(roster), "completedCount": len(students),
        "overdueCount": len(overdue_rows), "overdueStudents": overdue_rows[:100],
        "students": filtered[offset:offset + query["limit"]], "page": query["page"],
        "hasNext": len(filtered) > offset + query["limit"],
        "missedWords": [{"english": word, "count": count} for word, count in ranked_misses],
    })


def safe_spreadsheet_text(text):
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


class CSVLine:
    def write(self, value):
        return value


def export_results(extension, students, missed):
    headers = ("Student", "Correct", "Total", "Percentage", "Passed")
    scores = ((safe_spreadsheet_text(row["name"]), row["score"], row["totalWords"],
               row["percentage"], row["isPassed"]) for row in students)
    missed_headers = ("Commonly missed word", "Count")
    missed_rows = ((safe_spreadsheet_text(word), count) for word, count in missed)
    if extension == "xlsx":
        from openpyxl import Workbook

        workbook = Workbook(write_only=True)
        results = workbook.create_sheet("Results")
        results.append(headers)
        for row in scores:
            results.append(row)
        difficult_words = workbook.create_sheet("Difficult words")
        difficult_words.append(missed_headers)
        for row in missed_rows:
            difficult_words.append(row)
        content = SpooledTemporaryFile(max_size=512 * 1024, mode="w+b")
        try:
            workbook.save(content)
            content.seek(0)
        except Exception:
            content.close()
            raise
        response = FileResponse(content, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    else:
        writer = csv.writer(CSVLine())
        rows = chain((headers,), scores, ((), missed_headers), missed_rows)
        response = StreamingHttpResponse(chain(("\ufeff",), map(writer.writerow, rows)), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="vocabulary-results.{extension}"'
    return response


@api_view(["GET"])
@transaction.atomic
def snapshot_view(request, assignment_id):
    actor = require_authenticated(request)
    require_role(request, "student")
    assignment = assignment_for_student(actor.id, assignment_id)
    return success(vocabulary_collections.assignment_revision(assignment))


_FLASHCARD_FIELDS = {"lastWordId", "wordId", "status", "order"}
_FLASHCARD_BATCH = _FLASHCARD_FIELDS | {"mutations", "clientRevision"}


def _flashcard_state(progress, acknowledged=None):
    result = {
        "lastWordId": progress.last_word_id if progress else "",
        "familiarity": progress.familiarity if progress else {},
        "order": progress.word_order if progress else [],
        "lastStudiedAt": progress.last_studied_at if progress else None,
        "serverRevision": progress.sync_revision if progress else 0,
    }
    if acknowledged is not None:
        result["acknowledgedOpIds"] = acknowledged
    return success(result)


def _apply_flashcard_change(progress, change, allowed):
    if not _FLASHCARD_FIELDS.intersection(change) or ("wordId" in change) != ("status" in change):
        invalid("Select a word, study position or shuffle order")
    for key in ("lastWordId", "wordId"):
        if key in change and (not isinstance(change[key], str) or change[key] not in allowed):
            invalid("Word does not belong to the assignment")
    if "status" in change and change["status"] not in ("known", "practice"):
        invalid("Invalid flashcard status")
    if "order" in change:
        order = change["order"]
        if not isinstance(order, list) or len(order) != len(allowed) or not all(isinstance(word, str) for word in order) or set(order) != allowed:
            invalid("Shuffle order must contain every assigned word once")
        progress.word_order = order
    if "lastWordId" in change:
        progress.last_word_id = change["lastWordId"]
    if "status" in change:
        progress.familiarity[change["wordId"]] = change["status"]


def _apply_flashcard_batch(progress, mutations, allowed):
    if not isinstance(mutations, list) or not 1 <= len(mutations) <= 100:
        invalid("Mutations must be a list of 1 to 100 items")
    if progress.pk is None:
        progress.save()
    existing = {
        receipt.op_id: receipt.fingerprint
        for receipt in VocabularyFlashcardReceipt.objects.filter(progress=progress)
        .filter(op_id__in=[
            op["opId"] for op in mutations if isinstance(op, dict) and isinstance(op.get("opId"), str)
        ])
    }
    acknowledged = {}
    new_receipts = []
    for op in mutations:
        if not isinstance(op, dict) or op.keys() - (_FLASHCARD_FIELDS | {"opId", "timestamp"}):
            invalid("Invalid flashcard mutation")
        op_id = op.get("opId")
        if not isinstance(op_id, str) or not 1 <= len(op_id) <= 100 or not op_id.strip():
            invalid("Invalid flashcard operation identifier")
        fields = {key: op[key] for key in _FLASHCARD_FIELDS if key in op}
        fingerprint = hashlib.sha256(json.dumps(fields, sort_keys=True).encode()).hexdigest()
        if op_id in existing:
            if fingerprint != existing[op_id]:
                raise ContractAPIException("OPERATION_CONFLICT", "Operation identifier has already been used", 409)
        else:
            _apply_flashcard_change(progress, fields, allowed)
            new_receipts.append(VocabularyFlashcardReceipt(progress=progress, op_id=op_id, fingerprint=fingerprint))
            existing[op_id] = fingerprint
        acknowledged[op_id] = None
    if new_receipts:
        VocabularyFlashcardReceipt.objects.bulk_create(new_receipts)
        progress.sync_revision += len(new_receipts)
        progress.save()
    return list(acknowledged)


def _flashcards(request, assignment_id):
    actor = require_authenticated(request)
    require_role(request, "student")
    # The assignment lookup locks the student profile, covering the first write,
    # the legacy PATCH path and concurrent writes from separate devices.
    assignment = assignment_for_student(actor.id, assignment_id)
    progress = VocabularyFlashcardProgress.objects.filter(assignment=assignment, student_id=actor.id).first()
    if request.method == "GET":
        return _flashcard_state(progress)

    data = payload(request, _FLASHCARD_BATCH)
    allowed = {word["id"] for word in vocabulary_collections.assignment_revision(assignment)["words"]}
    progress = progress or VocabularyFlashcardProgress(assignment=assignment, student_id=actor.id)
    if "mutations" in data or request.method == "POST":
        # Earlier clients also sent a top-level position/order copied from the
        # whole local queue. Only the operations in this batch can be committed.
        return _flashcard_state(progress, _apply_flashcard_batch(progress, data.get("mutations"), allowed))

    _apply_flashcard_change(progress, data, allowed)
    progress.sync_revision += 1
    progress.save()
    return _flashcard_state(progress)


@api_view(["GET", "PATCH"])
@transaction.atomic
def flashcards_view(request, assignment_id):
    return _flashcards(request, assignment_id)


@api_view(["POST"])
@transaction.atomic
def flashcards_sync_view(request, assignment_id):
    return _flashcards(request, assignment_id)


@api_view(["GET"])
def learner_history_view(request):
    actor = require_authenticated(request)
    require_role(request, "student")
    from .domain_contracts import pagination

    query = pagination(request)
    offset = (query["page"] - 1) * query["limit"]
    rows = HomeworkSubmission.objects.filter(student_id=actor.id, source="vocabulary_attempt").order_by("-completed_at", "-pk")
    entries = list(rows.values("assignment_id", "assignment__title", "score_percent", "completed_at", "is_passed")
                   [offset:offset + query["limit"] + 1])
    return success({"entries": entries[:query["limit"]], "page": query["page"], "hasNext": len(entries) > query["limit"]})
