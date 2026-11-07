from __future__ import annotations

import io
from types import SimpleNamespace
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
        # The mirrored Multilevel definition is not public without entitlement.
        self.assertEqual(client.get("/api/v1/exams/active/").status_code, 404)
        client.force_authenticate(SimpleNamespace(id='admin', role='admin', is_authenticated=True))
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

    def test_canonical_importer_contract(self):
        from django.core.management import load_command_class
        from django.core.management.base import CommandError
        from django.test import override_settings
        import os
        import tempfile
        from unittest import mock

        # All four historic names run the same canonical command.
        classes = {load_command_class("apps.core", n).__class__ for n in
                   ("import_cd_record_mock_1", "import_record_mock_1", "seed_record_mock_1", "seed_cd_record_mock_1")}
        self.assertEqual(len(classes), 1)

        call_command("import_cd_record_mock_1", stdout=io.StringIO())
        cd_exam = Exam.objects.get(code="MOCK-RECORD-01")
        legacy_ids = set(MockQuestion.objects.filter(group__section__exam_id="MOCK-RECORD-01").values_list("id", flat=True))
        cd_ids = set(Question.objects.filter(group__section__exam=cd_exam).values_list("id", flat=True))
        # Simulator / CD-session question ids are exactly the ids a MockAttempt accepts.
        self.assertEqual(cd_ids, legacy_ids)
        self.assertEqual(len(cd_ids), 81)

        # Rows written by an older importer under other ids are pruned on re-run.
        section = cd_exam.sections.get(section_type="reading")
        stale_group = QuestionGroup.objects.create(id="stale-group", section=section, title="old", part_number=9, sort_order=99)
        Question.objects.create(id="stale-question", group=stale_group, order=99, question_type="single_choice", prompt="old")
        call_command("import_cd_record_mock_1", stdout=io.StringIO())
        self.assertFalse(Question.objects.filter(id="stale-question").exists())
        self.assertFalse(QuestionGroup.objects.filter(id="stale-group").exists())
        self.assertEqual(Question.objects.filter(group__section__exam=cd_exam).count(), 81)

        # A missing source file aborts instead of synthesising media.
        with tempfile.TemporaryDirectory() as empty, mock.patch.dict(os.environ, {"SEED_MEDIA_DIR": empty}):
            with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
                with self.assertRaises(CommandError) as ctx:
                    call_command("import_cd_record_mock_1", stdout=io.StringIO())
        self.assertIn("record_mock1_audio_part_1.wav", str(ctx.exception))

    def test_active_exam_comes_only_from_setting(self):
        from django.test import override_settings
        call_command("import_cd_record_mock_1", stdout=io.StringIO())
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id='admin', role='admin', is_authenticated=True))
        with override_settings(ACTIVE_CD_EXAM_CODE="NO-SUCH-EXAM"):
            resp = client.get("/api/v1/exams/active/")
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(resp.json()["error"]["code"], "NO_ACTIVE_EXAM")
        with override_settings(ACTIVE_CD_EXAM_CODE="MOCK-RECORD-01"):
            self.assertEqual(client.get("/api/v1/exams/active/").json()["data"]["exam"]["code"], "MOCK-RECORD-01")
