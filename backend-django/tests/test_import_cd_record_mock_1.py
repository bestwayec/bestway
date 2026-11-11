from __future__ import annotations

import io
from types import SimpleNamespace
from django.core.management import call_command
from django.db import connection
from django.test import TestCase

from tests.record_mock_media import isolated_record_mock_media
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

    def setUp(self):
        super().setUp()
        # Real-length synthetic recordings in temp dirs: the publish path is tested
        # without touching backend/storage or treating repository fixtures as real.
        media = isolated_record_mock_media(listening_seconds=61)
        self.seed_root, self.media_root = media.__enter__()
        self.addCleanup(media.__exit__, None, None, None)

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


class RecordMockPlaceholderAudioTests(TestCase):
    """The 8-second repository WAVs must never be served or published as exam audio."""

    setUpClass = ImportCdRecordMock1Tests.setUpClass
    tearDownClass = ImportCdRecordMock1Tests.tearDownClass

    def test_placeholder_audio_is_not_copied_and_exam_stays_unpublished(self):
        with isolated_record_mock_media(listening_seconds=8) as (_seed, media_root):
            out = io.StringIO()
            call_command("import_cd_record_mock_1", stdout=out)
            self.assertFalse(any((media_root / "multilevel/assets").glob("*.wav")))
        self.assertFalse(MockExam.objects.get(id="MOCK-RECORD-01").is_published)
        self.assertFalse(MockExam.objects.get(id="MOCK-RECORD-01").is_demo)
        self.assertFalse(Exam.objects.get(code="MOCK-RECORD-01").is_published)
        self.assertIn("BLOCKED", out.getvalue())
        self.assertIn("record_mock1_audio_part_6.wav", out.getvalue())
        # The simulator's active-exam endpoint does not offer the blocked exam.
        self.assertEqual(APIClient().get("/v1/exams/active").status_code, 404)

    def test_existing_media_is_never_overwritten(self):
        from django.core.management.base import CommandError
        from tests.record_mock_media import write_silent_wav
        with isolated_record_mock_media(listening_seconds=8) as (_seed, media_root):
            authored = media_root / "multilevel/assets/record_mock1_audio_part_1.wav"
            write_silent_wav(authored, 300)
            before = authored.read_bytes()
            with self.assertRaises(CommandError):
                call_command("import_cd_record_mock_1", stdout=io.StringIO())
            self.assertEqual(authored.read_bytes(), before)
        self.assertFalse(MockExam.objects.filter(id="MOCK-RECORD-01", is_published=True).exists())

    def test_real_recordings_from_the_seed_source_publish_the_exam(self):
        with isolated_record_mock_media(listening_seconds=300) as (_seed, media_root):
            call_command("import_cd_record_mock_1", stdout=io.StringIO())
            self.assertEqual(len(list((media_root / "multilevel/assets").glob("*.wav"))), 6)
        self.assertTrue(MockExam.objects.get(id="MOCK-RECORD-01").is_published)
        self.assertTrue(Exam.objects.get(code="MOCK-RECORD-01").is_published)

    def test_placeholder_media_already_served_keeps_the_exam_unpublished(self):
        from apps.core.record_mock_1_content import listening_audio_blockers
        from tests.record_mock_media import write_silent_wav
        with isolated_record_mock_media(listening_seconds=8) as (_seed, media_root):
            for n in range(1, 7):
                write_silent_wav(media_root / f"multilevel/assets/record_mock1_audio_part_{n}.wav", 8)
            self.assertEqual(len(listening_audio_blockers(media_root)), 6)

    def test_placeholder_override_is_refused_outside_a_local_database(self):
        from django.core.management.base import CommandError
        from django.db import connection
        from unittest import mock
        # Pin a non-local name: the test database is named after DATABASE_URL, so on a developer stack
        # (education_center_local -> test_education_center_local) the guard would rightly allow it.
        with isolated_record_mock_media(listening_seconds=8), mock.patch.dict(connection.settings_dict, {"NAME": "education_center"}):
            with self.assertRaises(CommandError) as ctx:
                call_command("import_cd_record_mock_1", "--allow-placeholder-audio", stdout=io.StringIO())
        self.assertIn("_local", str(ctx.exception))
        self.assertFalse(MockExam.objects.filter(id="MOCK-RECORD-01").exists())
