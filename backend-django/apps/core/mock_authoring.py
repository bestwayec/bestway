"""Transactional authoring primitives for Prisma-owned mock exam tables.

Write routes are wired only after their shared history/version guarantees exist.
"""
from __future__ import annotations

import re
from uuid import uuid4

from django.db import IntegrityError, connection, transaction
from django.db.models import Q
from django.utils import timezone

from apps.legacy_schema.models import AssessmentJob, MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection
from common.api.exceptions import ContractAPIException
from .auth_service import audit
from .mock_rules import MANUAL_TYPES, QUESTION_TYPES, objective_group_issues, objective_question_issues
from .multilevel import CURRENT_SPEC, CURRENT_SPEAKING_PROFILE, SPECS, authored


def _student_question_payload(question, group) -> dict:
    """Student-facing payloads must never expose correct answers, accepted
    variants, or hidden rubric data."""
    value = {
        "id": question.id, "number": question.number, "sortOrder": question.sort_order,
        "type": question.type, "prompt": question.prompt, "options": question.options,
        "points": question.points, "wordLimit": question.word_limit, "answerRule": question.answer_rule,
    }
    return value


def _staff_answer_payload(question) -> dict:
    """Staff/author payloads keep answer keys and rubric-adjacent fields."""
    return {
        "correctAnswers": getattr(question, "correct_answers", None),
        "acceptedVariants": getattr(question, "accepted_variants", None),
        "audioScript": getattr(question, "audio_script", None),
    }


def _fake_history_return(has_history: bool):
    def _history(exam_id: str) -> dict:
        return {
            "attemptCount": 1 if has_history else 0,
            "activeAttemptCount": 1 if has_history else 0,
            "completedAttemptCount": 0,
            "submissionCount": 1 if has_history else 0,
            "resultCount": 0,
            "historyExists": has_history,
        }
    return _history


def patch_history(*, has_history: bool):
    """Context helper for tests that need to control history-existence checks
    without touching real rows."""
    import apps.core.mock_authoring as _m
    class _patch:
        def __init__(self, has_history):
            self.has_history = has_history
            self._original = None

        def __enter__(self):
            self._original = _m._history
            _m._history = _fake_history_return(self.has_history)
            return self

        def __exit__(self, *args):
            _m._history = self._original
    return _patch(has_history)


def _patch_transaction_for_tests():
    """Temporary monkeypatch that makes django.db.transaction.atomic a no-op
    context manager suitable for lightweight unit tests that should not open
    a real database connection.

    This helper is intentionally unused by the current structural test suite,
    which covers only pure-layer readiness and answer-key sanitization paths.
    ORM-touching create/clone/repair contracts are validated once the
    integration suite runs against a real PostgreSQL database."""
    import django.db.transaction as _t

    class _noop_atomic:
        def __init__(self,*_a,**_k):
            pass

        def __enter__(self):
            return None

        def __exit__(self,*_a):
            return None

    _t.atomic = _noop_atomic
    return _t


def multilevel_readiness(tree: dict) -> dict:
    from .multilevel import readiness as versioned_readiness
    return versioned_readiness(tree)

STAFF = {"teacher", "admin", "super_admin"}
SKILLS = ("listening", "reading", "writing", "speaking")
AUTO_SKILLS = {"listening", "reading"}
IELTS_MANUAL_POINTS = 9


def now(): return timezone.now()
def new_id(): return str(uuid4())


def locked_exam(exam_id: str) -> MockExam:
    try: return MockExam.objects.select_for_update().get(id=exam_id)
    except MockExam.DoesNotExist: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)


def assert_author(actor, exam: MockExam, *, allow_any_staff: bool = False) -> None:
    if actor.role not in STAFF: raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)
    if actor.role == "teacher" and not allow_any_staff and exam.created_by_id != actor.id:
        raise ContractAPIException("MOCK_NOT_OWNER", "Bu imtihonni faqat yaratgan o‘qituvchi (yoki admin) tahrirlay oladi", 403)


def assert_mutable(exam: MockExam) -> None:
    if exam.is_published:
        raise ContractAPIException("MOCK_CONTENT_LOCKED", "Unpublish an unused draft or clone this exam before editing published content", 409)
    if MockAttempt.objects.filter(exam_id=exam.id).exists():
        raise ContractAPIException("EXAM_VERSION_IN_USE", "Clone this exam before editing content used by attempts", 409)


def bump(exam: MockExam) -> None:
    exam.content_version += 1
    exam.updated_at = now()
    exam.save(update_fields=["content_version", "updated_at"])


def audit_event(actor, action: str, entity: str, entity_id: str | None, *, old=None, new=None) -> None:
    with connection.cursor() as cursor:
        audit(cursor, actor.id, action, entity, entity_id, old=old, new=new)


def _assert_question(question: dict, is_auto: bool, *, complete: bool = True) -> None:
    if question.get("type") not in QUESTION_TYPES:
        raise ContractAPIException("VALIDATION_ERROR", "Savol turi noto‘g‘ri", 400)
    number = question.get("number")
    if not isinstance(number, int) or isinstance(number, bool) or not 1 <= number <= 200:
        raise ContractAPIException("VALIDATION_ERROR", "Savol raqami 1 dan 200 gacha bo‘lishi kerak", 400)
    issues = objective_question_issues(question, is_auto, complete=complete)
    if issues:
        raise ContractAPIException("VALIDATION_ERROR", "; ".join(issues), 400)


def _resolve_points(exam_type: str, is_auto: bool, value, prefix: str = "") -> int:
    if exam_type in {"ielts_academic", "ielts_general"} and not is_auto:
        if value is not None and value != IELTS_MANUAL_POINTS:
            raise ContractAPIException(
                "VALIDATION_ERROR",
                f"{prefix}IELTS Writing/Speaking savoli uchun points aynan {IELTS_MANUAL_POINTS} bo'lsin (band shkalasi 0–9, qo'lda baholash)",
                400,
            )
        return IELTS_MANUAL_POINTS
    return value if value is not None else 1


def _group_payload(data: dict) -> dict:
    mapping = {"sortOrder": "sort_order", "title": "title", "instructions": "instructions", "passageText": "passage_text", "contentHtml": "content_html", "audioScript": "audio_script", "contentLayout": "content_layout", "optionsReusable": "options_reusable", "maxScore": "max_score", "stimulusRef": "stimulus_ref", "partNumber": "part_number", "audioDurationSec": "audio_duration_sec", "audioPlayLimit": "audio_play_limit"}
    values = {target: data[source] for source, target in mapping.items() if source in data}
    from .mock_content import sanitize_content, assert_draft_gaps
    for field in ('content_html', 'audio_script'):
        if field in values:
            values[field] = sanitize_content(values[field])
    if 'content_html' in values:
        assert_draft_gaps(values['content_html'])
    return values


