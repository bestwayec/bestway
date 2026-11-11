"""Shaping an exam must not issue one query per section, group or question (N+1)."""
from __future__ import annotations

import io

from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup
from tests.record_mock_media import isolated_record_mock_media
from tests import test_import_cd_record_mock_1 as importer_tests


class CatalogueQueryCountTests(TestCase):
    # Reuse the importer tests' legacy-table setup (referenced via the module so
    # pytest does not collect that class a second time here).
    setUpClass = importer_tests.ImportCdRecordMock1Tests.setUpClass
    tearDownClass = importer_tests.ImportCdRecordMock1Tests.tearDownClass

    def setUp(self):
        media = isolated_record_mock_media(listening_seconds=61)
        media.__enter__()
        self.addCleanup(media.__exit__, None, None, None)
        call_command("import_cd_record_mock_1", stdout=io.StringIO())
        self.exam = MockExam.objects.get(id="MOCK-RECORD-01")
        groups = MockQuestionGroup.objects.filter(section__exam_id=self.exam.id).count()
        self.assertGreater(groups, 10)
        self.assertEqual(MockQuestion.objects.filter(group__section__exam_id=self.exam.id).count(), 81)

    def test_shape_exam_uses_a_fixed_number_of_queries(self):
        from apps.core.mock_catalog import shape_exam
        with CaptureQueriesContext(connection) as queries:
            shaped = shape_exam(self.exam, False)
        self.assertEqual(shaped["questionCount"], 81)
        self.assertLessEqual(len(queries), 3, [q["sql"][:80] for q in queries])

    def test_practice_plan_uses_a_fixed_number_of_queries(self):
        from apps.core.mock_practice import metadata
        with CaptureQueriesContext(connection) as queries:
            value = metadata(self.exam)
        self.assertTrue(value["practiceReady"])
        self.assertLessEqual(len(queries), 6, [q["sql"][:80] for q in queries])
