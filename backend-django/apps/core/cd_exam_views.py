"""Dynamic Computer-Delivered (CD) Exam Session API Views."""
from __future__ import annotations

import json
from django.db.models import Q
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from .models import Exam, Section, QuestionGroup, Question, AnswerKey
from apps.legacy_schema.models import MockExam, MockSection, MockQuestionGroup, MockQuestion
from . import mock_catalog


def _without_answer_metadata(value):
    """Strip grading secrets even inside nested option metadata."""
    blocked = {'answer', 'answers', 'answerkey', 'correct', 'iscorrect',
               'correctanswer', 'correctanswers', 'validanswers',
               'acceptedvariants', 'solution', 'explanation'}
    if isinstance(value, dict):
        return {key: _without_answer_metadata(item) for key, item in value.items()
                if str(key).replace('_', '').lower() not in blocked}
    if isinstance(value, list):
        return [_without_answer_metadata(item) for item in value]
    return value


def _actor(request):
    user = getattr(request, 'user', None)
    return user if getattr(user, 'is_authenticated', False) else None


def _may_view_legacy(user, exam):
    role = getattr(user, 'role', None)
    if role in ('admin', 'super_admin'):
        return True
    if role == 'teacher':
        return str(exam.created_by_id) == str(user.id)
    if not exam.is_published:
        return False
    return mock_catalog.access_for(user, exam) == 'granted'


def _may_view_cd(user, exam):
    # CD definitions have no author or price field: unpublished material can
    # only be previewed by administrators, never by an unverified teacher.
    # A CD definition shadowing a legacy exam must not bypass its entitlement.
    legacy = MockExam.objects.filter(Q(id=exam.id) | Q(id__iexact=exam.code)).first()
    role = getattr(user, 'role', None)
    if not exam.is_published:
        return role in ('admin', 'super_admin') or bool(
            role == 'teacher' and legacy and str(legacy.created_by_id) == str(user.id))
    return legacy is None or _may_view_legacy(user, legacy)


def _not_found():
    return JsonResponse({"error": {"code": "EXAM_NOT_FOUND", "message": "Exam not found"}}, status=404)


@api_view(["GET"])
@permission_classes([AllowAny])
def get_cd_exam_session(request, exam_id: str):
    """
    Returns the complete, structured JSON payload for Computer-Delivered (CD) runner.
    Supports lookups by internal UUID or unique exam code (e.g. 'MOCK-RECORD-01').
    """
    exam = Exam.objects.filter(Q(id=exam_id) | Q(code__iexact=exam_id)).first()
    
    if exam:
        return _serialize_cd_exam(exam) if _may_view_cd(_actor(request), exam) else _not_found()
    
    # Fallback to MockExam legacy schema if CD Exam table doesn't have it yet
    legacy_exam = MockExam.objects.filter(Q(id=exam_id) | Q(id__iexact=exam_id)).first()
    if legacy_exam:
        return _serialize_legacy_mock_exam(legacy_exam) if _may_view_legacy(_actor(request), legacy_exam) else _not_found()
        
    return _not_found()


