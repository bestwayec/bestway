"""Transactional authoring primitives for Prisma-owned mock exam tables.

Write routes are wired only after their shared history/version guarantees exist.
"""
from __future__ import annotations

from uuid import uuid4

from django.db import IntegrityError, connection, transaction
from django.utils import timezone

from apps.legacy_schema.models import MockAttempt, MockExam, MockQuestion, MockQuestionGroup, MockSection
from common.api.exceptions import ContractAPIException
from .auth_service import audit
from .mock_rules import MANUAL_TYPES, QUESTION_TYPES, objective_group_issues, objective_question_issues
from .multilevel import CURRENT_SPEC, CURRENT_SPEAKING_PROFILE, SPECS, authored, readiness as multilevel_readiness

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
        raise ContractAPIException("MOCK_NOT_OWNER", "Bu imtihonni tahrirlash huquqi yo‘q", 403)


def assert_mutable(exam: MockExam) -> None:
    if exam.is_published or MockAttempt.objects.filter(exam_id=exam.id).exists():
        raise ContractAPIException("MOCK_CONTENT_LOCKED", "O‘quvchilar ishlatgan kontentni o‘zgartirib bo‘lmaydi. Imtihondan nusxa oling", 409)


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
    if exam_type.startswith("ielts"):
        expected = 1 if is_auto else IELTS_MANUAL_POINTS
        if value is not None and value != expected:
            raise ContractAPIException("VALIDATION_ERROR", f"{prefix}IELTS {'objective' if is_auto else 'manual'} questions must be {expected} points", 400)
        return expected
    if value is not None and value != 1 and is_auto:
        raise ContractAPIException("VALIDATION_ERROR", f"{prefix}Multilevel objective questions must be 1 point", 400)
    return 1 if is_auto else (value if isinstance(value, int) and 1 <= value <= 20 else 1)


def _group_payload(data: dict) -> dict:
    mapping = {"sortOrder": "sort_order", "title": "title", "instructions": "instructions", "passageText": "passage_text", "contentHtml": "content_html", "audioScript": "audio_script", "contentLayout": "content_layout", "optionsReusable": "options_reusable", "maxScore": "max_score", "stimulusRef": "stimulus_ref", "partNumber": "part_number", "audioDurationSec": "audio_duration_sec", "audioPlayLimit": "audio_play_limit"}
    return {target: data[source] for source, target in mapping.items() if source in data}


def _question_payload(data: dict, exam: MockExam, skill: str, *, complete: bool = True) -> dict:
    is_auto = skill in AUTO_SKILLS
    _assert_question(data, is_auto, complete=complete)
    payload = {"number": data["number"], "type": data["type"], "prompt": data.get("prompt", "").strip(), "options": data.get("options") or None, "correct_answers": data.get("correctAnswers") or None, "accepted_variants": data.get("acceptedVariants") or None, "word_limit": data.get("wordLimit"), "answer_rule": data.get("answerRule"), "points": _resolve_points(exam.type, is_auto, data.get("points"))}
    if "sortOrder" in data: payload["sort_order"] = data["sortOrder"]
    return payload


def _locked_mutation(actor, exam_id: str, action):
    """Serialize every definition edit through the exam row and shared version."""
    with transaction.atomic():
        exam = locked_exam(exam_id)
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
    return {"specification_version": exam.specification_version, "profile": exam.profile, "sections": [{"skill": section.skill, "groups": [group_map[group.id] for group in groups if group.section_id == section.id]} for section in sections]}


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


