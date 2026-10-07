"""Transactional authoring primitives for Prisma-owned mock exam tables.

Write routes are wired only after their shared history/version guarantees exist.
"""
from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

from django.db import transaction
from django.utils import timezone

from apps.legacy_schema.models import MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection
from common.api.exceptions import ContractAPIException
from .auth_service import audit

STAFF = {"teacher", "admin", "super_admin"}
CURRENT_SPEC = "UZBMB_MULTILEVEL_EN_2026_V2"
CURRENT_SPEAKING_PROFILE = "BESTWAY_MULTILEVEL_SPEAKING_2026_V2"
SKILLS = ("listening", "reading", "writing", "speaking")
QUESTION_TYPES = {"multiple_choice", "multi_select", "true_false_notgiven", "yes_no_notgiven", "matching", "matching_headings", "sentence_completion", "note_completion", "summary_completion", "table_completion", "short_answer", "map_labelling", "essay_task1", "essay_task2", "speaking_task"}


def now(): return timezone.now()
def new_id(): return str(uuid4())


def locked_exam(exam_id: str) -> MockExam:
    try: return MockExam.objects.select_for_update().get(id=exam_id)
    except MockExam.DoesNotExist: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)


def assert_author(actor, exam: MockExam, *, allow_any_staff: bool = False) -> None:
    if actor.role not in STAFF: raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)
    if actor.role == "teacher" and not allow_any_staff and exam.created_by_id != actor.id:
        raise ContractAPIException("MOCK_NOT_OWNER", "Bu imtihonni tahrirlash huquqi yo‘q", 403)


def assert_mutable(exam: MockExam) -> None:
    if exam.is_published or MockAttempt.objects.filter(exam_id=exam.id).exists():
        raise ContractAPIException("MOCK_CONTENT_LOCKED", "O‘quvchilar ishlatgan kontentni o‘zgartirib bo‘lmaydi. Imtihondan nusxa oling", 409)


def bump(exam: MockExam) -> None:
    exam.content_version += 1
    exam.updated_at = now()
    exam.save(update_fields=["content_version", "updated_at"])


def multilevel_preset(exam_id: str):
    parts = {"listening": 6, "reading": 5, "writing": 3, "speaking": 4}
    duration = {"listening": 45, "reading": 60, "writing": 60, "speaking": 11}
    rows = []
    for skill_index, skill in enumerate(SKILLS):
        section = MockSection.objects.create(id=new_id(), exam_id=exam_id, skill=skill, title=skill.title(), sort_order=skill_index, duration_minutes=duration[skill], instructions=None)
        for part in range(parts[skill]):
            title = ("Task 1.1 — Informal Letter", "Task 1.2 — Formal Letter", "Task 2 — Publication")[part] if skill == "writing" else f"Part {('1.1','1.2','2','3')[part]}" if skill == "speaking" else f"Part {part + 1}"
            max_score = (5, 5, 6)[part] if skill == "writing" else (5, 5, 5, 6)[part] if skill == "speaking" else None
            rows.append(MockQuestionGroup(id=new_id(), section_id=section.id, sort_order=part, title=title, instructions=None, passage_text=None, content_html=None, audio_script=None, content_layout=None, options_reusable=None, audio_key=None, image_key=None, max_score=max_score, stimulus_ref="writing-task-1" if skill == "writing" and part < 2 else None, part_number=part + 1 if skill == "listening" else None, audio_play_limit=2 if skill == "listening" else 1, audio_duration_sec=None, created_at=now()))
    MockQuestionGroup.objects.bulk_create(rows)


def create_exam(actor, data: dict):
    exam_type = data.get("type")
    title = data.get("title")
    if exam_type not in {"ielts_academic", "ielts_general", "multilevel"} or not isinstance(title, str) or not 3 <= len(title) <= 200:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    with transaction.atomic():
        stamp = now()
        exam = MockExam.objects.create(id=new_id(), assessment_policy=data.get("assessmentPolicy"), speaking_profile_version=CURRENT_SPEAKING_PROFILE if exam_type == "multilevel" else None, specification_version=CURRENT_SPEC if exam_type == "multilevel" else None, type=exam_type, title=title, description=data.get("description"), level=data.get("level"), practice_level=data.get("practiceLevel"), is_published=False, is_demo=bool(data.get("isDemo", False)), price=data.get("price", 0), is_free_for_approved=data.get("isFreeForApproved", True), created_by_id=actor.id, created_at=stamp, updated_at=stamp, profile=data.get("profile", "practice"), blueprint_ref=None, content_version=1)
        if data.get("starterStructure"):
            if exam_type == "multilevel": multilevel_preset(exam.id)
            # IELTS starter content is intentionally not synthetic: it remains a draft.
        from .auth_service import audit
        from django.db import connection
        with connection.cursor() as cursor: audit(cursor, actor.id, "mock.exam.create", "mockExam", exam.id, new={"title": exam.title, "type": exam.type})
    return exam


def update_exam(actor, exam_id: str, data: dict):
    allowed = {"title", "description", "level", "practiceLevel", "assessmentPolicy", "isPublished", "isDemo", "price", "isFreeForApproved", "profile"}
    if set(data) - allowed: raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    with transaction.atomic():
        exam = locked_exam(exam_id); assert_author(actor, exam)
        profile_changed = "profile" in data and data["profile"] != exam.profile
        if profile_changed and MockAttempt.objects.filter(exam_id=exam_id).exists(): raise ContractAPIException("EXAM_VERSION_IN_USE", "Clone this exam before changing the profile used by attempts", 409)
        for source, target in {"title":"title", "description":"description", "level":"level", "practiceLevel":"practice_level", "assessmentPolicy":"assessment_policy", "isDemo":"is_demo", "price":"price", "isFreeForApproved":"is_free_for_approved", "profile":"profile"}.items():
            if source in data: setattr(exam, target, data[source])
        if profile_changed: exam.content_version += 1
        exam.updated_at = now(); exam.save()
        from django.db import connection
        with connection.cursor() as cursor: audit(cursor, actor.id, "mock.exam.update", "mockExam", exam.id, new=data)
    return exam