@api_view(["GET"])
@permission_classes([AllowAny])
def get_active_cd_exam(request):
    """
    Returns the configured active exam (settings.ACTIVE_CD_EXAM_CODE, default MOCK-RECORD-01).

    Only that exam is considered; when it is missing or not visible to the caller the
    response is 404 NO_ACTIVE_EXAM, never a different exam.
    """
    from django.conf import settings
    code = getattr(settings, "ACTIVE_CD_EXAM_CODE", "MOCK-RECORD-01")
    user = _actor(request)
    exam = Exam.objects.filter(code__iexact=code, is_published=True).first()
    if exam and _may_view_cd(user, exam):
        return _serialize_cd_exam(exam)
    legacy = MockExam.objects.filter(id=code, is_published=True).first()
    if legacy and _may_view_legacy(user, legacy):
        return _serialize_legacy_mock_exam(legacy)
    return JsonResponse(
        {"success": False, "error": {"code": "NO_ACTIVE_EXAM", "message": "No active exam found"}},
        status=404
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def get_mock_list(request):
    """
    Returns a list of published active mock exams for candidate selection.
    """
    items = []
    cd_exams = Exam.objects.filter(is_published=True).order_by("code")
    for e in cd_exams:
        items.append({
            "id": e.code,
            "code": e.code,
            "title": e.title,
            "examType": e.exam_type,
            "durationMinutes": e.duration_minutes,
            "isCdFormat": e.is_cd_format,
            "isPublished": e.is_published,
            "isActive": True,
            "description": e.description,
        })
    legacy_exams = MockExam.objects.filter(is_published=True).exclude(id="multilevel-test-01-gym-vegetarian").order_by("-created_at")
    for le in legacy_exams:
        if not any(item["code"] == le.id for item in items):
            items.append({
                "id": le.id,
                "code": le.id,
                "title": le.title,
                "examType": le.type,
                "durationMinutes": 150,
                "isCdFormat": True,
                "isPublished": le.is_published,
                "isActive": True,
                "description": le.description,
            })
    return JsonResponse({"data": items, "results": items, "count": len(items)})


def _serialize_cd_exam(exam: Exam) -> JsonResponse:
    sections_data = []
    all_parts = []
    
    sections = exam.sections.all().order_by("order")
    for sec in sections:
        sec_parts = []
        groups = sec.groups.all().order_by("sort_order", "part_number")
        
        for grp in groups:
            q_list = []
            for q in grp.questions.all().order_by("order"):
                kind_map = {
                    "single_choice": "single_choice",
                    "in_text_blank": "completion",
                    "speaker_matching": "matching",
                    "map_labeling": "map_label",
                    "matching_statements": "matching",
                    "matching_headings": "matching_headings",
                    "true_false_ng": "tfng",
                    "summary_completion": "completion",
                    "essay": "essay",
                    "speaking_prompt": "speaking",
                }
                raw_payload = q.payload_json if isinstance(q.payload_json, dict) else {}
                payload = _without_answer_metadata({key: raw_payload[key] for key in ('options', 'answerRule', 'guidance', 'imageMapRef') if key in raw_payload})
                options = payload.get("options")
                prompt_text = q.prompt or ""
                
                q_list.append({
                    "id": q.id,
                    "number": q.order,
                    "type": q.question_type,
                    "kind": kind_map.get(q.question_type, "single_choice"),
                    "questionType": q.question_type,
                    "prompt": prompt_text,
                    "text": prompt_text,
                    "options": options if isinstance(options, list) else [],
                    "points": q.points,
                    "score": q.points,
                    "maxScore": q.points,
                    "wordLimit": q.word_limit,
                    "answerRule": payload.get("answerRule"),
                    "guidance": payload.get("guidance"),
                    "payload": payload,
                })
            
            part_dict = {
                "id": grp.id,
                "key": grp.id,
                "label": f"Part {grp.part_number}",
                "partNumber": grp.part_number,
                "sortOrder": grp.sort_order,
                "title": grp.title or f"Part {grp.part_number}",
                "instructions": grp.instructions or "",
                "passageText": grp.passage_html or "",
                "passageHtml": grp.passage_html or "",
                "contentHtml": grp.passage_html or "",
                "audioUrl": grp.audio_url or "",
                "imageUrl": grp.media_image or "",
                "strictAudio": sec.section_type == "listening",
                "questions": q_list,
                "items": q_list,
            }
            sec_parts.append(part_dict)
            all_parts.append(part_dict)
            
        sec_questions = [q for p in sec_parts for q in p["questions"]]
        sections_data.append({
            "id": sec.id,
            "skill": sec.section_type,
            "title": sec.title or sec.section_type.title(),
            "timeLimit": sec.time_limit,
            "durationMinutes": sec.time_limit,
            "order": sec.order,
            "sortOrder": sec.order,
            "instructions": sec.instructions or "",
            "parts": sec_parts,
            "groups": sec_parts,
            "questions": sec_questions,
            "questionCount": len(sec_questions),
        })
        
    total_questions = sum(len(p.get("questions", [])) for p in all_parts)
    exam_payload = {
        "id": exam.id,
        "code": exam.code,
        "title": exam.title,
        "type": "multilevel",
        "examType": exam.exam_type,
        "durationMinutes": exam.duration_minutes,
        "isCdFormat": exam.is_cd_format,
        "isPublished": exam.is_published,
        "description": exam.description or "",
        "questionCount": total_questions,
        "totalQuestions": total_questions,
        "sections": sections_data,
    }
    return JsonResponse({
        "success": True,
        "data": {
            "exam": exam_payload,
            "id": exam.id,
            "code": exam.code,
            "title": exam.title,
            "type": "multilevel",
            "examType": exam.exam_type,
            "durationMinutes": exam.duration_minutes,
            "questionCount": total_questions,
            "totalQuestions": total_questions,
            "sections": sections_data,
            "parts": all_parts,
        },
        "exam": exam_payload,
        "sections": sections_data,
        "parts": all_parts,
        "questionCount": total_questions,
        "totalQuestions": total_questions,
    })


def _serialize_legacy_mock_exam(legacy: MockExam) -> JsonResponse:
    from .mock_catalog import shape_exam
    shaped = shape_exam(legacy, False)
    
    sections_data = []
    all_parts = []
    
    for sec in shaped.get("sections", []):
        sec_parts = []
        for grp in sec.get("groups", []):
            q_list = []
            for q in grp.get("questions", []):
                q = _without_answer_metadata(q)
                p_text = q.get("prompt") or q.get("text") or ""
                q_list.append({
                    "id": q["id"],
                    "number": q["number"],
                    "type": q["type"],
                    "kind": _ui_kind(q["type"]),
                    "questionType": q["type"],
                    "prompt": p_text,
                    "text": p_text,
                    "options": q.get("options") if isinstance(q.get("options"), list) else [],
                    "points": q["points"],
                    "score": q["points"],
                    "maxScore": q["points"],
                    "wordLimit": q.get("wordLimit"),
                    "answerRule": q.get("answerRule"),
                    "guidance": q.get("guidance"),
                    "payload": q,
                })
            audio_key = grp.get("audioKey")
            audio_url = f"/media/{audio_key.lstrip('/')}" if audio_key else None
            img_key = grp.get("imageKey")
            img_url = f"/media/{img_key.lstrip('/')}" if img_key else None
            
            part_dict = {
                "id": grp["id"],
                "key": grp["id"],
                "label": f"Part {grp.get('partNumber') or 1}",
                "partNumber": grp.get("partNumber") or 1,
                "sortOrder": grp.get("sortOrder", 0),
                "title": grp.get("title") or f"Part {grp.get('partNumber') or 1}",
                "instructions": grp.get("instructions") or "",
                "passageText": grp.get("passageText") or grp.get("contentHtml") or "",
                "contentHtml": grp.get("contentHtml") or grp.get("passageText") or "",
                "audioUrl": audio_url or "",
                "imageUrl": img_url or "",
                "strictAudio": sec.get("skill") == "listening",
                "questions": q_list,
                "items": q_list,
            }
            sec_parts.append(part_dict)
            all_parts.append(part_dict)
            
        sec_questions = [q for p in sec_parts for q in p["questions"]]
        sections_data.append({
            "id": sec["id"],
            "skill": sec["skill"],
            "title": sec.get("title", sec["skill"].title()),
            "timeLimit": sec.get("durationMinutes", 35),
            "durationMinutes": sec.get("durationMinutes", 35),
            "order": sec.get("sortOrder", 0),
            "sortOrder": sec.get("sortOrder", 0),
            "instructions": sec.get("instructions", ""),
            "parts": sec_parts,
            "groups": sec_parts,
            "questions": sec_questions,
            "questionCount": len(sec_questions),
        })
        
    total_questions = sum(len(p.get("questions", [])) for p in all_parts)
    exam_payload = {
        "id": legacy.id,
        "code": legacy.id,
        "title": legacy.title,
        "type": legacy.type,
        "examType": legacy.type,
        "durationMinutes": 150,
        "isCdFormat": True,
        "isPublished": legacy.is_published,
        "description": legacy.title,
        "questionCount": total_questions,
        "totalQuestions": total_questions,
        "sections": sections_data,
    }
    return JsonResponse({
        "success": True,
        "data": {
            "exam": exam_payload,
            "id": legacy.id,
            "code": legacy.id,
            "title": legacy.title,
            "type": legacy.type,
            "examType": legacy.type,
            "durationMinutes": 150,
            "questionCount": total_questions,
            "totalQuestions": total_questions,
            "sections": sections_data,
            "parts": all_parts,
        },
        "exam": exam_payload,
        "sections": sections_data,
        "parts": all_parts,
        "questionCount": total_questions,
        "totalQuestions": total_questions,
    })


def _ui_kind(question_type: str) -> str:
    mapping = {
        "multiple_choice": "single_choice",
        "multiple_choice_single": "single_choice",
        "mcq_single": "single_choice",
        "in_text_blank": "completion",
        "sentence_completion": "completion",
        "note_completion": "completion",
        "summary_completion": "completion",
        "matching": "matching",
        "speaker_matching": "matching",
        "map_labeling": "map_label",
        "map_matching": "map_label",
        "matching_headings": "matching_headings",
        "headings": "matching_headings",
        "true_false_not_given": "tfng",
        "true_false_ng": "tfng",
        "essay_task1": "essay",
        "essay_task2": "essay",
        "speaking_part1": "speaking",
        "speaking_part2": "speaking",
        "speaking_part3": "speaking",
    }
    return mapping.get(question_type, "single_choice")