def _question_payload(data: dict, exam: MockExam, skill: str, *, complete: bool = True) -> dict:
    is_auto = skill in AUTO_SKILLS
    _assert_question(data, is_auto, complete=complete)
    payload = {"number": data["number"], "type": data["type"], "prompt": data.get("prompt", "").strip(), "options": data.get("options"), "correct_answers": data.get("correctAnswers"), "accepted_variants": data.get("acceptedVariants"), "word_limit": data.get("wordLimit"), "answer_rule": data.get("answerRule"), "points": _resolve_points(exam.type, is_auto, data.get("points"))}
    if "sortOrder" in data: payload["sort_order"] = data["sortOrder"]
    return payload


def _locked_mutation(actor, exam_id: str, action, *, save_contract=False):
    """Serialize every definition edit through the exam row and shared version."""
    with transaction.atomic():
        exam = locked_exam(exam_id)
        if save_contract:
            if actor.role not in STAFF or (actor.role == 'teacher' and exam.created_by_id != actor.id):
                raise ContractAPIException('MOCK_NOT_OWNER', 'Bu imtihonni tahrirlash huquqi yo‘q', 403)
            if exam.is_published or MockAttempt.objects.filter(exam_id=exam.id).exists():
                raise ContractAPIException('MOCK_CONTENT_LOCKED', 'O‘quvchilar ishlatgan kontentni o‘zgartirib bo‘lmaydi. Imtihondan nusxa oling', 409)
        else:
            assert_author(actor, exam)
            assert_mutable(exam)
        result = action(exam)
        bump(exam)
        return result


def _exam_tree(exam: MockExam) -> dict:
    sections = list(MockSection.objects.filter(exam_id=exam.id).order_by("sort_order", "id"))
    groups = list(MockQuestionGroup.objects.filter(section__in=sections).order_by("sort_order", "id"))
    questions = list(MockQuestion.objects.filter(group__in=groups).order_by("sort_order", "number", "id"))
    group_map = {group.id: {"id": group.id, "sort_order": group.sort_order, "part_number": group.part_number, "audio_key": group.audio_key, "audio_duration_sec": group.audio_duration_sec, "image_key": group.image_key, "max_score": group.max_score, "stimulus_ref": group.stimulus_ref, "questions": []} for group in groups}
    for question in questions:
        group_map[question.group_id]["questions"].append({"id": question.id, "sort_order": question.sort_order, "type": question.type, "points": question.points, "options": question.options, "word_limit": question.word_limit})
    return {"specification_version": exam.specification_version, "profile": exam.profile, "sections": [{"id": section.id, "skill": section.skill, "title": section.title, "instructions": section.instructions, "sort_order": section.sort_order, "groups": [group_map[group.id] for group in groups if group.section_id == section.id]} for section in sections]}


def exam_payload(exam: MockExam) -> dict:
    """Prisma-compatible mutation response for a MockExam row."""
    return {
        "id": exam.id, "assessmentPolicy": exam.assessment_policy,
        "speakingProfileVersion": exam.speaking_profile_version,
        "specificationVersion": exam.specification_version, "type": exam.type,
        "title": exam.title, "description": exam.description, "level": exam.level,
        "practiceLevel": exam.practice_level, "isPublished": exam.is_published,
        "isDemo": exam.is_demo, "price": exam.price,
        "isFreeForApproved": exam.is_free_for_approved,
        "createdById": exam.created_by_id, "createdAt": exam.created_at,
        "updatedAt": exam.updated_at, "profile": exam.profile,
        "blueprintRef": exam.blueprint_ref, "contentVersion": exam.content_version,
    }


def section_payload(section: MockSection) -> dict:
    return {
        "id": section.id, "examId": section.exam_id, "skill": section.skill,
        "title": section.title, "sortOrder": section.sort_order,
        "durationMinutes": section.duration_minutes, "instructions": section.instructions,
    }


def group_payload(group: MockQuestionGroup, *, questions=None) -> dict:
    value = {
        "id": group.id, "sectionId": group.section_id, "sortOrder": group.sort_order,
        "title": group.title, "instructions": group.instructions,
        "passageText": group.passage_text, "contentHtml": group.content_html,
        "audioScript": group.audio_script, "contentLayout": group.content_layout,
        "optionsReusable": group.options_reusable, "audioKey": group.audio_key,
        "imageKey": group.image_key, "maxScore": group.max_score,
        "stimulusRef": group.stimulus_ref, "partNumber": group.part_number,
        "audioPlayLimit": group.audio_play_limit,
        "audioDurationSec": group.audio_duration_sec, "createdAt": group.created_at,
    }
    if questions is not None:
        value["questions"] = [question_payload(question) for question in questions]
    return value


def question_payload(question: MockQuestion) -> dict:
    return {
        "id": question.id, "groupId": question.group_id, "number": question.number,
        "sortOrder": question.sort_order, "type": question.type,
        "prompt": question.prompt, "options": question.options,
        "correctAnswers": question.correct_answers,
        "acceptedVariants": question.accepted_variants, "points": question.points,
        "wordLimit": question.word_limit, "answerRule": question.answer_rule,
        "createdAt": question.created_at,
    }


def multilevel_preset(exam_id: str, skills=None):
    specification = SPECS[CURRENT_SPEC]
    selected = set(skills or SKILLS)
    rows = []
    for skill_index, skill in enumerate(SKILLS):
        if skill not in selected:
            continue
        section = MockSection.objects.create(id=new_id(), exam_id=exam_id, skill=skill, title=skill.title(), sort_order=skill_index, duration_minutes=specification[skill]["duration"], instructions=None)
        for part, (key, _count, _types, raw_max) in enumerate(specification[skill]["parts"]):
            title = {"informal_email": "Task 1.1 — Informal Letter", "formal_email": "Task 1.2 — Formal Letter", "publication": "Task 2 — Publication"}.get(key, f"Part {key}")
            rows.append(MockQuestionGroup(id=new_id(), section_id=section.id, sort_order=part, title=title, instructions=None, passage_text=None, content_html=None, audio_script=None, content_layout=None, options_reusable=None, audio_key=None, image_key=None, max_score=raw_max if skill in {"writing", "speaking"} else None, stimulus_ref="writing-task-1" if skill == "writing" and part < 2 else None, part_number=part + 1 if skill == "listening" else None, audio_play_limit=2 if skill == "listening" else 1, audio_duration_sec=None, created_at=now()))
    MockQuestionGroup.objects.bulk_create(rows)


