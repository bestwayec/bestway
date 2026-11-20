"""Verify the authorized grading queue against disposable PostgreSQL with signed sessions."""
import base64
import os
import wave
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest.mock import patch
from uuid import uuid4

from verify_group_contract_postgres import actor, bearer

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection, transaction
from rest_framework.test import APIClient
from django.utils import timezone

from apps.core.models import ClassroomEnrollment
from apps.legacy_schema.models import (
    AssessmentJob, AuditLog, Group, MockAnswer, MockAttempt, MockExam, MockQuestion, MockQuestionGroup,
    MockSection, StudentProfile, User,
)
from common.auth.jwt import issue_access


def identifier():
    return str(uuid4())


def data(response, expected=200):
    assert response.status_code == expected, (response.status_code, response.content)
    return response.json().get("data")


def verify_protected_review(teacher, other, student, teacher_id, exam_id, student_id, questions, attempts, now):
    attempt = MockAttempt.objects.create(
        id=identifier(), exam_id=exam_id, student_id=student_id, status="in_progress",
        mode="practice", flow_mode="full_test", started_at=now, anti_cheat_count=0,
    )
    attempts.append(attempt.pk)
    root = f"/v1/mock/attempts/{attempt.pk}"
    overview = f"/v1/assessment/attempts/{attempt.pk}"
    writing, _, speaking, _ = questions
    upload = f"{root}/writing/{writing}/ocr"
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRfcAAAAASUVORK5CYII=")

    def paper(path=upload, client=student):
        return client.post(path, {"images": [SimpleUploadedFile("paper.png", png, "image/png")]}, format="multipart")

    with TemporaryDirectory() as directory, patch.dict(os.environ, {"STORAGE_DIR": directory}):
        with patch("apps.core.writing_ocr.extract_text_from_images", return_value={"ocrText": "", "pages": []}):
            data(paper(client=other), 404)
            data(paper(f"{root}/writing/{speaking}/ocr"), 400)
            saved = data(paper())
        image_key, = saved["imageKeys"]
        assert image_key.startswith("private/writing-ocr/"), image_key
        page = "/v1/" + saved["imageUrls"][0].removeprefix("/api/backend/")
        audio_key = f"private/speaking_submissions/{attempt.pk}.wav"
        wav = Path(directory) / audio_key
        wav.parent.mkdir(parents=True)
        with wave.open(str(wav), "wb") as tone:
            tone.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
            tone.writeframes(b"\x01\x00" * 8000)
        MockAnswer.objects.create(
            id=identifier(), attempt=attempt, question_id=speaking, response="", audio_key=audio_key,
            is_graded=False, updated_at=now,
        )
        assert data(student.post(root + "/submit", {}, format="json"), 201)["status"] == "grading"
        from apps.core import mock_submission_snapshots
        mock_submission_snapshots.enqueue(MockAttempt.objects.select_related("exam").get(pk=attempt.pk))
        jobs = {job.skill: job for job in AssessmentJob.objects.filter(attempt=attempt)}
        assert jobs["writing"].failure_code == "ASSESSMENT_HANDWRITING_REVIEW_REQUIRED"
        writing_row = MockAnswer.objects.get(attempt=attempt, question_id=writing)
        assert writing_row.response == "" and not writing_row.is_graded
        data(paper(), 400)
        # Historical keys still resolve through the protected route, and both
        # legacy and current storage paths are blocked on the public media route.
        legacy_key = image_key.removeprefix("private/")
        legacy_file = Path(directory) / legacy_key
        legacy_file.parent.mkdir(parents=True)
        legacy_file.write_bytes(png)
        writing_row.rubric_scores["imageKeys"].append(legacy_key)
        writing_row.save(update_fields=["rubric_scores"])
        anon = APIClient(HTTP_HOST="localhost")
        data(anon.get(page), 401)
        data(other.get(page), 403)
        data(teacher.get(page.replace(f"/{writing}/", f"/{speaking}/")), 404)
        for key in (image_key, legacy_key):
            assert anon.get("/media/" + key).status_code == 404
        for url in (page, page.removesuffix("/0") + "/1"):
            response = teacher.get(url)
            assert (response.status_code, response["Cache-Control"], b"".join(response.streaming_content)) == (200, "private, no-store", png)

        speaking_job = jobs["speaking"]
        audio = f"/v1/assessment/jobs/{speaking_job.pk}/audio/{speaking}"
        data(other.get(audio), 403)
        data(teacher.get(audio.removesuffix(speaking) + writing), 404)
        for header, expected in (("bytes=0-43", wav.read_bytes()[:44]), ("bytes=-8", wav.read_bytes()[-8:])):
            response = teacher.get(audio, HTTP_RANGE=header)
            assert response.status_code == 206 and response["Cache-Control"] == "private, no-store"
            assert b"".join(response.streaming_content) == expected
        assert teacher.get(audio, HTTP_RANGE="invalid").status_code == 416

        data(teacher.post(overview + "/teacher-grade", {"writing_score": 4}, format="json"), 409)
        barrier = Barrier(2)

        def review(job, keys, value, *, competing=False):
            if competing:
                barrier.wait(timeout=10)
            reviewer = bearer(issue_access(teacher_id, "teacher"))
            return reviewer.post(f"/v1/assessment/jobs/{job.pk}/review", {
                "action": "OVERRIDE", "reason": "Verified submitted evidence", "expectedVersion": job.version,
                "parts": [{"id": part["id"], "criteria": dict.fromkeys(keys, value)} for part in job.input_snapshot["parts"]],
            }, format="json")

        from apps.core.assessment_results import keys as rubric_keys
        speaking_keys = rubric_keys(speaking_job.input_snapshot)

        def concurrent(_):
            close_old_connections()
            try:
                return review(speaking_job, speaking_keys, 6, competing=True).status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(concurrent, range(2))) == [201, 409]
        data(review(speaking_job, speaking_keys, 8), 409)
        assert MockAnswer.objects.get(attempt=attempt, question_id=speaking).score == 6
        assert not MockAnswer.objects.get(attempt=attempt, question_id=writing).is_graded
        assert data(student.get(overview))["status"] != "completed"
        data(review(jobs["writing"], rubric_keys(jobs["writing"].input_snapshot), 7), 201)
        writing_row.refresh_from_db()
        assert writing_row.score == 7 and len(writing_row.rubric_scores["imageKeys"]) == 2
        assert data(student.get(overview))["status"] == "completed"

        writing_job = jobs["writing"]
        writing_job.refresh_from_db()
        feedback = writing_job.approved_feedback
        feedback["overallStrengths"] = ["The teacher approved the handwritten response."]
        data(teacher.post(f"/v1/assessment/jobs/{writing_job.pk}/review", {
            "action": "EDIT_FEEDBACK", "expectedVersion": writing_job.version,
            "reason": "Approve feedback after reviewing both pages", "feedback": feedback,
        }, format="json"), 201)
        visible = next(job for job in data(student.get(overview))["assessments"] if job["skill"] == "writing")
        assert visible["approvedFeedback"]["overallStrengths"] == feedback["overallStrengths"]
        assert visible["finalScore"] == 7
        print("PASS: protected Writing upload, legacy and current access, Speaking ranges, concurrent review, skill scores and approved feedback")


