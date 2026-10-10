"""Read-only mock-exam catalogue and definition shaping.

Authoring mutations are deliberately kept in their own Phase 3 slice; these
handlers establish the exact existing catalogue access boundary first.
"""
from __future__ import annotations
import math
import re

from apps.legacy_schema.models import MockExam, MockPurchase, MockQuestion, MockQuestionGroup, MockSection
from common.api.exceptions import ContractAPIException
from .exam_programs import state
from .mock_rules import MANUAL_TYPES

STAFF = {"teacher", "admin", "super_admin"}


def is_staff(user) -> bool: return bool(user and user.role in STAFF)
def program_for_type(exam_type: str) -> str: return "MULTILEVEL" if exam_type == "multilevel" else "IELTS"
def student_title(title: str) -> str:
    return re.sub(r'^REPLACE (?:—|-) ', '', title) if re.fullmatch(r'REPLACE (?:—|-) (IELTS Academic Reading Practice Test|IELTS Academic Reading Passage [1-3]|IELTS Listening Practice Test|IELTS Listening Part [1-4] Practice)', title) else title


def _staff_answer_payload(question) -> dict:
    """Staff/author payloads keep answer keys and rubric-adjacent fields."""
    return {"correctAnswers": question.correct_answers, "acceptedVariants": question.accepted_variants, "audioScript": None}


def _student_question_payload(question, group) -> dict:
    """Student-facing payloads must never expose correct answers, accepted
    variants, or hidden rubric data."""
    from apps.core.mock_authoring import _student_question_payload
    return _student_question_payload(question, group)


def catalogue_queryset(user, program: str | None, exam_type: str | None, practice_level: str | None):
    rows = MockExam.objects.all().order_by("-created_at")
    if exam_type: rows = rows.filter(type=exam_type)
    if is_staff(user): return rows
    if user and user.role == "student":
        with __import__("django.db", fromlist=["connection"]).connection.cursor() as cursor:
            track = state(cursor, user.id)
        if program and program != track["activeProgram"]:
            raise ContractAPIException("PROGRAM_CHANGED", "Your exam track changed. Refresh and try again.", 409)
        allowed = ["multilevel"] if track["activeProgram"] == "MULTILEVEL" else ["ielts_academic", "ielts_general"] if track["activeProgram"] == "IELTS" else []
        rows = rows.filter(type__in=allowed).filter(is_published=True) | rows.filter(type__in=allowed).filter(is_demo=True)
    else:
        rows = rows.filter(is_demo=True)
    if practice_level:
        rows = rows.filter(practice_level=practice_level, profile="practice", type="multilevel")
    return rows.order_by("-created_at")


def access_for(user, exam) -> str:
    if is_staff(user): return "granted"
    if user and user.role == "student":
        with __import__("django.db", fromlist=["connection"]).connection.cursor() as cursor:
            track = state(cursor, user.id)
        if program_for_type(exam.type) not in track["availablePrograms"]: return "locked"
    elif exam.type == "multilevel": return "locked"
    if exam.is_demo or exam.price == 0: return "granted"
    if not user or user.role != "student": return "locked"
    if user.id and _approved(user.id) and exam.is_free_for_approved: return "granted"
    purchase = MockPurchase.objects.filter(user_id=user.id, exam_id=exam.id).first()
    return "granted" if purchase and purchase.status == "purchased" else "pending" if purchase and purchase.status == "pending_confirmation" else "locked"


def _approved(user_id: str) -> bool:
    from apps.legacy_schema.models import StudentProfile
    row = StudentProfile.objects.filter(user_id=user_id).values_list("is_approved", flat=True).first()
    return bool(row)


def _groups(section): return list(MockQuestionGroup.objects.filter(section_id=section.id).order_by("sort_order"))
def _questions(group): return list(MockQuestion.objects.filter(group_id=group.id).order_by("sort_order", "number"))


def shape_question(question, answers: bool):
    value = {"id": question.id, "number": question.number, "sortOrder": question.sort_order, "type": question.type, "prompt": question.prompt, "options": question.options, "points": question.points, "wordLimit": question.word_limit, "answerRule": question.answer_rule}
    from .mock_rules import canonical_decision
    value['options'] = question.options if isinstance(question.options, list) else None
    if question.type in ('true_false_notgiven', 'yes_no_notgiven') and value['options'] is not None:
        value['options'] = ['NOT GIVEN' if canonical_decision(o) == 'NOT_GIVEN' else canonical_decision(o) for o in value['options']]
    if answers: value.update({"correctAnswers": question.correct_answers if isinstance(question.correct_answers, list) else None, "acceptedVariants": question.accepted_variants if isinstance(question.accepted_variants, list) else None})
    return value