def create_exam(actor, data: dict):
    exam_type = data.get("type")
    title = data.get("title")
    if exam_type not in {"ielts_academic", "ielts_general", "multilevel"} or not isinstance(title, str) or not 3 <= len(title) <= 200:
        raise ContractAPIException("VALIDATION_ERROR", "Validatsiya xatosi", 400)
    with transaction.atomic():
        stamp = now()
        exam = MockExam.objects.create(id=new_id(), assessment_policy=data.get("assessmentPolicy"), speaking_profile_version=CURRENT_SPEAKING_PROFILE if exam_type == "multilevel" else None, specification_version=CURRENT_SPEC if exam_type == "multilevel" else None, type=exam_type, title=title, description=data.get("description"), level=data.get("level"), practice_level=data.get("practiceLevel"), is_published=False, is_demo=bool(data.get("isDemo", False)), price=data.get("price", 0), is_free_for_approved=data.get("isFreeForApproved", True), created_by_id=actor.id, created_at=stamp, updated_at=stamp, profile=data.get("profile", "practice"), blueprint_ref=None, content_version=1)
        if data.get("starterStructure"):
            if exam_type == "multilevel": multilevel_preset(exam.id, data.get("skills"))
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
        requires_readiness = data.get("isPublished") is True or (exam.is_published and data.get("isPublished") is not False and profile_changed)
        if requires_readiness and not readiness(actor, exam_id, effective_profile=data.get("profile")) ["ready"]:
            raise ContractAPIException("MOCK_NOT_READY", "Exam not ready to publish", 400)
        for source, target in {"title":"title", "description":"description", "level":"level", "practiceLevel":"practice_level", "assessmentPolicy":"assessment_policy", "isDemo":"is_demo", "price":"price", "isFreeForApproved":"is_free_for_approved", "profile":"profile", "isPublished":"is_published"}.items():
            if source in data: setattr(exam, target, data[source])
        if profile_changed: exam.content_version += 1
        exam.updated_at = now(); exam.save()
        from django.db import connection
        with connection.cursor() as cursor: audit(cursor, actor.id, "mock.exam.update", "mockExam", exam.id, new=data)
    return exam


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
    except MockSection.DoesNotExist: raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo‘lim topilmadi", 404)
    fields = {"title": "title", "sortOrder": "sort_order", "durationMinutes": "duration_minutes", "instructions": "instructions"}
    def write(_exam):
        for source, target in fields.items():
            if source in data: setattr(section, target, data[source])
        section.save(update_fields=[target for source, target in fields.items() if source in data])
        return section
    result = _locked_mutation(actor, section.exam_id, write)
    audit_event(actor, "mock.section.update", "mockSection", section_id)
    return result


def delete_section(actor, section_id: str):
    try: section = MockSection.objects.get(id=section_id)
    except MockSection.DoesNotExist: raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo‘lim topilmadi", 404)
    _locked_mutation(actor, section.exam_id, lambda _exam: section.delete())
    audit_event(actor, "mock.section.delete", "mockSection", section_id)
    return {"deleted": True}


def create_group(actor, section_id: str, data: dict):
    try: section = MockSection.objects.select_related("exam").get(id=section_id)
    except MockSection.DoesNotExist: raise ContractAPIException("MOCK_SECTION_NOT_FOUND", "Bo‘lim topilmadi", 404)
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
    _locked_mutation(actor, group.section.exam_id, lambda _exam: group.delete())
    audit_event(actor, "mock.group.delete", "mockQuestionGroup", group_id)
    return {"deleted": True}


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
    return questions


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
            raise ContractAPIException("MOCK_CONTENT_CONFLICT", "Imtihon boshqa joyda saqlangan. Qayta yuklab saqlang", 409)
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
            payload["sort_order"] = index
            if row.get("id"):
                question = current[row["id"]]
                for key, value in payload.items(): setattr(question, key, value)
                question.save(update_fields=list(payload))
            else:
                question = MockQuestion.objects.create(id=new_id(), group_id=group.id, created_at=now(), **payload)
            saved.append(question)
        return {"saved": len(saved), "questions": saved, "group": group}
    result = _locked_mutation(actor, group.section.exam_id, write)
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
    if exam.type == "multilevel":
        check = multilevel_readiness(tree)
        items.append({"key": "multilevel_start", "ok": not check["issues"], "detail": "; ".join(check["issues"]) or CURRENT_SPEC})
        if tree["profile"] == "full_mock": items.append({"key": "multilevel_blueprint", "ok": not check["issues"], "detail": "; ".join(check["issues"]) or CURRENT_SPEC})
    else:
        is_full = tree["profile"] == "full_mock"
        skills = {section["skill"] for section in sections}
        if is_full:
            for skill in ("listening", "reading", "writing"):
                items.append({"key": f"{skill}_section", "ok": skill in skills, "detail": "exists" if skill in skills else "missing section"})
        for section in sections:
            auto = section["skill"] in AUTO_SKILLS
            for group in section["groups"]:
                # Resolve complete validation from persisted records, rather than draft-time rules.
                raw_group = {"contentLayout": getattr(MockQuestionGroup.objects.get(id=group["id"]), "content_layout", None), "optionsReusable": getattr(MockQuestionGroup.objects.get(id=group["id"]), "options_reusable", None), "imageKey": group["image_key"], "questions": [{"type": q["type"], "points": q["points"], "options": q["options"], "correctAnswers": MockQuestion.objects.get(id=q["id"]).correct_answers, "acceptedVariants": MockQuestion.objects.get(id=q["id"]).accepted_variants, "prompt": MockQuestion.objects.get(id=q["id"]).prompt, "wordLimit": q["word_limit"], "answerRule": MockQuestion.objects.get(id=q["id"]).answer_rule} for q in group["questions"]]}
                issues = objective_group_issues(raw_group, auto)
                items.append({"key": f"question_group:{group['id']}", "ok": not issues, "detail": "; ".join(issues) or "question format and mappings valid"})
    return {"examId": exam_id, "ready": all(item["ok"] for item in items), "items": items}


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
    def write(exam):
        if exam.type != "multilevel" or exam.specification_version != CURRENT_SPEC:
            raise ContractAPIException("VALIDATION_ERROR", "Only current-version Multilevel drafts can be repaired", 400)
        return _reconcile_multilevel(exam)
    repaired = _locked_mutation(actor, exam_id, write)
    audit_event(actor, "mock.exam.multilevel.repair", "mockExam", exam_id, new={"repaired": repaired})
    return {"repaired": repaired}