def main():
    now = timezone.now()
    root = "/v1/teacher/submissions"
    users, groups, attempts, questions, sections, question_groups = ([] for _ in range(6))
    exam_id = identifier()
    try:
        with transaction.atomic():
            teacher_id, teacher = actor("teacher")
            other_id, other = actor("teacher")
            admin_id, admin = actor("admin")
            student_id, student = actor("student")
            parent_id, parent = actor("parent")
            users.extend((teacher_id, other_id, admin_id, student_id, parent_id))
            for owner in (teacher_id, other_id):
                groups.append(data(bearer(issue_access(owner, "teacher")).post("/v1/groups", {
                    "name": "Grading queue fixture",
                    "schedule": [{"day": "wed", "startTime": "12:00", "endTime": "13:00"}],
                }, format="json"), 201)["id"])
            with connection.cursor() as cursor:
                cursor.execute(
                    'INSERT INTO "StudentProfile" ("userId","availablePrograms","activeProgram","isApproved",'
                    '"groupId","currentPoints","linkCode","createdAt","gameQualified") '
                    "VALUES (%s, ARRAY['IELTS']::\"ExamProgram\"[], 'IELTS', true, %s, 0, %s, %s, false)",
                    [student_id, groups[0], identifier(), now],
                )
            ClassroomEnrollment.objects.create(
                student_id=student_id, group_id=groups[0], started_at=now - timedelta(days=1),
            )
            MockExam.objects.create(
                id=exam_id, title="Grading queue fixture", type="ielts_academic", profile="full_mock",
                is_published=True, is_demo=True, price=0, is_free_for_approved=True, content_version=1,
                created_by_id=admin_id, assessment_policy="MANUAL_ONLY", created_at=now, updated_at=now,
            )
            for i, skill in enumerate(("writing", "writing", "speaking", "reading")):
                section = MockSection.objects.create(
                    id=identifier(), exam_id=exam_id, skill=skill, title=skill, sort_order=i,
                ) if i != 1 else MockSection.objects.get(pk=sections[0])
                if i != 1:
                    sections.append(section.pk)
                group = MockQuestionGroup.objects.create(
                    id=identifier(), section_id=section.pk, sort_order=i, title=skill,
                    audio_play_limit=1, created_at=now,
                )
                question_groups.append(group.pk)
                questions.append(MockQuestion.objects.create(
                    id=identifier(), group_id=group.pk, number=i+1, sort_order=i,
                    type={"writing":"essay_task2", "speaking":"speaking_task", "reading":"multiple_choice"}[skill],
                    prompt=skill, points=9, correct_answers=[], accepted_variants=[], created_at=now,
                ).pk)
            for _ in range(2):
                attempts.append(MockAttempt.objects.create(
                    id="fixture_" + identifier(), exam_id=exam_id, student_id=student_id, status="grading",
                    mode="timed", flow_mode="full_test", started_at=now - timedelta(hours=1), submitted_at=now,
                    anti_cheat_count=0, submitted_sections=["writing", "speaking"],
                ).pk)
            for question, response in zip(questions, ("First essay", "Second essay", "", "choice")):
                MockAnswer.objects.create(
                    id=identifier(), attempt_id=attempts[0], question_id=question, response=response,
                    is_graded=False, audio_key="confidential/storage/key" if question == questions[2] else None,
                    feedback="unapproved feedback", updated_at=now,
                )
            MockAnswer.objects.create(
                id=identifier(), attempt_id=attempts[1], question_id=questions[0], response=" \t\n",
                is_graded=False, updated_at=now,
            )
        page = data(teacher.get(root, {"withTotal": 1, "limit": 1}))
        assert page["total"] == 2 and len(page["items"]) == 1, page
        summary = data(teacher.get(root, {"withTotal": 1, "limit": 1, "summary": 1}))
        assert summary["total"] == page["total"] and len(summary["items"]) == 1
        assert summary["items"][0]["attemptId"] == attempts[0]
        assert set(summary["items"][0]) == {"id", "attemptId", "studentName", "examTitle", "skill", "submittedAt", "status"}
        assert not data(other.get(root))
        assert data(admin.get(root, {"limit": 100})), "global admin scope"
        data(student.get(root), 403)
        data(parent.get(root), 403)
        writing, = data(teacher.get(root, {"skill": "writing"}))
        speaking, = data(teacher.get(root, {"skill": "speaking"}))
        assert writing["id"] == attempts[0] + "_writing" and speaking["id"] == attempts[0] + "_speaking"
        assert speaking["hasRecording"] and "audioUrl" not in speaking
        assert "teacherFeedback" not in writing and "studentPhone" not in writing

        path = root + "/" + writing["id"] + "/grade"
        input_data = {"questionId": writing["questionId"], "score": 5.5, "feedback": "Reviewed essay"}
        data(other.post(path, input_data, format="json"), 404)
        data(student.post(path, input_data, format="json"), 403)
        data(teacher.post(root + "/" + attempts[0] + "/grade", input_data, format="json"), 400)
        data(teacher.post(path, {**input_data, "questionId": questions[2]}, format="json"), 404)
        data(teacher.post(root + "/" + speaking["id"] + "/grade", {**input_data, "questionId": questions[2]}, format="json"), 409)

        start = Barrier(2)

        def competing_grade():
            close_old_connections()
            try:
                client = bearer(issue_access(teacher_id, "teacher"))
                start.wait(timeout=10)
                return client.post(path, input_data, format="json").status_code
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: competing_grade(), range(2)))
        assert sorted(results) == [200, 409], results
        answers = {answer.question_id: answer for answer in MockAnswer.objects.filter(attempt_id=attempts[0])}
        assert answers[writing["questionId"]].score == 5.5
        assert not answers[questions[2]].is_graded and answers[questions[2]].feedback == "unapproved feedback"
        assert MockAttempt.objects.get(pk=attempts[0]).status == "grading"
        next_writing, = data(teacher.get(root, {"skill": "writing"}))
        assert next_writing["id"] == writing["id"] and next_writing["questionId"] != writing["questionId"]
        saved = data(admin.post(path, {"questionId": next_writing["questionId"], "score": 6}, format="json"))
        assert saved["submissionStatus"] == "graded" and saved["status"] == "grading"
        assert len(data(teacher.get(root, {"status": "graded", "skill": "writing"}))) == 1

        verify_protected_review(teacher, other, student, teacher_id, exam_id, student_id, questions, attempts, now)

        StudentProfile.objects.filter(pk=student_id).update(group_id=groups[1])
        ClassroomEnrollment.objects.filter(student_id=student_id, ended_at__isnull=True).update(ended_at=now)
        ClassroomEnrollment.objects.create(student_id=student_id, group_id=groups[1], started_at=now)
        assert not data(teacher.get(root)) and not data(other.get(root))
        path = root + "/" + speaking["id"] + "/grade"
        data(other.post(path, {"questionId": questions[2], "score": 4}, format="json"), 404)
        overview = "/v1/assessment/attempts/" + attempts[0]
        data(other.get(overview), 403)
        data(other.post(overview + "/teacher-grade", {"final_score": 9}, format="json"), 403)
        print("PASS: PostgreSQL grading evidence, pagination, role and enrollment scope, embargoed fields, review isolation and concurrent replay")
    finally:
        with transaction.atomic():
            AuditLog.objects.filter(user_id__in=users).delete()
            AssessmentJob.objects.filter(attempt_id__in=attempts).delete()
            MockAnswer.objects.filter(attempt_id__in=attempts).delete()
            MockAttempt.objects.filter(pk__in=attempts).delete()
            MockQuestion.objects.filter(pk__in=questions).delete()
            MockQuestionGroup.objects.filter(pk__in=question_groups).delete()
            MockSection.objects.filter(pk__in=sections).delete()
            MockExam.objects.filter(pk=exam_id).delete()
            ClassroomEnrollment.objects.filter(group_id__in=groups).delete()
            StudentProfile.objects.filter(pk__in=users).delete()
            Group.objects.filter(pk__in=groups).delete()
            User.objects.filter(pk__in=users).delete()


if __name__ == "__main__":
    main()