def ielts_preset(exam_id: str, skills=None):
    """Port NestJS starterSections: editable blocks, never invented questions."""
    selected = set(skills or SKILLS)
    counts = {"listening": 4, "reading": 3, "writing": 2, "speaking": 3}
    rows = []
    for skill_index, skill in enumerate(SKILLS):
        if skill not in selected:
            continue
        section = MockSection.objects.create(id=new_id(), exam_id=exam_id, skill=skill, title=skill.title(), sort_order=skill_index, duration_minutes=60 if skill in {"reading", "writing"} else None, instructions=None)
        unit = "Passage" if skill == "reading" else "Task" if skill == "writing" else "Part"
        for index in range(counts[skill]):
            rows.append(MockQuestionGroup(id=new_id(), section_id=section.id, sort_order=index, title=f"{unit} {index + 1}", instructions=None, passage_text=None, content_html=None, audio_script=None, content_layout=None, options_reusable=None, audio_key=None, image_key=None, max_score=None, stimulus_ref=None, part_number=index + 1 if skill == "listening" else None, audio_play_limit=1, audio_duration_sec=None, created_at=now()))
    MockQuestionGroup.objects.bulk_create(rows)


def create_exam(actor, data: dict):
    exam_type = data.get("type")
    title = data.get("title")
    if exam_type not in {"ielts_academic", "ielts_general", "multilevel"} or not isinstance(title, str) or not 3 <= len(title) <= 200:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    skills = data.get("skills")
    if isinstance(skills, list) and not skills:
        raise ContractAPIException("VALIDATION_ERROR", "skills must contain at least 1 elements", 400)
    with transaction.atomic():
        stamp = now()
        exam = MockExam.objects.create(id=new_id(), assessment_policy=data.get("assessmentPolicy"), speaking_profile_version=CURRENT_SPEAKING_PROFILE if exam_type == "multilevel" else None, specification_version=CURRENT_SPEC if exam_type == "multilevel" else None, type=exam_type, title=title, description=data.get("description"), level=data.get("level"), practice_level=data.get("practiceLevel"), is_published=False, is_demo=bool(data.get("isDemo", False)), price=data.get("price", 0), is_free_for_approved=data.get("isFreeForApproved", True), created_by_id=actor.id, created_at=stamp, updated_at=stamp, profile=data.get("profile", "practice"), blueprint_ref=None, content_version=1)
        if data.get("starterStructure"):
            if exam_type == "multilevel": multilevel_preset(exam.id, data.get("skills"))
            else: ielts_preset(exam.id, data.get("skills"))
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
        requires_readiness = data.get("isPublished") is True or (exam.is_published and data.get("isPublished") is not False and profile_changed)
        if requires_readiness:
            report = readiness(actor, exam_id, effective_profile=data.get("profile"))
            if not report["ready"]:
                bad = '; '.join(item['detail'] or item['key'] for item in report['items'] if not item['ok'])
                raise ContractAPIException("MOCK_NOT_READY", f"Exam not ready to publish: {bad}", 400)
        updated_fields = []
        for source, target in {"title":"title", "description":"description", "level":"level", "practiceLevel":"practice_level", "assessmentPolicy":"assessment_policy", "isDemo":"is_demo", "price":"price", "isFreeForApproved":"is_free_for_approved", "profile":"profile", "isPublished":"is_published"}.items():
            if source in data:
                setattr(exam, target, data[source])
                updated_fields.append(target)
        if profile_changed:
            exam.content_version += 1
            updated_fields.append("content_version")
        exam.updated_at = now()
        exam.save(update_fields=[*dict.fromkeys(updated_fields), "updated_at"])
        from django.db import connection
        with connection.cursor() as cursor: audit(cursor, actor.id, "mock.exam.update", "mockExam", exam.id, new=data)
    return exam


def delete_exam(actor, exam_id: str):
    """Delete an unused draft definition.

    The HTTP contract restricts this operation to super-admins. Keeping the
    same guard here prevents accidental privilege expansion from non-HTTP
    callers as well.
    """
    if actor.role != "super_admin":
        raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)
    with transaction.atomic():
        exam = locked_exam(exam_id)
        assert_author(actor, exam)
        assert_mutable(exam)
        old = {"title": exam.title}
        keys = list(MockQuestionGroup.objects.filter(section__exam_id=exam.id).values_list('audio_key', 'image_key'))
        exam.delete()
        _cleanup_media_after_commit(keys)
    audit_event(actor, "mock.exam.delete", "mockExam", exam_id, old=old)
    return {"deleted": True}


def create_section(actor, exam_id: str, data: dict):
    skill = data.get("skill")
    if skill not in SKILLS:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    def write(exam):
        if MockSection.objects.filter(exam_id=exam.id, skill=skill).exists():
            raise ContractAPIException("MOCK_SECTION_EXISTS", "Bu bo‘lim allaqachon mavjud", 409)
        return MockSection.objects.create(id=new_id(), exam_id=exam.id, skill=skill, title=data.get("title"), sort_order=data.get("sortOrder", SKILLS.index(skill)), duration_minutes=data.get("durationMinutes"), instructions=data.get("instructions"))
    section = _locked_mutation(actor, exam_id, write)
    audit_event(actor, "mock.section.create", "mockSection", section.id, new={"examId": exam_id, "skill": skill})
    return section


def update_section(actor, section_id: str, data: dict):
    try: section = MockSection.objects.get(id=section_id)
    except MockSection.DoesNotExist: raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo'lim topilmadi", 404)
    fields = {"title": "title", "sortOrder": "sort_order", "durationMinutes": "duration_minutes", "instructions": "instructions"}
    def write(_exam):
        for source, target in fields.items():
            if source in data: setattr(section, target, data[source])
        updated = [target for source, target in fields.items() if source in data]
        if updated: section.save(update_fields=updated)
        return section
    result = _locked_mutation(actor, section.exam_id, write)
    audit_event(actor, "mock.section.update", "mockSection", section_id)
    return result


def delete_section(actor, section_id: str):
    try: section = MockSection.objects.get(id=section_id)
    except MockSection.DoesNotExist: raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo'lim topilmadi", 404)
    def remove(_exam):
        keys = list(MockQuestionGroup.objects.filter(section_id=section.id).values_list('audio_key', 'image_key'))
        section.delete()
        _cleanup_media_after_commit(keys)
    _locked_mutation(actor, section.exam_id, remove)
    audit_event(actor, "mock.section.delete", "mockSection", section_id)
    return {"deleted": True}


