"""Exercise standalone vocabulary with real JWTs and independent PostgreSQL connections."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from verify_group_contract_postgres import actor

from django.db import connection, connections
from rest_framework.test import APIClient

from apps.core.models import UserWeakWord, VocabularyAttempt, VocabularyPracticeSession, VocabularySet
from apps.legacy_schema.models import PointsLog, StudentProfile
from common.auth.jwt import issue_access


def client(student_id):
    return APIClient(HTTP_HOST="localhost", HTTP_AUTHORIZATION=f"Bearer {issue_access(student_id, 'student')}")


def parallel(student_id, path, payloads):
    barrier = Barrier(len(payloads))

    def submit(body):
        try:
            api = client(student_id)
            barrier.wait(timeout=15)
            response = api.post(path, body, format="json")
            assert response.status_code == 200, response.data
            return response.json()["data"]
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=len(payloads)) as pool:
        return list(pool.map(submit, payloads))


def verify():
    teacher_id, teacher = actor("teacher")
    student_id, student = actor("student")
    other_id, other = actor("student")
    try:
        words = [{"english": f"word {n}", "uzbek": f"tarjima {n}"} for n in range(5)]
        created = teacher.post("/v1/vocabulary/sets", {"title": "Practice verification", "words": words}, format="json")
        assert created.status_code == 201, created.data
        set_id = created.json()["data"]["id"]
        # A learner's private personal collection can be practiced without a StudentProfile.
        VocabularySet.objects.filter(id=set_id).update(created_by_id=student_id, is_public=False)
        path = f"/v1/vocabulary/sets/{set_id}"
        assert not StudentProfile.objects.filter(user_id=student_id).exists()
        known = {row["english"]: row["uzbek"] for row in words}

        def issue(explicit=True):
            params = {"mode": "eng_uzb"}
            if explicit:
                params["session"] = "explicit"
            response = student.get(path + "/quiz", params)
            assert response.status_code == 200, response.data
            issued = response.json()["data"]
            return {
                "sessionId": issued["sessionId"],
                "mode": "eng_uzb",
                "answers": [{"wordId": q["wordId"], "type": q["type"], "answer": known[q["prompt"]]}
                            for q in issued["questions"]],
            }

        body = issue()
        assert other.post(path + "/submit", body, format="json").status_code == 404
        # A personal set is private. Asserting ownership again at the session boundary is
        # independent of that collection check.
        from apps.core.vocabulary_service import submit_quiz_attempt
        from common.api.exceptions import ContractAPIException
        from types import SimpleNamespace
        try:
            submit_quiz_attempt(SimpleNamespace(id=other_id), set_id, "eng_uzb", body["answers"], body["sessionId"])
        except ContractAPIException as error:
            assert error.status_code == 409
        else:
            raise AssertionError("A different account used the practice ID")

        invalid_answers = [
            [{**body["answers"][0], "type": "uzb_eng"}, *body["answers"][1:]],
            [{**body["answers"][0], "wordId": "different-set"}, *body["answers"][1:]],
            [body["answers"][1], *body["answers"][1:]],
            [{**body["answers"][0], "answer": "x" * 501}, *body["answers"][1:]],
        ]
        for answers in invalid_answers:
            assert student.post(path + "/submit", {**body, "answers": answers}, format="json").status_code == 400
        assert student.post(path + "/submit", {**body, "mode": "spelling"}, format="json").status_code == 400
        assert not VocabularyAttempt.objects.filter(student_id=student_id).exists()

        # Fail after grading and review writes to verify the entire transaction rolls back.
        with patch("apps.core.vocabulary_service.PointsLog.objects.create", side_effect=RuntimeError("synthetic rollback")):
            assert student.post(path + "/submit", body, format="json").status_code == 500
        assert not VocabularyAttempt.objects.filter(student_id=student_id).exists()
        assert not UserWeakWord.objects.filter(student_id=student_id).exists()
        assert not StudentProfile.objects.filter(user_id=student_id).exists()
        assert VocabularyPracticeSession.objects.get(id=body["sessionId"]).result is None

        pair = parallel(student_id, path + "/submit", [body, body])
        assert pair[0] == pair[1] and pair[0]["pointsAwarded"] == 5
        assert StudentProfile.objects.get(user_id=student_id).current_points == 5
        assert PointsLog.objects.filter(student_id=student_id).count() == 1

        responses = parallel(student_id, path + "/submit", [issue() for _ in range(10)])
        assert len({row["attemptId"] for row in responses}) == 10
        assert all(row["pointsAwarded"] == 0 for row in responses)
        assert StudentProfile.objects.get(user_id=student_id).current_points == 5
        assert PointsLog.objects.filter(student_id=student_id).count() == 1

        legacy = issue(explicit=False)
        assert issue(explicit=False)["sessionId"] == legacy.pop("sessionId")
        first = student.post(path + "/submit", legacy, format="json")
        second = student.post(path + "/submit", legacy, format="json")
        assert first.status_code == second.status_code == 200
        assert first.json() == second.json()
        assert VocabularyAttempt.objects.filter(student_id=student_id).count() == 12
        print("PASS validation, cross-account session binding, atomic rollback, absent profile, 2 simultaneous replays, 10 parallel sessions, older-client retry")
    finally:
        VocabularySet.objects.filter(created_by_id__in=[teacher_id, student_id]).delete()
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "User" WHERE "id" IN (%s, %s, %s)', [teacher_id, student_id, other_id])


if __name__ == "__main__":
    verify()
