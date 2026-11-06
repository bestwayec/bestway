"""Test suite for Computer-Delivered (CD) Exam Models, Seeder, and API Endpoints."""
from __future__ import annotations

import io
import json
from types import SimpleNamespace
from rest_framework.test import force_authenticate
from django.core.management import call_command
from django.db import connection
from django.test import RequestFactory, TestCase

from apps.core.cd_exam_views import get_cd_exam_session
from apps.core.models import AnswerKey, Exam, Question, QuestionGroup, Section
from apps.legacy_schema import models as legacy_models
from apps.legacy_schema.models import (
    MockExam,
    MockExamImport,
    MockImportReviewIssue,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
    User,
)

PRISMA_TABLES = (
    "User",
    "MockExam",
    "MockExamImport",
    "MockImportReviewIssue",
    "MockSection",
    "MockQuestionGroup",
    "MockQuestion",
)


class CdExamAndSeederTestCase(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._created_models = []
        existing = set(connection.introspection.table_names())
        for name in PRISMA_TABLES:
            model = getattr(legacy_models, name)
            if model._meta.db_table not in existing:
                with connection.schema_editor() as editor:
                    editor.create_model(model)
                cls._created_models.append(model)

    @classmethod
    def tearDownClass(cls):
        for model in reversed(cls._created_models):
            with connection.schema_editor() as editor:
                editor.delete_model(model)
        super().tearDownClass()

    def test_seed_cd_record_mock_1_idempotent_and_api_session(self):
        out = io.StringIO()
        call_command("seed_cd_record_mock_1", stdout=out)
        output = out.getvalue()
        self.assertIn("MOCK-RECORD-01", output)

        # 1. Exam record verification
        exam = Exam.objects.get(code="MOCK-RECORD-01")
        self.assertEqual(exam.title, "Multi-Level (CEFR) Mock Test 1 (Record Mock)")
        self.assertEqual(exam.exam_type, "CEFR_MULTILEVEL")
        self.assertTrue(exam.is_cd_format)
        self.assertEqual(exam.duration_minutes, 150)

        # 2. Sections verification
        sections = list(exam.sections.all().order_by("order"))
        self.assertEqual(len(sections), 4)
        skills = [s.section_type for s in sections]
        self.assertEqual(skills, ["listening", "reading", "writing", "speaking"])

        # 3. Questions count verification
        l_sec = exam.sections.get(section_type="listening")
        l_qs = Question.objects.filter(group__section=l_sec)
        self.assertEqual(l_qs.count(), 35)

        r_sec = exam.sections.get(section_type="reading")
        r_qs = Question.objects.filter(group__section=r_sec)
        self.assertEqual(r_qs.count(), 35)

        w_sec = exam.sections.get(section_type="writing")
        w_qs = Question.objects.filter(group__section=w_sec)
        self.assertEqual(w_qs.count(), 3)

        s_sec = exam.sections.get(section_type="speaking")
        s_qs = Question.objects.filter(group__section=s_sec)
        self.assertEqual(s_qs.count(), 8)

        # 4. Total AnswerKeys
        total_keys = AnswerKey.objects.filter(question__group__section__exam=exam).count()
        self.assertEqual(total_keys, 70)  # only objective Listening+Reading items carry keys

        # 5. Check specific AnswerKeys
        q1 = Question.objects.get(group__section=l_sec, order=1)
        self.assertEqual(q1.answer_key.valid_answers_list[0], "C")

        q9 = Question.objects.get(group__section=l_sec, order=9)
        self.assertIn("coach", q9.answer_key.valid_answers_list)

        q19 = Question.objects.get(group__section=l_sec, order=19)
        self.assertEqual(q19.answer_key.valid_answers_list[0], "D")

        q_r1 = Question.objects.get(group__section=r_sec, order=1)
        self.assertEqual(q_r1.answer_key.valid_answers_list[0], "bees")

        q_r7 = Question.objects.get(group__section=r_sec, order=7)
        self.assertEqual(q_r7.answer_key.valid_answers_list[0], "E")

        q_r15 = Question.objects.get(group__section=r_sec, order=15)
        self.assertEqual(q_r15.answer_key.valid_answers_list[0], "E")

        q_r25 = Question.objects.get(group__section=r_sec, order=25)
        self.assertEqual(q_r25.answer_key.valid_answers_list[0], "False")

        # 6. API Endpoint test
        factory = RequestFactory()
        req = factory.get(f"/api/v1/exams/{exam.code}/cd-session/")
        force_authenticate(req, user=SimpleNamespace(id='admin', role='admin', is_authenticated=True))
        resp = get_cd_exam_session(req, exam.code)
        self.assertEqual(resp.status_code, 200)

        payload = json.loads(resp.content)
        self.assertIn("data", payload)
        data = payload["data"]
        self.assertEqual(data["exam"]["code"], "MOCK-RECORD-01")
        self.assertEqual(len(data["sections"]), 4)
        self.assertEqual(len(data["parts"]), 18)  # 6 listening + 5 reading + writing + speaking parts

        total_part_qs = sum(len(p["questions"]) for p in data["parts"])
        self.assertEqual(total_part_qs, 81)

        # 7. Test idempotency (run again without error or duplicates)
        out2 = io.StringIO()
        call_command("seed_cd_record_mock_1", stdout=out2)
        self.assertEqual(Exam.objects.filter(code="MOCK-RECORD-01").count(), 1)
        self.assertEqual(Question.objects.filter(group__section__exam=exam).count(), 81)