def _history(exam_id: str) -> dict:
    attempts = MockAttempt.objects.filter(exam_id=exam_id)
    total = attempts.count()
    submitted = attempts.filter(submitted_at__isnull=False).count()
    completed = attempts.filter(status="completed").count()
    return {"attemptCount": total, "activeAttemptCount": attempts.filter(status="in_progress").count(), "completedAttemptCount": completed, "submissionCount": submitted, "resultCount": 0, "historyExists": bool(total or submitted)}


def multilevel_repair_inspection(actor, exam_id: str):
    if actor.role not in {"admin", "super_admin"}: raise ContractAPIException("FORBIDDEN", "Only an administrator can inspect or repair legacy Multilevel exams", 403)
    try: exam = MockExam.objects.get(id=exam_id)
    except MockExam.DoesNotExist: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)
    if exam.type != "multilevel": raise ContractAPIException("VALIDATION_ERROR", "Multilevel repair inspection is only available for Multilevel exams", 400)
    state = _history(exam_id); check = multilevel_readiness(_exam_tree(exam))
    return {"exam": {"id": exam.id, "title": exam.title, "isPublished": exam.is_published, "contentVersion": exam.content_version, "specificationVersion": exam.specification_version}, "attempts": {key: value for key, value in state.items() if key != "historyExists"}, "readiness": {"ready": not check["issues"], "exactIssues": check["issues"]}, "safeRepairAllowed": not state["historyExists"], "specificationVersion": exam.specification_version, "currentVersion": exam.specification_version == CURRENT_SPEC, "speakingProfileVersion": exam.speaking_profile_version, "currentSpeakingProfile": exam.speaking_profile_version == CURRENT_SPEAKING_PROFILE, "historyExists": state["historyExists"], "requiresUnpublish": exam.is_published, "recommendedAction": "CREATE_CORRECTED_COPY" if state["historyExists"] else "REPAIR_DRAFT_THEN_REVIEW"}


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
        if repaired or version_upgraded or profile_upgraded or was_published: bump(exam)
    outcome = {"unpublished": was_published, "repaired": repaired, "versionUpgraded": version_upgraded, "speakingProfileUpgraded": profile_upgraded, "contentVersion": exam.content_version, "status": "DRAFT_REQUIRES_REVIEW"}
    audit_event(actor, "mock.exam.multilevel.safe_repair", "mockExam", exam_id, new=outcome)
    return outcome


def clone_corrected_multilevel(actor, exam_id: str):
    if actor.role not in {"admin", "super_admin"}: raise ContractAPIException("FORBIDDEN", "Only an administrator can inspect or repair legacy Multilevel exams", 403)
    if not _history(exam_id)["historyExists"]: raise ContractAPIException("SAFE_REPAIR_AVAILABLE", "No history exists; inspect and repair the draft instead", 409)
    clone = clone_exam(actor, exam_id)
    audit_event(actor, "mock.exam.multilevel.clone_corrected", "mockExam", clone.id, old={"sourceId": exam_id})
    return {"id": clone.id, "status": "DRAFT_REQUIRES_REVIEW", "sourcePreserved": True}
