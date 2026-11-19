"""Verify 30-word assignment, server scoring, reports and review persistence."""
from datetime import timedelta
from io import BytesIO

from openpyxl import load_workbook

from verify_group_contract_postgres import actor, transaction

from django.core import signing
from django.utils import timezone

from apps.core.models import HomeworkSubmission, UserWeakWord, VocabularyAttempt, VocabularyHomeworkSession, VocabularyWord
from apps.core.vocabulary_review import due
from apps.legacy_schema.models import User


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
    studio_url = f"/v1/vocabulary/sets/{set_id}"
    collection = teacher.get(studio_url).json()["data"]
    assert collection["revision"] == 1 and len(collection["words"]) == 30
    first, second = cards[:2]
    reverse = [word["id"] for word in reversed(cards)]
    progress = path + "/flashcards"
    state = student.patch(progress, {
        "wordId": second["id"], "lastWordId": second["id"], "status": "known", "order": reverse,
    }, format="json")
    assert state.status_code == 200 and state.json()["data"]["lastStudiedAt"]
    from verify_group_contract_postgres import issue_access
    from rest_framework.test import APIClient

    second_device = APIClient(HTTP_HOST="localhost", HTTP_AUTHORIZATION=f"Bearer {issue_access(student_id, 'student')}")
    assert second_device.get(progress).json()["data"] == state.json()["data"]
    assert stranger.get(progress).status_code == 403
    assert not VocabularyAttempt.objects.filter(student_id=student_id, set_id=set_id).exists()
    answer_map = {card["id"]: (card["uzbek"], card["english"]) for card in cards}
    assert len(answer_map) == 30
    session = student.post(path, {"mode": "mixed"}, format="json").json()["data"]
    assert {item["type"] for item in session["questions"]} == {"spelling", "eng_uzb", "uzb_eng"}
    assert student.post(path, {"mode": "spelling"}, format="json").json()["data"]["sessionId"] == session["sessionId"]
    revised_words = [{**word} for word in collection["words"] if word["id"] != first["id"]]
    revised_words[0].update({"definition": "A corrected definition", "synonyms": ["Example"], "level": "A2", "uzbek": "new translation"})
    revised_words.append({"english": "new word", "uzbek": "yangi so‘z", "pronunciation": "word"})
    fields = {"revision": collection["revision"], "title": "Updated practice", "words": revised_words}
    assert other.patch(studio_url, fields, format="json").status_code == 403
    updated = teacher.patch(studio_url, fields, format="json")
    assert updated.status_code == 200, updated.data
    assert updated.json()["data"]["revision"] == 2
    assert teacher.patch(studio_url, fields, format="json").status_code == 409
    assert student.get(path + "/words").json()["data"] == cards
    assert student.get(progress).json()["data"] == state.json()["data"]
    edited = {first["id"], revised_words[0]["id"]}
    missed = next(question["wordId"] for question in session["questions"] if question["wordId"] not in edited)
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
    assert str(96.7).encode() in b"".join(export.streaming_content)
    assert other.get(report_path + "?download=csv").status_code == 403
    workbook_response = teacher.get(report_path + "?download=xlsx")
    assert workbook_response.status_code == 200 and workbook_response.headers["Content-Disposition"].endswith('.xlsx"')
    workbook = load_workbook(BytesIO(b"".join(workbook_response.streaming_content)), read_only=True)
    assert list(workbook["Results"].values)[1][1:] == (29, 30, 96.7, True)
    assert list(workbook["Difficult words"].values)[1][1] == 1
    workbook.close()
    assert other.get(report_path + "?download=xlsx").status_code == 403
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
    original_translation = row.word.uzbek
    VocabularyWord.objects.filter(pk=missed).update(uzbek="Changed after the review was issued")
    assert student.post("/v1/vocabulary/srs/submit", submission, format="json").status_code == 409
    VocabularyWord.objects.filter(pk=missed).update(uzbek=original_translation)
    assert student.post("/v1/vocabulary/srs/submit", submission, format="json").json()["data"]["score"] == 1
    assert student.post("/v1/vocabulary/srs/submit", submission, format="json").status_code == 409
    row.refresh_from_db()
    assert row.review_count == 2 and row.interval_days == 1 and row.next_review_at > timezone.now()
    history = student.get("/v1/vocabulary/srs/history").json()["data"]
    assert any(item["review__word__english"] == row.word.english for item in history["entries"])
    UserWeakWord.objects.filter(pk=row.pk).update(next_review_at=timezone.now() - timedelta(seconds=1))
    review = student.get("/v1/vocabulary/srs/quiz").json()["data"]
    salt = "bestway-vocabulary-review"
    signed = signing.loads(review["sessionId"], salt=salt)
    signed["words"] = [entry[:3] for entry in signed["words"]]
    legacy = {"sessionId": signing.dumps(signed, salt=salt), "answers": answers_for(review["questions"], answer_map)}
    assert student.post("/v1/vocabulary/srs/submit", legacy, format="json").json()["data"]["score"] == 1
    assert teacher.delete(group_path + "/students/" + student_id).status_code == 200
    assert student.get(path + "/words").status_code == 403
    persisted = student.get("/v1/student/vocabulary/history").json()["data"]["entries"]
    assert persisted[0]["assignment_id"] == assignment_id and persisted[0]["score_percent"] == 97
    transferred = teacher.get(report_path).json()["data"]["students"][0]
    assert not transferred["currentlyEnrolled"] and transferred["percentage"] == 96.7
    print("PASS 30 words, edits preserving issued revision, flashcard sync, scoped history, scoring, review and retention after transfer")

    synthetic_results = []
    for index in range(125):
        classmate, _ = actor("student")
        User.objects.filter(id=classmate).update(name=f"Pagination learner {index:03d}")
        synthetic_results.append(VocabularyHomeworkSession(
            assignment_id=assignment_id, student_id=classmate, mode="mixed", questions=[], result=result,
        ))
    VocabularyHomeworkSession.objects.bulk_create(synthetic_results)
    pages = [teacher.get(report_path, {"limit": 50, "page": page}).json()["data"] for page in range(1, 4)]
    assert [len(page["students"]) for page in pages] == [50, 50, 26]
    assert [page["hasNext"] for page in pages] == [True, True, False]
    assert len({row["studentId"] for page in pages for row in page["students"]}) == 126
    assert all(page["assignedCount"] == page["completedCount"] == 126 for page in pages)
    search = teacher.get(report_path, {"search": "learner 124"}).json()["data"]
    assert [row["name"] for row in search["students"]] == ["Pagination learner 124"]
    for extension in ("csv", "xlsx"):
        response = teacher.get(report_path, {"download": extension})
        assert response.status_code == 200 and response.streaming
        assert sum(map(len, response.streaming_content)) > 1000
    print("PASS stable report pagination, search and streamed export with 126 completed learners")
    transaction.set_rollback(True)


if __name__ == "__main__":
    verify()