def create_group(actor, section_id: str, data: dict):
    try: section = MockSection.objects.select_related("exam").get(id=section_id)
    except MockSection.DoesNotExist: raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo'lim topilmadi", 404)
    if data.get("partNumber", 1) > 4 and section.exam.type != "multilevel":
        raise ContractAPIException("VALIDATION_ERROR", "IELTS listening parts must be 1–4", 400)
    def write(_exam):
        values = _group_payload(data)
        return MockQuestionGroup.objects.create(id=new_id(), section_id=section_id, sort_order=values.pop("sort_order", MockQuestionGroup.objects.filter(section_id=section_id).count()), title=values.pop("title", None), instructions=values.pop("instructions", None), passage_text=values.pop("passage_text", None), content_html=values.pop("content_html", None), audio_script=values.pop("audio_script", None), content_layout=values.pop("content_layout", None), options_reusable=values.pop("options_reusable", None), audio_key=None, image_key=None, max_score=values.pop("max_score", None), stimulus_ref=values.pop("stimulus_ref", None), part_number=values.pop("part_number", None), audio_play_limit=values.pop("audio_play_limit", 1), audio_duration_sec=values.pop("audio_duration_sec", None), created_at=now())
    group = _locked_mutation(actor, section.exam_id, write)
    audit_event(actor, "mock.group.create", "mockQuestionGroup", group.id, new={"sectionId": section_id})
    return group


def update_group(actor, group_id: str, data: dict):
    try: group = MockQuestionGroup.objects.select_related("section__exam").get(id=group_id)
    except MockQuestionGroup.DoesNotExist: raise ContractAPIException("MOCK_GROUP_NOT_FOUND", "Blok topilmadi", 404)
    if data.get("partNumber", 1) > 4 and group.section.exam.type != "multilevel":
        raise ContractAPIException("VALIDATION_ERROR", "IELTS listening parts must be 1–4", 400)
    values = _group_payload(data)
    def write(_exam):
        for key, value in values.items(): setattr(group, key, value)
        if values: group.save(update_fields=list(values))
        return group
    result = _locked_mutation(actor, group.section.exam_id, write)
    audit_event(actor, "mock.group.update", "mockQuestionGroup", group_id)
    return result


def delete_group(actor, group_id: str):
    try: group = MockQuestionGroup.objects.select_related("section").get(id=group_id)
    except MockQuestionGroup.DoesNotExist: raise ContractAPIException("MOCK_GROUP_NOT_FOUND", "Blok topilmadi", 404)
    def remove(_exam):
        keys = [(group.audio_key, group.image_key)]
        group.delete()
        _cleanup_media_after_commit(keys)
    _locked_mutation(actor, group.section.exam_id, remove)
    audit_event(actor, "mock.group.delete", "mockQuestionGroup", group_id)
    return {"deleted": True}


def _cleanup_media_after_commit(pairs):
    from .mock_media import delete_unreferenced
    for key in {key for pair in pairs for key in pair if key}:
        transaction.on_commit(lambda key=key: delete_unreferenced(key), robust=True)


def _group_or_throw(group_id: str):
    try: return MockQuestionGroup.objects.select_related("section__exam").get(id=group_id)
    except MockQuestionGroup.DoesNotExist: raise ContractAPIException("MOCK_GROUP_NOT_FOUND", "Blok topilmadi", 404)


def _assert_numbers(exam: MockExam, skill: str, rows: list[dict], *, excluding_group: str | None = None) -> None:
    numbers = [row["number"] for row in rows]
    if len(set(numbers)) != len(numbers):
        raise ContractAPIException("VALIDATION_ERROR", "Blok ichida savol raqamlari takrorlanmasligi kerak", 400)
    qs = MockQuestion.objects.filter(group__section__exam_id=exam.id)
    if exam.type == "multilevel": qs = qs.filter(group__section__skill=skill)
    if excluding_group: qs = qs.exclude(group_id=excluding_group)
    used = set(qs.values_list("number", flat=True))
    collisions = sorted(set(numbers) & used)
    if collisions:
        raise ContractAPIException("VALIDATION_ERROR", f"Already used in this exam: {', '.join(map(str, collisions))}", 400)


def add_questions(actor, group_id: str, data: dict):
    group = _group_or_throw(group_id)
    rows = data.get("questions")
    if not isinstance(rows, list) or not rows or len(rows) > 60:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    for row in rows: _assert_question(row, group.section.skill in AUTO_SKILLS)
    def write(exam):
        _assert_numbers(exam, group.section.skill, rows)
        base = MockQuestion.objects.filter(group_id=group.id).count()
        created = []
        for index, row in enumerate(rows):
            payload = _question_payload(row, exam, group.section.skill)
            created.append(MockQuestion.objects.create(id=new_id(), group_id=group.id, sort_order=payload.pop("sort_order", base + index), created_at=now(), **payload))
        return created
    questions = _locked_mutation(actor, group.section.exam_id, write)
    audit_event(actor, "mock.questions.add", "mockQuestionGroup", group_id, new={"count": len(questions)})
    return list(MockQuestion.objects.filter(group_id=group.id).order_by('sort_order'))


def import_questions(actor, group_id: str, data: dict):
    from .mock_parse import build_correct_answers, parse_questions
    group = _group_or_throw(group_id)
    parsed = parse_questions(data['text'])
    rows = parsed['questions']
    with transaction.atomic():
        exam = locked_exam(group.section.exam_id)
        assert_author(actor, exam)
        assert_mutable(exam)
        if not rows:
            raise ContractAPIException('NO_QUESTIONS_PARSED', 'Matndan savol topilmadi', 400)
        numbers = [row['number'] for row in rows]
        invalid = list(dict.fromkeys(number for number in numbers if not 1 <= number <= 200))
        if invalid:
            raise ContractAPIException('VALIDATION_ERROR', f"Invalid question numbers: {', '.join(map(str, invalid))} (must be 1-200)", 400)
        duplicates = list(dict.fromkeys(number for index, number in enumerate(numbers) if number in numbers[:index]))
        if duplicates:
            raise ContractAPIException('VALIDATION_ERROR', f"Duplicate numbers in pasted text: {', '.join(map(str, duplicates))}", 400)
        _assert_numbers(exam, group.section.skill, rows)
        auto = group.section.skill in AUTO_SKILLS
        answers = data.get('answers') or {}
        missing = [row['number'] for row in rows if auto and not (answers.get(str(row['number'])) or '').strip()]
        if missing:
            raise ContractAPIException('MISSING_ANSWERS', f"Quyidagi savollarga javob kiritilmagan: {', '.join(map(str, missing))}", 400)
        if parsed['instructions'] and not group.instructions:
            group.instructions = parsed['instructions']
            group.save(update_fields=['instructions'])
        base = MockQuestion.objects.filter(group_id=group.id).count()
        for index, row in enumerate(rows):
            raw_answer = answers.get(str(row['number']), '')
            keys = build_correct_answers(row['type'], row.get('options'), raw_answer.strip()) if auto else None
            MockQuestion.objects.create(
                id=new_id(), group_id=group.id, number=row['number'], sort_order=base + index,
                type=row['type'], prompt=row['prompt'], options=row.get('options'),
                correct_answers=keys, accepted_variants=None,
                points=_resolve_points(exam.type, auto, data.get('points')),
                word_limit=None, answer_rule=None, created_at=now(),
            )
        bump(exam)
    audit_event(actor, 'mock.questions.import', 'mockQuestionGroup', group_id, new={'count': len(rows)})
    return {'added': len(rows), 'questions': [question_payload(q) for q in MockQuestion.objects.filter(group_id=group.id).order_by('sort_order')]}


