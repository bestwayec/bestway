"""Dynamic Computer-Delivered (CD) Exam Session API Views."""
from __future__ import annotations

import json
from django.db.models import Q
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from .models import Exam, Section, QuestionGroup, Question, AnswerKey
from apps.legacy_schema.models import MockExam, MockSection, MockQuestionGroup, MockQuestion


@api_view(["GET"])
@permission_classes([AllowAny])
def get_cd_exam_session(request, exam_id: str):
    """
    Returns the complete, structured JSON payload for Computer-Delivered (CD) runner.
    Supports lookups by internal UUID or unique exam code (e.g. 'MOCK-RECORD-01').
    """
    exam = Exam.objects.filter(Q(id=exam_id) | Q(code__iexact=exam_id)).first()
    
    if exam:
        return _serialize_cd_exam(exam)
    
    # Fallback to MockExam legacy schema if CD Exam table doesn't have it yet
    legacy_exam = MockExam.objects.filter(Q(id=exam_id) | Q(id__iexact=exam_id)).first()
    if legacy_exam:
        return _serialize_legacy_mock_exam(legacy_exam)
        
    return JsonResponse(
        {"error": {"code": "EXAM_NOT_FOUND", "message": f"Exam '{exam_id}' not found"}},
        status=404
    )


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
                payload = q.payload_json or {}
                options = payload.get("options")
                
                q_list.append({
                    "id": q.id,
                    "number": q.order,
                    "kind": kind_map.get(q.question_type, "single_choice"),
                    "questionType": q.question_type,
                    "prompt": q.prompt,
                    "options": options,
                    "points": q.points,
                    "wordLimit": q.word_limit,
                    "answerRule": payload.get("answerRule"),
                    "guidance": payload.get("guidance"),
                    "payload": payload,
                })
            
            part_dict = {
                "key": grp.id,
                "label": f"Part {grp.part_number}",
                "partNumber": grp.part_number,
                "title": grp.title,
                "instructions": grp.instructions,
                "passageText": grp.passage_html,
                "contentHtml": grp.passage_html,
                "audioUrl": grp.audio_url,
                "imageUrl": grp.media_image,
                "strictAudio": sec.section_type == "listening",
                "questions": q_list,
            }
            sec_parts.append(part_dict)
            all_parts.append(part_dict)
            
        sections_data.append({
            "id": sec.id,
            "skill": sec.section_type,
            "title": sec.title,
            "timeLimit": sec.time_limit,
            "order": sec.order,
            "instructions": sec.instructions,
            "parts": sec_parts,
        })
        
    return JsonResponse({
        "data": {
            "exam": {
                "id": exam.id,
                "code": exam.code,
                "title": exam.title,
                "examType": exam.exam_type,
                "durationMinutes": exam.duration_minutes,
                "isCdFormat": exam.is_cd_format,
                "isPublished": exam.is_published,
                "description": exam.description,
            },
            "sections": sections_data,
            "parts": all_parts,
        }
    })


def _serialize_legacy_mock_exam(legacy: MockExam) -> JsonResponse:
    from .mock_catalog import shape_exam
    shaped = shape_exam(legacy, True)
    
    sections_data = []
    all_parts = []
    
    for sec in shaped.get("sections", []):
        sec_parts = []
        for grp in sec.get("groups", []):
            q_list = []
            for q in grp.get("questions", []):
                q_list.append({
                    "id": q["id"],
                    "number": q["number"],
                    "kind": _ui_kind(q["type"]),
                    "questionType": q["type"],
                    "prompt": q["prompt"],
                    "options": q.get("options"),
                    "points": q["points"],
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
                "key": grp["id"],
                "label": f"Part {grp.get('partNumber') or 1}",
                "partNumber": grp.get("partNumber") or 1,
                "title": grp.get("title"),
                "instructions": grp.get("instructions"),
                "passageText": grp.get("passageText") or grp.get("contentHtml"),
                "contentHtml": grp.get("contentHtml") or grp.get("passageText"),
                "audioUrl": audio_url,
                "imageUrl": img_url,
                "strictAudio": sec.get("skill") == "listening",
                "questions": q_list,
            }
            sec_parts.append(part_dict)
            all_parts.append(part_dict)
            
        sections_data.append({
            "id": sec["id"],
            "skill": sec["skill"],
            "title": sec.get("title", sec["skill"].title()),
            "timeLimit": sec.get("durationMinutes", 35),
            "order": sec.get("sortOrder", 0),
            "instructions": sec.get("instructions", ""),
            "parts": sec_parts,
        })
        
    return JsonResponse({
        "data": {
            "exam": {
                "id": legacy.id,
                "code": legacy.id,
                "title": legacy.title,
                "examType": legacy.type,
                "durationMinutes": 150,
                "isCdFormat": True,
                "isPublished": legacy.is_published,
                "description": legacy.title,
            },
            "sections": sections_data,
            "parts": all_parts,
        }
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