def shape_exam(exam, answers: bool, include_sections: bool = True):
    """Catalogue/detail definition shape. `answers` is True only for staff
    authoring/grading contexts."""
    result = {
        "id": exam.id, "type": exam.type, "speakingProfileVersion": exam.speaking_profile_version,
        "profile": exam.profile, "title": exam.title if answers else student_title(exam.title), "description": exam.description, "level": exam.level,
        "practiceLevel": exam.practice_level, "isPublished": exam.is_published, "isDemo": exam.is_demo,
        "createdAt": exam.created_at, "updatedAt": exam.updated_at, "contentVersion": exam.content_version,
        "questionCount": 0, "sections": [],
    }
    if answers: result["assessmentPolicy"] = exam.assessment_policy
    from .multilevel import specification_payload, speaking_profile, task_guidance
    from .mock_media import media_url
    specification = specification_payload(exam.specification_version) if exam.type == 'multilevel' else None
    profile = speaking_profile(exam.speaking_profile_version)
    if specification:
        result.update(specificationVersion=exam.specification_version, specification=specification)
    if profile:
        result['speakingProfile'] = profile
    if not include_sections: return result
    sections = list(MockSection.objects.filter(exam_id=exam.id).order_by("sort_order"))
    for section in sections:
        shaped = {
            "id": section.id, "skill": section.skill, "title": section.title, "sortOrder": section.sort_order,
            "durationMinutes": section.duration_minutes, "instructions": section.instructions, "groups": [],
        }
        for group_index, group in enumerate(_groups(section)):
            questions = [shape_question(question, answers) for question in _questions(group)]
            if specification:
                for qi, q in enumerate(questions):
                    guidance = task_guidance(section.skill, group_index, qi, exam.speaking_profile_version, exam.specification_version)
                    if guidance is not None:
                        q['guidance'] = guidance
            result["questionCount"] += len(questions)
            shaped["groups"].append({
                "id": group.id, "sortOrder": group.sort_order, "title": group.title, "instructions": group.instructions,
                "passageText": None if specification and not answers and section.skill == 'listening' else group.passage_text, "contentHtml": group.content_html, "contentLayout": group.content_layout,
                "optionsReusable": group.options_reusable, "hasAudio": bool(group.audio_key),
                "audioUrl": media_url(group.id, 'audio') if group.audio_key else None,
                "imageUrl": media_url(group.id, 'image') if group.image_key else None,
                "partNumber": group.part_number, "audioDurationSec": group.audio_duration_sec,
                "audioPlayLimit": 2 if specification and section.skill == 'listening' else group.audio_play_limit, "questions": questions,
                **({"audioScript": group.audio_script, "maxScore": group.max_score, "stimulusRef": group.stimulus_ref} if answers else {}),
            })
        result["sections"].append(shaped)
    return result


def total_duration(exam, sections):
    if exam.type == 'multilevel':
        from .multilevel import SPECS, CURRENT_SPEC
        return sum(SPECS[CURRENT_SPEC][s['skill']]['duration'] for s in sections) or None
    total = 0
    for section in sections:
        if section['skill'] == 'listening':
            duration = sum(g['audioDurationSec'] or 0 for g in section['groups'])
            total += math.ceil(((duration if duration > 0 else 1800) + 120) / 60)
        elif section['skill'] != 'speaking':
            total += section['durationMinutes'] if section['durationMinutes'] is not None else 60
    return total or None


def start_ready(exam):
    from .mock_authoring import _exam_tree, multilevel_readiness
    return exam.type != 'multilevel' or not multilevel_readiness(_exam_tree(exam))['issues']


def list_exams(user, *, program=None, exam_type=None, practice_level=None):
    staff = is_staff(user)
    items = []
    for exam in catalogue_queryset(user, program, exam_type, practice_level):
        data = shape_exam(exam, staff)
        from apps.legacy_schema.models import MockExamImport
        latest = MockExamImport.objects.filter(exam_id=exam.id).order_by('-revision').first()
        data.update({"skills": [section["skill"] for section in data["sections"]], "durationMinutes": total_duration(exam, data['sections']), "price": exam.price, "access": access_for(user, exam), "canEdit": bool(user and (user.role in {"admin", "super_admin"} or (user.role == "teacher" and exam.created_by_id == user.id))), "ready": start_ready(exam), "imported": dict(packageId=latest.package_id, revision=latest.revision, importedAt=latest.created_at) if latest else None})
        data = {k: data[k] for k in ('id', 'type', 'profile', 'title', 'description', 'level', 'practiceLevel', 'isDemo', 'isPublished', 'ready', 'canEdit', 'skills', 'questionCount', 'durationMinutes', 'price', 'access', 'imported')}
        items.append(data)
    return items



def get_exam(user, exam_id: str):
    exam = MockExam.objects.filter(id=exam_id).first()
    if not exam: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)
    staff = is_staff(user)
    if not staff and not exam.is_published and not exam.is_demo: raise ContractAPIException("MOCK_EXAM_NOT_FOUND", "Mock imtihon topilmadi", 404)
    access = access_for(user, exam)
    output = shape_exam(exam, staff)
    if not staff and access != 'granted':
        duration = total_duration(exam, output['sections'])
        output = {k: output[k] for k in ('id', 'type', 'title', 'description', 'level', 'practiceLevel', 'isPublished', 'isDemo', 'createdAt', 'updatedAt', 'contentVersion', 'questionCount')}
        output.update(sections=[], durationMinutes=duration)
    output.update({"ready": start_ready(exam), "price": exam.price, "isFreeForApproved": exam.is_free_for_approved, "access": access})
    return output