def update_question(actor, question_id: str, data: dict):
    try: question = MockQuestion.objects.select_related("group__section__exam").get(id=question_id)
    except MockQuestion.DoesNotExist: raise ContractAPIException("MOCK_QUESTION_NOT_FOUND", "Savol topilmadi", 404)
    group, exam, skill = question.group, question.group.section.exam, question.group.section.skill
    merged = {"number": data.get("number", question.number), "sortOrder": data.get("sortOrder", question.sort_order), "type": data.get("type", question.type), "prompt": data.get("prompt", question.prompt), "options": data.get("options", question.options), "correctAnswers": data.get("correctAnswers", question.correct_answers), "acceptedVariants": data.get("acceptedVariants", question.accepted_variants), "wordLimit": data.get("wordLimit", question.word_limit), "answerRule": data.get("answerRule", question.answer_rule), "points": data.get("points", question.points)}
    def write(locked):
        _assert_numbers(locked, skill, [merged], excluding_group=group.id)
        same_group = MockQuestion.objects.filter(group_id=group.id, number=merged["number"]).exclude(id=question.id).exists()
        if same_group:
            raise ContractAPIException("VALIDATION_ERROR", f"Already used in this exam: {merged['number']}", 400)
        payload = _question_payload(merged, locked, skill)
        for key, value in payload.items(): setattr(question, key, value)
        question.save(update_fields=list(payload))
        return question
    result = _locked_mutation(actor, exam.id, write)
    audit_event(actor, "mock.question.update", "mockQuestion", question_id)
    return result


def delete_question(actor, question_id: str):
    try: question = MockQuestion.objects.select_related("group__section").get(id=question_id)
    except MockQuestion.DoesNotExist: raise ContractAPIException("MOCK_QUESTION_NOT_FOUND", "Savol topilmadi", 404)
    _locked_mutation(actor, question.group.section.exam_id, lambda _exam: question.delete())
    audit_event(actor, "mock.question.delete", "mockQuestion", question_id)
    return {"deleted": True}


def save_group_content(actor, group_id: str, data: dict):
    group = _group_or_throw(group_id)
    incoming = data.get("questions")
    deleted = data.get("deletedQuestionIds", [])
    if not isinstance(incoming, list) or not isinstance(deleted, list) or len(incoming) > 200 or len(deleted) > 200:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    def write(exam):
        expected = data.get("expectedContentVersion")
        # _locked_mutation increments after action, so the current row still is the caller's snapshot.
        if expected is not None and expected != exam.content_version:
            raise ContractAPIException("MOCK_CONTENT_CONFLICT", "Imtihon boshqa joyda saqlangan. Qayta yuklab, o‘zgarishlarni qayta kiriting", 409)
        current = {question.id: question for question in MockQuestion.objects.filter(group_id=group.id)}
        kept = [row.get("id") for row in incoming if row.get("id")]
        if len(set(kept)) != len(kept) or any(question_id not in current or question_id in deleted for question_id in kept) or any(question_id not in current for question_id in deleted):
            raise ContractAPIException("MOCK_CONTENT_CONFLICT", "Savollar boshqa joyda o‘zgargan. Blokni qayta yuklang", 409)
        if any(question_id not in kept and question_id not in deleted for question_id in current):
            raise ContractAPIException("MOCK_CONTENT_CONFLICT", "Blokka yangi savollar qo‘shilgan. Saqlashdan oldin qayta yuklang", 409)
        for row in incoming: _assert_question(row, group.section.skill in AUTO_SKILLS, complete=False)
        _assert_numbers(exam, group.section.skill, incoming, excluding_group=group.id)
        values = _group_payload(data)
        for key, value in values.items(): setattr(group, key, value)
        if values: group.save(update_fields=list(values))
        for question_id in deleted: current[question_id].delete()
        saved = []
        for index, row in enumerate(incoming):
            payload = _question_payload(row, exam, group.section.skill, complete=False)
            payload.update(options=row.get('options') or [], correct_answers=row.get('correctAnswers') or [], accepted_variants=row.get('acceptedVariants') or [])
            payload["sort_order"] = index
            if row.get("id"):
                question = current[row["id"]]
                for key, value in payload.items(): setattr(question, key, value)
                question.save(update_fields=list(payload))
            else:
                question = MockQuestion.objects.create(id=new_id(), group_id=group.id, created_at=now(), **payload)
            saved.append(question)
        if exam.type == 'multilevel' and exam.specification_version == CURRENT_SPEC:
            _reconcile_multilevel(exam)
            group.refresh_from_db()
        return {"saved": len(saved), "questions": saved, "group": group}
    result = _locked_mutation(actor, group.section.exam_id, write, save_contract=True)
    result["version"] = MockExam.objects.get(id=group.section.exam_id).content_version
    audit_event(actor, "mock.group.content.save", "mockQuestionGroup", group_id, new={"count": result["saved"]})
    return result


