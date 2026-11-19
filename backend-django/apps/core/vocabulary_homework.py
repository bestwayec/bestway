"""Issue and score a single server-owned vocabulary practice session per assignment."""
import csv

from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view

from apps.legacy_schema.models import StudentProfile
from common.api.exceptions import ContractAPIException

from . import classrooms, vocabulary_service
from .domain_contracts import invalid, payload
from .models import HomeworkAssignment, HomeworkSubmission, QuizMode, VocabularyAttempt, VocabularyHomeworkSession
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
    quiz = vocabulary_service.generate_quiz_for_set(assignment.vocabulary_set_id, mode, student_id)
    questions = snapshot_questions(assignment.vocabulary_set, quiz)
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
    return success([{
        "id": word.id, "english": word.english, "uzbek": word.uzbek,
        "contextSentence": word.context_sentence, "partOfSpeech": word.part_of_speech,
    } for word in assignment.vocabulary_set.words.all()])


def snapshot_questions(vocab_set, quiz):
    words = {word.id: word for word in vocab_set.words.all()}
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

    roster = dict(StudentProfile.objects.filter(group_id=group_id).values_list("user_id", "user__name"))
    sessions = VocabularyHomeworkSession.objects.filter(assignment=assignment, student_id__in=roster, result__isnull=False)
    misses = {}
    students = []
    for session in sessions:
        for row in session.result["wrongAnswers"]:
            misses[row["english"]] = misses.get(row["english"], 0) + 1
        students.append({
            "studentId": session.student_id, "name": roster[session.student_id],
            "score": session.result["score"], "totalWords": session.result["totalWords"],
            "percentage": session.result["percentage"], "isPassed": session.result["isPassed"],
        })
    ranked_misses = sorted(misses.items(), key=lambda row: (-row[1], row[0]))
    students.sort(key=lambda row: (row["name"], row["studentId"]))
    overdue = len(roster) - len(students) if assignment.deadline < timezone.now() else 0
    if request.query_params.get("download") == "csv":
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="vocabulary-results.csv"'
        response.write("\ufeff")
        writer = csv.writer(response)
        writer.writerow(["Student", "Correct", "Total", "Percentage", "Passed"])
        for row in students:
            writer.writerow([safe_spreadsheet_text(row["name"]), row["score"], row["totalWords"], row["percentage"], row["isPassed"]])
        writer.writerow([])
        writer.writerow(["Commonly missed word", "Count"])
        writer.writerows((safe_spreadsheet_text(word), count) for word, count in ranked_misses)
        return response
    return success({
        "assignedCount": len(roster), "completedCount": len(students),
        "overdueCount": overdue, "students": students,
        "missedWords": [{"english": word, "count": count} for word, count in ranked_misses],
    })


def safe_spreadsheet_text(text):
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text
