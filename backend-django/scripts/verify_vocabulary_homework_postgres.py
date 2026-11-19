"""Verify 30-word assignment, server scoring, reports and review persistence."""
from datetime import timedelta

from verify_group_contract_postgres import actor, transaction

from django.utils import timezone

from apps.core.models import HomeworkSubmission, UserWeakWord, VocabularyAttempt
from apps.core.vocabulary_review import due


def answers_for(questions, answer_map, miss_id=None):
    return [
        {
            "wordId": item["wordId"],
            "answer": "incorrect" if item["wordId"] == miss_id else answer_map[item["wordId"]][item["type"] != "eng_uzb"],
        }
        for item in questions
    ]


@transaction.atomic
def verify():
    _, teacher = actor("teacher")
    _, other = actor("teacher")
    student_id, student = actor("student")
    _, stranger = actor("student")
    group = teacher.post("/v1/groups", {"name": "Vocabulary class"}, format="json").json()["data"]
    group_path = f"/v1/groups/{group['id']}"
    assert teacher.post(group_path + "/students", {"studentId": student_id}, format="json").status_code == 201
    words = [{"english": f"English word {index}", "uzbek": f"Uzbek word {index}"} for index in range(30)]
    response = teacher.post("/v1/vocabulary/sets", {"title": "Local 30 words", "words": words, "isPublic": False}, format="json")
    assert response.status_code == 201, response.data
    set_id = response.json()["data"]["id"]
    assert response.json()["data"]["wordCount"] == 30
    assert teacher.get(group_path + "/vocabulary-collections").json()["data"][0]["id"] == set_id
    assert other.get(group_path + "/vocabulary-collections").status_code == 403
    assert other.get(f"/v1/vocabulary/sets/{set_id}").status_code == 404
    assert student.get(f"/v1/vocabulary/sets/{set_id}").status_code == 404

    assignment = teacher.post(group_path + "/assignments", {
        "title": "Translation and spelling", "vocabulary_set_id": set_id, "min_pass_percent": 90,
    }, format="json")
    assert assignment.status_code == 201, assignment.data
    assignment_id = assignment.json()["data"]["id"]
    assert student.get("/v1/student/my-assignments").json()["data"][0]["vocabulary_set_id"] == set_id
    path = f"/v1/student/assignments/{assignment_id}/vocabulary"
    assert stranger.get(path + "/words").status_code == 403
    cards = student.get(path + "/words").json()["data"]
    answer_map = {card["id"]: (card["uzbek"], card["english"]) for card in cards}
    assert len(answer_map) == 30
    session = student.post(path, {"mode": "mixed"}, format="json").json()["data"]
    assert {item["type"] for item in session["questions"]} == {"spelling", "eng_uzb", "uzb_eng"}
    assert student.post(path, {"mode": "spelling"}, format="json").json()["data"]["sessionId"] == session["sessionId"]
    missed = session["questions"][0]["wordId"]
    request = {"sessionId": session["sessionId"], "answers": answers_for(session["questions"], answer_map, missed)}
    assert student.post(path + "/submit", {**request, "score": 100}, format="json").status_code == 400
    assert student.post(path + "/submit", {**request, "answers": request["answers"] * 2}, format="json").status_code == 400
    result = student.post(path + "/submit", request, format="json").json()["data"]
    assert result["score"] == 29 and result["totalWords"] == 30 and result["percentage"] == 96.7
    assert result["pointsAwarded"] == 0 and result["isPassed"]
    assert student.post(path + "/submit", request, format="json").json()["data"] == result
    assert HomeworkSubmission.objects.filter(assignment_id=assignment_id, student_id=student_id).count() == 1
    assert VocabularyAttempt.objects.filter(student_id=student_id, set_id=set_id).count() == 1
    assert student.post(path, {}, format="json").json()["data"]["result"] == result

    report_path = f"{group_path}/assignments/{assignment_id}/vocabulary-results"
    assert other.get(report_path).status_code == 403
    export = teacher.get(report_path + "?download=csv")
    assert export.status_code == 200 and "text/csv" in export.headers["Content-Type"]
    assert str(96.7).encode() in export.content
    assert other.get(report_path + "?download=csv").status_code == 403
    report = teacher.get(report_path).json()["data"]
    assert report["assignedCount"] == report["completedCount"] == 1
    assert report["students"][0]["percentage"] == 96.7 and report["missedWords"][0]["count"] == 1

    row = UserWeakWord.objects.get(student_id=student_id, word_id=missed)
    assert row.review_count == 1 and row.interval_days == 0
    assert not due(student_id, row.next_review_at - timedelta(microseconds=1)).exists()
    assert due(student_id, row.next_review_at).filter(word_id=missed).exists()
    UserWeakWord.objects.filter(pk=row.pk).update(next_review_at=timezone.now() - timedelta(seconds=1))
    review = student.get("/v1/vocabulary/srs/quiz").json()["data"]
    assert review["totalQuestions"] == 1
    submission = {"sessionId": review["sessionId"], "answers": answers_for(review["questions"], answer_map)}
    assert stranger.post("/v1/vocabulary/srs/submit", submission, format="json").status_code == 403
    assert student.post("/v1/vocabulary/srs/submit", submission, format="json").json()["data"]["score"] == 1
    assert student.post("/v1/vocabulary/srs/submit", submission, format="json").status_code == 409
    row.refresh_from_db()
    assert row.review_count == 2 and row.interval_days == 1 and row.next_review_at > timezone.now()
    print("PASS 30-word assignment, translation and spelling, single score, scoped results, due boundary and review replay protection")
    transaction.set_rollback(True)


if __name__ == "__main__":
    verify()