def readiness(actor, exam_id: str, effective_profile: str | None = None) -> dict:
    try: exam = MockExam.objects.get(id=exam_id)
    except MockExam.DoesNotExist: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)
    tree = _exam_tree(exam)
    if effective_profile is not None: tree["profile"] = effective_profile
    sections = tree["sections"]
    group_count = sum(len(section["groups"]) for section in sections)
    question_count = sum(len(group["questions"]) for section in sections for group in section["groups"])
    items = [{"key": "has_content", "ok": bool(sections and group_count and question_count), "detail": f"{len(sections)} section(s), {group_count} group(s), {question_count} question(s)" if sections and group_count and question_count else "needs at least one section with a group and a question"}]
    is_full = tree['profile'] == 'full_mock'
    ielts = exam.type in ('ielts_academic', 'ielts_general')
    by_skill = {s['skill']: s for s in sections}
    if is_full:
        for skill in ('listening', 'reading', 'writing') + (() if ielts else ('speaking',)):
            items.append(dict(key=skill + '_section', ok=skill in by_skill, detail='exists' if skill in by_skill else 'missing section'))
    from .mock_content import assert_gapped_questions, gap_numbers
    from .mock_media import resolve_key
    from apps.legacy_schema.models import MockImportReviewIssue
    def item(key, ok, detail):
        items.append(dict(key=key, ok=ok, detail=detail))
    persisted_groups = {s['id']: list(MockQuestionGroup.objects.filter(section_id=s['id']).order_by('sort_order')) for s in sections}
    persisted_questions = {g.id: list(MockQuestion.objects.filter(group_id=g.id).order_by('sort_order', 'number')) for gs in persisted_groups.values() for g in gs}
    for skill in ('listening', 'reading', 'writing', 'speaking'):
        section = by_skill.get(skill)
        if section is None:
            continue
        gs = persisted_groups[section['id']]
        qs = [q for g in gs for q in persisted_questions[g.id]]
        if skill == 'listening':
            if is_full and ielts:
                parts = {g.part_number for g in gs if g.part_number is not None}
                item('listening_parts', len(gs) == 4 and parts == {1, 2, 3, 4}, f'{len(gs)} groups, parts: {",".join(map(str, sorted(parts))) or "—"}')
                item('listening_questions', len(qs) == 40, f'{len(qs)}/40 questions')
            count = sum(bool(g.audio_key) for g in gs)
            item('listening_audio', bool(gs) and count == len(gs), f'{count}/{len(gs)} groups with audio')
        if skill == 'reading':
            if is_full and ielts:
                item('reading_groups', len(gs) == 3, f'{len(gs)}/3 passages')
                item('reading_questions', len(qs) == 40, f'{len(qs)}/40 questions')
            missing = sum(bool(persisted_questions[g.id]) and not (g.passage_text or '').strip() and not (g.content_html or '').strip() for g in gs)
            item('reading_passage', missing == 0, 'all passages have text' if missing == 0 else f'{missing} passage(s) without text')
        if skill == 'writing':
            if is_full and ielts:
                types = list(dict.fromkeys(q.type for q in qs))
                item('writing_tasks', len(qs) == 2 and 'essay_task1' in types and 'essay_task2' in types, f'{len(qs)}/2 tasks: {",".join(types) or "—"}')
            else:
                count = sum(q.type in ('essay_task1', 'essay_task2') and bool(q.prompt.strip()) for q in qs)
                item('writing_content', count > 0, f'{count} essay task(s)' if count else 'needs at least one essay task with a prompt')
        if skill == 'speaking' and not is_full:
            count = sum(q.type == 'speaking_task' for q in qs)
            item('speaking_content', count > 0, f'{count} speaking task(s)' if count else 'needs at least one speaking task')
    if exam.type == "multilevel":
        check = multilevel_readiness(tree)
        items.append({"key": "multilevel_start", "ok": not check["issues"], "detail": "; ".join(check["issues"]) or CURRENT_SPEC})
        if tree["profile"] == "full_mock": items.append({"key": "multilevel_blueprint", "ok": not check["issues"], "detail": "; ".join(check["issues"]) or CURRENT_SPEC})
    missing_keys, manual_bad, duplicates, unavailable, seen = 0, 0, 0, [], {}
    for section in sections:
        auto = section['skill'] in AUTO_SKILLS
        for group in persisted_groups[section['id']]:
            qs = persisted_questions[group.id]
            for key in (group.audio_key, group.image_key):
                if key:
                    try:
                        if not resolve_key(key).is_file():
                            unavailable.append(group.id)
                    except ContractAPIException:
                        unavailable.append(group.id)
            value = group_payload(group)
            value['questions'] = [question_payload(q) for q in qs]
            issues = objective_group_issues(value, auto)
            try:
                if gap_numbers(group.content_html):
                    assert_gapped_questions(group.content_html, [q.number for q in qs])
            except ContractAPIException as error:
                issues.append(error.contract_message)
            item(f'question_group:{group.id}', not issues, '; '.join(issues) or 'question format and mappings valid')
            for question in qs:
                if auto and not any(a.strip() for a in question.correct_answers or []):
                    missing_keys += 1
                if ielts and not auto and question.points != 9:
                    manual_bad += 1
                number = question.number if ielts else (section['skill'], question.number)
                count = seen.get(number, 0)
                if count == 1:
                    duplicates += 1
                seen[number] = count + 1
    item('answer_keys', missing_keys == 0, f'{missing_keys} auto Q without key')
    item('media_assets', not unavailable, f'{len(unavailable)} media asset(s) unavailable or invalid' if unavailable else 'all referenced media available')
    item('manual_points', not ielts or manual_bad == 0, f'{manual_bad} W/S Q not 9pt' if ielts else 'n/a (multilevel)')
    item('duplicate_numbers', duplicates == 0, f'{duplicates} duplicate number(s)' if duplicates else 'no duplicates')
    item('total_questions', question_count > 0, f'{question_count} question(s)')
    review = list(MockImportReviewIssue.objects.filter(import_record__exam_id=exam.id))
    generated = any(i.message.startswith(('Template placeholders and sample answer keys must be replaced', 'Replace and verify all Listening placeholders and answer keys', 'Replace and verify all Part ')) for i in review)
    marker = re.compile(r'\bREPLACE(?:\s+[—-]\s+|\s+WITH THE COMPLETE TEXT FOR READING PASSAGE\b)')
    def has_marker(values):
        return any(isinstance(v, str) and marker.search(v) for v in values)
    placeholders = int(has_marker((exam.title, exam.description)))
    for section in sections:
        placeholders += int(has_marker((section['title'], section.get('instructions'))))
        for group in persisted_groups[section['id']]:
            qs = persisted_questions[group.id]
            values = [group.title, group.passage_text, group.content_html, group.audio_script, group.instructions,
                *[value for q in qs for value in [q.prompt, *(q.options if isinstance(q.options, list) else [])]]]
            key_marker = generated and any('REPLACE' in (q.correct_answers or []) or 'REPLACE' in (q.accepted_variants or []) for q in qs)
            placeholders += int(key_marker or has_marker(values))
    item('template_placeholders', placeholders == 0, f'{placeholders} content block(s) still contain generated template placeholders' if placeholders else 'no generated template placeholders')
    open_issues = sum(i.status == 'open' for i in review)
    item('import_issues', open_issues == 0, f'{open_issues} open import issue(s) — resolve in Exam Builder' if open_issues else 'no open import issues')
    return {"examId": exam_id, "ready": all(item["ok"] for item in items), "items": items}


