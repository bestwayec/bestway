from __future__ import annotations

import io
from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from rest_framework.test import APIClient

from apps.core.models import AnswerKey, Exam, Question, QuestionGroup, Section
from apps.legacy_schema import models as legacy_models
from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection

PRISMA_TABLES = (
    "User",
    "MockExam",
    "MockExamImport",
    "MockImportReviewIssue",
    "MockSection",
    "MockQuestionGroup",
    "MockQuestion",
)


class ImportCdRecordMock1Tests(TestCase):
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

    def test_import_cd_record_mock_1_command_and_endpoints(self):
        # 1. Run the management command
        out = io.StringIO()
        call_command("import_cd_record_mock_1", stdout=out)
        output = out.getvalue()
        self.assertIn("MOCK-RECORD-01", output)

        # 2. Verify CD Exam model
        cd_exam = Exam.objects.get(code="MOCK-RECORD-01")
        self.assertEqual(cd_exam.title, "Multi-Level (CEFR) Mock Test 1 (Record Mock)")
        self.assertTrue(cd_exam.is_published)
        self.assertTrue(cd_exam.is_cd_format)

        # 3. Verify sections: Listening (35 Qs), Reading (35 Qs), Writing, Speaking
        sections = list(cd_exam.sections.all().order_by("order"))
        self.assertEqual(len(sections), 4)
        sec_types = [s.section_type for s in sections]
        self.assertEqual(sec_types, ["listening", "reading", "writing", "speaking"])

        # 4. Verify Listening Part 4 (Map image binding)
        l_sec = sections[0]
        l_groups = list(l_sec.groups.all().order_by("sort_order"))
        self.assertEqual(len(l_groups), 6)
        part4 = l_groups[3]
        self.assertEqual(part4.part_number, 4)
        self.assertIn("map.png", part4.media_image)

        # 5. Verify Listening Part 1 prompt deduplication (prompt should be empty)
        q1 = Question.objects.get(id="mock-record-01-ql1")
        self.assertEqual(q1.prompt, "")
        self.assertEqual(q1.order, 1)

        # 6. Verify Answer Keys
        ak1 = AnswerKey.objects.get(question=q1)
        self.assertIn("C", ak1.valid_answers_list)

        # 7. Test active CD exam endpoint: GET /api/v1/exams/active/
        client = APIClient()
        resp_active = client.get("/api/v1/exams/active/")
        self.assertEqual(resp_active.status_code, 200)
        data_active = resp_active.json()["data"]
        self.assertEqual(data_active["exam"]["code"], "MOCK-RECORD-01")
        self.assertEqual(len(data_active["sections"]), 4)

        # 8. Test mock list endpoint: GET /api/v1/exams/mock-list/
        resp_list = client.get("/api/v1/exams/mock-list/")
        self.assertEqual(resp_list.status_code, 200)
        items = resp_list.json()["data"]
        self.assertTrue(any(i["code"] == "MOCK-RECORD-01" for i in items))
        self.assertFalse(any(i["code"] == "multilevel-test-01-gym-vegetarian" for i in items))
