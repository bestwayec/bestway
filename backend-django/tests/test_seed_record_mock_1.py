from __future__ import annotations

import io
from django.core.management import call_command
from django.db import connection
from django.test import TestCase

from apps.core.multilevel import blueprint_issues, readiness, CURRENT_SPEC
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


class SeedRecordMock1TestCase(TestCase):
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

    def test_import_record_mock_1_idempotent_and_schema_conforming(self):
        out = io.StringIO()
        call_command("import_record_mock_1", stdout=out)
        self.assertIn("MOCK-RECORD-01", out.getvalue())

        # 1. Exam record
        exam = MockExam.objects.get(id="MOCK-RECORD-01")
        self.assertEqual(exam.type, "multilevel")
        self.assertEqual(exam.title, "Record Mock - Test 1 (Multi-Level)")
        self.assertTrue(exam.is_published)
        self.assertEqual(exam.content_version, 2)
        self.assertEqual(exam.level, "B1-C1")

        # 2. Sections
        sections = list(MockSection.objects.filter(exam=exam).order_by("sort_order"))
        self.assertEqual(len(sections), 4)
        skills = [s.skill for s in sections]
        self.assertEqual(skills, ["listening", "reading", "writing", "speaking"])

        l_sec = sections[0]
        r_sec = sections[1]
        w_sec = sections[2]
        s_sec = sections[3]

        self.assertEqual(l_sec.duration_minutes, 45)
        self.assertEqual(r_sec.duration_minutes, 60)
        self.assertEqual(w_sec.duration_minutes, 60)
        self.assertEqual(s_sec.duration_minutes, 30)

        # 3. Listening: 6 parts, 35 questions
        l_groups = list(MockQuestionGroup.objects.filter(section=l_sec).order_by("sort_order"))
        self.assertEqual(len(l_groups), 6)
        l_questions = list(MockQuestion.objects.filter(group__section=l_sec).order_by("sort_order"))
        self.assertEqual(len(l_questions), 35)

        # Verify Listening Part 1 keys (MCQ A/B/C)
        q1 = MockQuestion.objects.get(id="mock-record-01-ql1")
        self.assertEqual(q1.correct_answers, ["C"])
        self.assertEqual(len(q1.options), 3)

        # Verify Listening Part 2 keys (note completion)
        q9 = MockQuestion.objects.get(id="mock-record-01-ql9")
        self.assertEqual(q9.correct_answers, ["coach"])
        q10 = MockQuestion.objects.get(id="mock-record-01-ql10")
        self.assertEqual(q10.correct_answers, ["lake"])

        # Verify Listening Part 3 keys (matching)
        q15 = MockQuestion.objects.get(id="mock-record-01-ql15")
        self.assertEqual(q15.correct_answers, ["A"])
        self.assertEqual(len(q15.options), 6)

        # Verify Listening Part 4 keys (map labeling)
        q19 = MockQuestion.objects.get(id="mock-record-01-ql19")
        self.assertEqual(q19.correct_answers, ["D"])
        self.assertEqual(len(q19.options), 8)
        self.assertEqual(l_groups[3].image_key, "exams/mock1/listening_part4_map.png")

        # Verify Listening Part 5 keys (MCQ)
        q24 = MockQuestion.objects.get(id="mock-record-01-ql24")
        self.assertEqual(q24.correct_answers, ["A"])
        self.assertEqual(len(q24.options), 3)

        # Verify Listening Part 6 keys (note completion)
        q30 = MockQuestion.objects.get(id="mock-record-01-ql30")
        self.assertEqual(q30.correct_answers, ["market"])

        # 4. Reading: 5 parts, 35 questions
        r_groups = list(MockQuestionGroup.objects.filter(section=r_sec).order_by("sort_order"))
        self.assertEqual(len(r_groups), 5)
        r_questions = list(MockQuestion.objects.filter(group__section=r_sec).order_by("sort_order"))
        self.assertEqual(len(r_questions), 35)

        # Part 1 Honey
        qr1 = MockQuestion.objects.get(id="mock-record-01-qr1")
        self.assertEqual(qr1.correct_answers, ["bees"])
        # Part 2 Picnic
        qr7 = MockQuestion.objects.get(id="mock-record-01-qr7")
        self.assertEqual(qr7.correct_answers, ["E"])
        self.assertEqual(len(qr7.options), 10)
        # Part 3 Headings
        qr15 = MockQuestion.objects.get(id="mock-record-01-qr15")
        self.assertEqual(qr15.correct_answers, ["E"])
        self.assertEqual(len(qr15.options), 8)
        # Part 4 A Strange Morning
        qr21 = MockQuestion.objects.get(id="mock-record-01-qr21")
        self.assertEqual(qr21.correct_answers, ["B"])
        qr25 = MockQuestion.objects.get(id="mock-record-01-qr25")
        self.assertEqual(qr25.correct_answers, ["False"])
        # Part 5 Nomads
        qr30 = MockQuestion.objects.get(id="mock-record-01-qr30")
        self.assertEqual(qr30.correct_answers, ["inspire"])
        qr34 = MockQuestion.objects.get(id="mock-record-01-qr34")
        self.assertEqual(qr34.correct_answers, ["C"])

        # 5. Writing: 3 tasks
        w_groups = list(MockQuestionGroup.objects.filter(section=w_sec).order_by("sort_order"))
        self.assertEqual(len(w_groups), 3)
        self.assertEqual(w_groups[0].stimulus_ref, w_groups[1].stimulus_ref)
        self.assertEqual(w_groups[0].max_score, 5)
        self.assertEqual(w_groups[1].max_score, 5)
        self.assertEqual(w_groups[2].max_score, 6)

        # 6. Speaking: 4 parts
        s_groups = list(MockQuestionGroup.objects.filter(section=s_sec).order_by("sort_order"))
        self.assertEqual(len(s_groups), 4)
        self.assertEqual(s_groups[0].max_score, 5)
        self.assertEqual(s_groups[1].max_score, 5)
        self.assertEqual(s_groups[1].image_key, "exams/mock1/speaking_part12_sport.png")
        self.assertEqual(s_groups[2].max_score, 5)
        self.assertEqual(s_groups[2].image_key, "exams/mock1/speaking_part2_education.png")
        self.assertEqual(s_groups[3].max_score, 6)

        s_questions = list(MockQuestion.objects.filter(group__section=s_sec).order_by("sort_order"))
        self.assertEqual(len(s_questions), 8)  # 3 + 3 + 1 + 1

        # 7. Multi-Level Blueprint Readiness
        sections_payload = []
        for s in sections:
            groups_payload = []
            for g in MockQuestionGroup.objects.filter(section=s).order_by("sort_order"):
                questions_payload = []
                for q in MockQuestion.objects.filter(group=g).order_by("sort_order"):
                    questions_payload.append({
                        "type": q.type,
                        "points": q.points,
                        "options": q.options,
                        "word_limit": q.word_limit,
                    })
                groups_payload.append({
                    "sort_order": g.sort_order,
                    "part_number": g.part_number,
                    "audio_key": g.audio_key,
                    "audio_duration_sec": g.audio_duration_sec,
                    "image_key": g.image_key,
                    "max_score": g.max_score,
                    "stimulus_ref": g.stimulus_ref,
                    "questions": questions_payload,
                })
            sections_payload.append({
                "skill": s.skill,
                "groups": groups_payload,
            })

        issues = blueprint_issues(sections_payload, full=True, specification_version=CURRENT_SPEC)
        self.assertEqual(issues, [], f"Blueprint issues found: {issues}")

        exam_payload = {
            "specification_version": CURRENT_SPEC,
            "profile": "full_mock",
            "sections": sections_payload,
        }
        res = readiness(exam_payload)
        self.assertTrue(res["supported"])
        self.assertEqual(res["issues"], [])

        # 8. Idempotency test (Run a second time)
        call_command("import_record_mock_1", stdout=io.StringIO())
        self.assertEqual(MockExam.objects.filter(id="MOCK-RECORD-01").count(), 1)
        self.assertEqual(MockSection.objects.filter(exam=exam).count(), 4)
        self.assertEqual(MockQuestion.objects.filter(group__section__exam=exam).count(), 81) # 70 + 3 + 8