def preview(actor, exam_id: str) -> dict:
    """Return the student-visible definition without answer keys."""
    if actor.role not in STAFF:
        raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)
    try:
        exam = MockExam.objects.get(id=exam_id)
    except MockExam.DoesNotExist:
        raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)
    # Import lazily: mock_catalog deliberately imports canonical readiness from
    # this module, so a module-level import would create a cycle.
    from .mock_catalog import shape_exam
    shaped = shape_exam(exam, False)
    if exam.type == "multilevel":
        shaped["specificationVersion"] = exam.specification_version
        # NestJS deliberately withholds Listening transcripts from every
        # student-shaped Multilevel response, including staff preview.
        for section in shaped["sections"]:
            if section["skill"] == "listening":
                for group in section["groups"]:
                    group["passageText"] = None
    shaped["access"] = "granted"
    return shaped


def _copy_exam(actor, source: MockExam) -> MockExam:
    stamp = now()
    clone = MockExam.objects.create(id=new_id(), assessment_policy=source.assessment_policy, speaking_profile_version=CURRENT_SPEAKING_PROFILE if source.type == "multilevel" else None, specification_version=CURRENT_SPEC if source.type == "multilevel" else source.specification_version, type=source.type, title=(source.title + " (copy)")[:200], description=source.description, level=source.level, practice_level=source.practice_level, is_published=False, is_demo=False, price=source.price, is_free_for_approved=source.is_free_for_approved, created_by_id=actor.id, created_at=stamp, updated_at=stamp, profile=source.profile, blueprint_ref=source.blueprint_ref, content_version=1)
    for section in MockSection.objects.filter(exam_id=source.id).order_by("sort_order", "id"):
        copied_section = MockSection.objects.create(id=new_id(), exam_id=clone.id, skill=section.skill, title=section.title, sort_order=section.sort_order, duration_minutes=section.duration_minutes, instructions=section.instructions)
        for group in MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order", "id"):
            copied_group = MockQuestionGroup.objects.create(id=new_id(), section_id=copied_section.id, sort_order=group.sort_order, title=group.title, instructions=group.instructions, passage_text=group.passage_text, content_html=group.content_html, audio_script=group.audio_script, content_layout=group.content_layout, options_reusable=group.options_reusable, audio_key=group.audio_key, image_key=group.image_key, max_score=group.max_score, stimulus_ref=group.stimulus_ref, part_number=group.part_number, audio_play_limit=group.audio_play_limit, audio_duration_sec=group.audio_duration_sec, created_at=stamp)
            for question in MockQuestion.objects.filter(group_id=group.id).order_by("sort_order", "number", "id"):
                MockQuestion.objects.create(id=new_id(), group_id=copied_group.id, number=question.number, sort_order=question.sort_order, type=question.type, prompt=question.prompt, options=question.options, correct_answers=question.correct_answers, accepted_variants=question.accepted_variants, points=question.points, word_limit=question.word_limit, answer_rule=question.answer_rule, created_at=stamp)
    return clone


def _reconcile_multilevel(exam: MockExam) -> int:
    if exam.type != "multilevel" or exam.specification_version != CURRENT_SPEC or exam.is_published:
        return 0
    writes = 0
    for section in MockSection.objects.filter(exam_id=exam.id, skill__in={"writing", "speaking"}):
        groups = list(MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order", "id"))
        shared = (groups[0].stimulus_ref if groups else None) or (groups[1].stimulus_ref if len(groups) > 1 else None) or f"multilevel:{exam.id}:writing-task-1"
        parts = SPECS[CURRENT_SPEC][section.skill]["parts"]
        for index, group in enumerate(groups):
            if index >= len(parts): continue
            expected = parts[index][3]
            changed = []
            if group.max_score != expected: group.max_score = expected; changed.append("max_score")
            if section.skill == "writing" and index < 2 and group.stimulus_ref != shared: group.stimulus_ref = shared; changed.append("stimulus_ref")
            if changed: group.save(update_fields=changed); writes += 1
    return writes


def clone_exam(actor, exam_id: str):
    if actor.role not in STAFF: raise ContractAPIException("FORBIDDEN", "Bu amal uchun rolingiz yetarli emas", 403)
    try: source = MockExam.objects.get(id=exam_id)
    except MockExam.DoesNotExist: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)
    with transaction.atomic():
        clone = _copy_exam(actor, source)
        _reconcile_multilevel(clone)
    audit_event(actor, "mock.exam.clone", "mockExam", clone.id, old={"sourceId": source.id, "title": source.title})
    return clone


def repair_multilevel_draft(actor, exam_id: str):
    with transaction.atomic():
        exam = locked_exam(exam_id)
        assert_author(actor, exam)
        assert_mutable(exam)
        if exam.type != "multilevel" or exam.specification_version != CURRENT_SPEC:
            raise ContractAPIException("VALIDATION_ERROR", "Only current-version Multilevel drafts can be repaired", 400)
        repaired = _reconcile_multilevel(exam)
        if repaired:
            bump(exam)
    audit_event(actor, "mock.exam.multilevel.repair", "mockExam", exam_id, new={"repaired": repaired})
    return {"repaired": repaired}


def _history(exam_id: str) -> dict:
    attempts = MockAttempt.objects.filter(exam_id=exam_id)
    total = attempts.count()
    submitted = attempts.filter(submitted_at__isnull=False).count()
    completed = attempts.filter(status="completed").count()
    results = AssessmentJob.objects.filter(attempt__exam_id=exam_id).filter(
        Q(final_score__isnull=False) | (Q(final_result__isnull=False) & ~Q(final_result=None))
    ).count()
    return {"attemptCount": total, "activeAttemptCount": attempts.filter(status="in_progress").count(), "completedAttemptCount": completed, "submissionCount": submitted, "resultCount": results, "historyExists": bool(total or submitted or results)}


