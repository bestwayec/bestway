# -*- coding: utf-8 -*-
"""Canonical importer for "Multi-Level (CEFR) Mock Test 1 (Record Mock)" (MOCK-RECORD-01).

One command owns this exam. It writes the legacy MockExam/MockSection/MockQuestionGroup/
MockQuestion rows and mirrors them into cd_* (Exam/Section/QuestionGroup/Question/AnswerKey)
with the SAME ids, so simulator/CD-session ids are accepted by mock attempts.

Idempotent: re-running updates rows in place and removes cd_* groups/questions of this exam
that no longer exist in the legacy definition. Media are copied from SEED_MEDIA_DIR
(read-only mount in Docker); a missing source file aborts the command.

Aliases: import_record_mock_1, seed_record_mock_1, seed_cd_record_mock_1.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.core.models import AnswerKey, Exam, Question, QuestionGroup, Section
from apps.core.record_mock_1_content import SeedMediaMissing, seed_record_mock_1
from apps.legacy_schema.models import (
    MockAnswer,
    MockExam,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
)

EXAM_CODE = "MOCK-RECORD-01"
EXAM_TITLE = "Multi-Level (CEFR) Mock Test 1 (Record Mock)"


def _to_cd_question_type(m_type: str, section_type: str, part_num: int) -> str:
    if section_type == "listening":
        if part_num == 1:
            return "single_choice"
        if part_num == 2 or part_num == 6:
            return "in_text_blank"
        if part_num == 3:
            return "speaker_matching"
        if part_num == 4:
            return "map_labeling"
        if part_num == 5:
            return "single_choice"
    elif section_type == "reading":
        if part_num == 1:
            return "in_text_blank"
        if part_num == 2:
            return "matching_statements"
        if part_num == 3:
            return "matching_headings"
        if part_num == 4:
            return "single_choice" if m_type == "multiple_choice" else "true_false_ng"
        if part_num == 5:
            return "summary_completion" if m_type != "multiple_choice" else "single_choice"
    elif section_type == "writing":
        return "essay"
    elif section_type == "speaking":
        return "speaking_prompt"
    return "single_choice"


class Command(BaseCommand):
    help = "Ingests and activates Multi-Level Record Mock 1 into CD models and legacy schema."

    def handle(self, *args, **options):
        self.stdout.write(self.style.NOTICE(f"=== Ingesting Real CD Exam: {EXAM_TITLE} ({EXAM_CODE}) ==="))

        # 1+2. Legacy definition (copies media from SEED_MEDIA_DIR; never synthesises files)
        try:
            seed_record_mock_1(self.stdout, self.style)
        except SeedMediaMissing as exc:
            raise CommandError(str(exc)) from exc

        # 3. Explicitly unpublish the old Gym & Vegetarian mock exam
        unpub_count = MockExam.objects.filter(id="multilevel-test-01-gym-vegetarian").update(
            is_published=False, is_demo=False
        )
        self.stdout.write(self.style.SUCCESS(f"  [OK] Unpublished old gym-vegetarian exam ({unpub_count} record updated)"))

        # 4. Fetch the seeded MockExam record
        mock_exam = MockExam.objects.filter(id=EXAM_CODE).first()
        if not mock_exam:
            raise CommandError(f"MockExam {EXAM_CODE} not found after legacy import")

        mock_exam.title = EXAM_TITLE
        mock_exam.is_published = True
        mock_exam.is_demo = True
        mock_exam.is_free_for_approved = True
        mock_exam.created_at = timezone.now()
        mock_exam.save()

        # 5. Synchronize into Managed CD Exam models (Exam, Section, QuestionGroup, Question, AnswerKey)
        with transaction.atomic():
            cd_exam, exam_created = Exam.objects.update_or_create(
                code=EXAM_CODE,
                defaults={
                    "title": EXAM_TITLE,
                    "exam_type": "CEFR_MULTILEVEL",
                    "duration_minutes": 150,
                    "is_cd_format": True,
                    "is_published": True,
                    "description": mock_exam.description,
                },
            )
            self.stdout.write(
                self.style.SUCCESS(f"  [OK] CD Exam: {cd_exam.code} ({'created' if exam_created else 'updated'})")
            )

            total_questions_synced = 0
            synced_group_ids: set[str] = set()
            synced_question_ids: set[str] = set()
            total_keys_synced = 0

            # Iterate sections from legacy MockExam
            mock_sections = MockSection.objects.filter(exam=mock_exam).order_by("sort_order")
            for s_idx, m_sec in enumerate(mock_sections):
                sec_type = m_sec.skill
                cd_sec, _ = Section.objects.update_or_create(
                    exam=cd_exam,
                    section_type=sec_type,
                    defaults={
                        "title": m_sec.title or sec_type.title(),
                        "time_limit": m_sec.duration_minutes or 35,
                        "order": s_idx,
                        "instructions": m_sec.instructions or "",
                    },
                )

                mock_groups = MockQuestionGroup.objects.filter(section=m_sec).order_by("sort_order", "part_number")
                for g_idx, m_grp in enumerate(mock_groups):
                    audio_url = f"/media/{m_grp.audio_key.lstrip('/')}" if m_grp.audio_key else ""
                    img_url = f"/media/{m_grp.image_key.lstrip('/')}" if m_grp.image_key else ""
                    if sec_type == "listening" and m_grp.part_number == 4:
                        img_url = "/media/exams/record_mock_1/map.png"

                    cd_grp, _ = QuestionGroup.objects.update_or_create(
                        id=m_grp.id,
                        section=cd_sec,
                        defaults={
                            "title": m_grp.title or f"Part {m_grp.part_number}",
                            "part_number": m_grp.part_number,
                            "sort_order": g_idx,
                            "audio_url": audio_url,
                            "media_image": img_url,
                            "passage_html": m_grp.passage_text or "",
                            "instructions": m_grp.instructions or "",
                        },
                    )

                    synced_group_ids.add(cd_grp.id)
                    mock_questions = MockQuestion.objects.filter(group=m_grp).order_by("sort_order", "number")
                    for m_q in mock_questions:
                        q_kind = _to_cd_question_type(m_q.type, sec_type, m_grp.part_number)
                        
                        # Prepare payload_json
                        payload = {}
                        if getattr(m_q, "options", None):
                            payload["options"] = m_q.options
                        if getattr(m_q, "answer_rule", None):
                            payload["answerRule"] = m_q.answer_rule
                        if sec_type == "listening" and m_grp.part_number == 4:
                            payload["imageMapRef"] = "map.png"
                        if getattr(m_q, "guidance", None):
                            payload["guidance"] = m_q.guidance

                        # Listening Part 1 prompt should be empty to prevent duplication
                        q_prompt = m_q.prompt or ""
                        if sec_type == "listening" and m_grp.part_number == 1:
                            q_prompt = ""

                        cd_q, _ = Question.objects.update_or_create(
                            id=m_q.id,
                            group=cd_grp,
                            defaults={
                                "order": m_q.number,
                                "question_type": q_kind,
                                "prompt": q_prompt,
                                "points": float(m_q.points),
                                "word_limit": m_q.word_limit,
                                "payload_json": payload,
                            },
                        )
                        synced_question_ids.add(cd_q.id)
                        total_questions_synced += 1

                        if m_q.correct_answers:
                            valid_answers = (
                                m_q.correct_answers
                                if isinstance(m_q.correct_answers, list)
                                else [str(m_q.correct_answers)]
                            )
                            if getattr(m_q, "accepted_variants", None) and isinstance(m_q.accepted_variants, list):
                                for v in m_q.accepted_variants:
                                    if v not in valid_answers:
                                        valid_answers.append(v)

                            AnswerKey.objects.update_or_create(
                                question=cd_q,
                                defaults={
                                    "valid_answers_list": valid_answers,
                                    "case_sensitive": False,
                                },
                            )
                            total_keys_synced += 1

            # Remove cd_* rows of this exam that an older importer created with other ids.
            stale_q = Question.objects.filter(group__section__exam=cd_exam).exclude(id__in=synced_question_ids)
            stale_g = QuestionGroup.objects.filter(section__exam=cd_exam).exclude(id__in=synced_group_ids)
            removed_q, _ = stale_q.delete()
            removed_g, _ = stale_g.delete()
            if removed_q or removed_g:
                self.stdout.write(self.style.WARNING(f"  [OK] Removed stale cd_* rows: {removed_q} question rows, {removed_g} group rows"))

            self.stdout.write(
                self.style.SUCCESS(
                    f"  [OK] Synchronized {total_questions_synced} questions and {total_keys_synced} answer keys to cd_exams"
                )
            )

        self.stdout.write(self.style.SUCCESS(f"=== Successfully Activated CD Exam: {EXAM_TITLE} ==="))