def multilevel_repair_inspection(actor, exam_id: str):
    if actor.role not in {"admin", "super_admin"}: raise ContractAPIException("FORBIDDEN", "Only an administrator can inspect or repair legacy Multilevel exams", 403)
    try: exam = MockExam.objects.get(id=exam_id)
    except MockExam.DoesNotExist: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)
    if exam.type != "multilevel": raise ContractAPIException("VALIDATION_ERROR", "Multilevel repair inspection is only available for Multilevel exams", 400)
    state = _history(exam_id)
    check = multilevel_readiness(_exam_tree(exam))
    sections = {section.skill: section for section in MockSection.objects.filter(exam_id=exam.id)}
    writing = list(MockQuestionGroup.objects.filter(section=sections.get("writing")).order_by("sort_order", "id")) if sections.get("writing") else []
    speaking = list(MockQuestionGroup.objects.filter(section=sections.get("speaking")).order_by("sort_order", "id")) if sections.get("speaking") else []
    writing_spec = SPECS[CURRENT_SPEC]["writing"]["parts"]
    speaking_spec = SPECS[CURRENT_SPEC]["speaking"]["parts"]
    shared = (writing[0].stimulus_ref if writing else None) or (writing[1].stimulus_ref if len(writing) > 1 else None) or f"multilevel:{exam.id}:writing-task-1"
    proposed = []
    for index, group in enumerate(writing):
        if index >= len(writing_spec):
            continue
        key, _count, _types, expected = writing_spec[index]
        if group.max_score != expected:
            proposed.append({"field": f"Writing {key} maxScore", "from": group.max_score, "to": expected})
        if index < 2 and group.stimulus_ref != shared:
            proposed.append({"field": f"Writing {key} stimulusRef", "from": group.stimulus_ref, "to": shared})
    for index, group in enumerate(speaking):
        if index >= len(speaking_spec):
            continue
        key, _count, _types, expected = speaking_spec[index]
        if group.max_score != expected:
            proposed.append({"field": f"Speaking {key} maxScore", "from": group.max_score, "to": expected})
    auto_points = re.compile(r"^(writing|speaking) [^:]+: points must be \d+$")
    stimulus_issue = "writing: informal and formal emails must share the same source stimulus"
    manual = [issue for issue in check["issues"] if not auto_points.match(issue) and issue != stimulus_issue]
    writing_rows = []
    roles = {"informal_email": "Informal Letter", "formal_email": "Formal Letter", "publication": "Publication"}
    for index, (key, _count, _types, expected) in enumerate(writing_spec):
        group = writing[index] if index < len(writing) else None
        writing_rows.append({
            "task": key, "role": roles[key], "exists": group is not None,
            "maxScore": group.max_score if group else None, "expectedMaxScore": expected,
            "stimulusRef": group.stimulus_ref if group else None,
            "promptPresent": bool(group and any((prompt or "").strip() for prompt in MockQuestion.objects.filter(group_id=group.id).values_list("prompt", flat=True))),
        })
    speaking_rows = []
    for index, (key, count, _types, expected) in enumerate(speaking_spec):
        group = speaking[index] if index < len(speaking) else None
        speaking_rows.append({
            "part": key, "exists": group is not None,
            "responseCount": MockQuestion.objects.filter(group_id=group.id).count() if group else 0,
            "expectedResponseCount": count,
            "maxScore": group.max_score if group else None, "expectedMaxScore": expected,
            "imageAssetCount": 1 if group and group.image_key else 0,
            "requiresTwoPictureAsset": key == "1.2",
        })
    return {
        "exam": {"id": exam.id, "title": exam.title, "isPublished": exam.is_published, "contentVersion": exam.content_version, "specificationVersion": exam.specification_version},
        "attempts": {key: value for key, value in state.items() if key != "historyExists"},
        "readiness": {"ready": not check["issues"], "exactIssues": check["issues"], "writingProblems": [issue for issue in check["issues"] if issue.startswith("writing:")], "speakingProblems": [issue for issue in check["issues"] if issue.startswith("speaking")]},
        "writing": writing_rows,
        "writingSharesStimulusRef": bool(len(writing) > 1 and writing[0].stimulus_ref and writing[0].stimulus_ref == writing[1].stimulus_ref),
        "speaking": speaking_rows,
        "safeRepairAllowed": not state["historyExists"], "specificationVersion": exam.specification_version,
        "currentVersion": exam.specification_version == CURRENT_SPEC, "speakingProfileVersion": exam.speaking_profile_version,
        "currentSpeakingProfile": exam.speaking_profile_version == CURRENT_SPEAKING_PROFILE,
        "historyExists": state["historyExists"], "requiresUnpublish": exam.is_published,
        "proposedChanges": proposed, "manualAuthoringRequired": manual,
        "recommendedAction": "CREATE_CORRECTED_COPY" if state["historyExists"] else "REPAIR_DRAFT_THEN_REVIEW",
    }


def apply_multilevel_safe_repair(actor, exam_id: str, confirmed: bool):
    if actor.role not in {"admin", "super_admin"}: raise ContractAPIException("FORBIDDEN", "Only an administrator can inspect or repair legacy Multilevel exams", 403)
    if not confirmed: raise ContractAPIException("CONFIRMATION_REQUIRED", "Confirm the unused-exam repair before applying it", 400)
    with transaction.atomic():
        exam = locked_exam(exam_id)
        if exam.type != "multilevel": raise ContractAPIException("VALIDATION_ERROR", "Only Multilevel exams can be reconciled", 400)
        if _history(exam.id)["historyExists"]: raise ContractAPIException("EXAM_VERSION_IN_USE", "Existing history requires a corrected copy; the original is preserved", 409)
        was_published = exam.is_published; version_upgraded = exam.specification_version != CURRENT_SPEC; profile_upgraded = exam.speaking_profile_version != CURRENT_SPEAKING_PROFILE
        exam.specification_version = CURRENT_SPEC; exam.speaking_profile_version = CURRENT_SPEAKING_PROFILE; exam.is_published = False
        exam.save(update_fields=["specification_version", "speaking_profile_version", "is_published"])
        repaired = _reconcile_multilevel(exam)
        if repaired or version_upgraded or profile_upgraded: bump(exam)
    outcome = {"unpublished": was_published, "repaired": repaired, "versionUpgraded": version_upgraded, "speakingProfileUpgraded": profile_upgraded, "contentVersion": exam.content_version, "status": "DRAFT_REQUIRES_REVIEW"}
    audit_event(actor, "mock.exam.multilevel.safe_repair", "mockExam", exam_id, new=outcome)
    return outcome


def clone_corrected_multilevel(actor, exam_id: str):
    if actor.role not in {"admin", "super_admin"}: raise ContractAPIException("FORBIDDEN", "Only an administrator can inspect or repair legacy Multilevel exams", 403)
    if not _history(exam_id)["historyExists"]: raise ContractAPIException("SAFE_REPAIR_AVAILABLE", "No history exists; inspect and repair the draft instead", 409)
    clone = clone_exam(actor, exam_id)
    audit_event(actor, "mock.exam.multilevel.clone_corrected", "mockExam", clone.id, old={"sourceId": exam_id})
    return {"id": clone.id, "status": "DRAFT_REQUIRES_REVIEW", "sourcePreserved": True}
