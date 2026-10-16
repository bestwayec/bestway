"""Topic management views for Writing and Speaking topic bank.

Exposes REST endpoints for listing, viewing, creating, and deleting topics.
Restricted endpoints require super_admin or admin roles.
"""
from __future__ import annotations

import json
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from common.api.exceptions import ContractAPIException
from common.auth.authentication import OptionalMockJWTAuthentication
from . import topic_service as service
from .views import require_role, success


@api_view(["GET", "POST"])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def topics_view(request):
    """GET: List active topics with optional filtering by skill and type.

    POST: Create a new writing or speaking topic (requires super_admin or admin).
    """
    if request.method == "GET":
        skill = request.query_params.get("skill")
        task_type = request.query_params.get("type") or request.query_params.get("task_type")
        raw_limit = request.query_params.get("limit", 10)
        raw_offset = request.query_params.get("offset", 0)
        try:
            limit = int(raw_limit)
        except (TypeError, ValueError):
            limit = 10
        try:
            offset = int(raw_offset)
        except (TypeError, ValueError):
            offset = 0

        active_param = request.query_params.get("active_only") or request.query_params.get("activeOnly")
        active_only = True if active_param is None else str(active_param).lower() not in ("false", "0", "no")

        topics = service.list_topics(
            skill=skill,
            task_type=task_type,
            active_only=active_only,
            limit=limit,
            offset=offset,
        )
        return success(topics)

    # POST: Admin or Superadmin required
    if not request.user or not getattr(request.user, "is_authenticated", False):
        raise ContractAPIException("UNAUTHORIZED", "Avval tizimga kiring", 401)
    require_role(request, "super_admin", "admin")

    data = request.data or {}
    skill = (data.get("skill") or "").strip().lower()
    if skill not in ("writing", "speaking"):
        raise ContractAPIException("VALIDATION_ERROR", "skill 'writing' yoki 'speaking' bo'lishi kerak", 400)

    title = data.get("title")
    target_band = data.get("target_band_level") or data.get("targetBandLevel") or "7.0"
    created_by_id = getattr(request.user, "id", None)

    # Handle image upload if provided in multipart or data
    image_key = data.get("image_key") or data.get("imageKey")
    image_url = data.get("image_url") or data.get("imageUrl")
    image_file = request.FILES.get("image") or request.FILES.get("file")
    if image_file:
        raw_bytes = image_file.read()
        storage_key, public_url = service.save_topic_image(raw_bytes, image_file.content_type)
        image_key = storage_key
        image_url = public_url

    if skill == "writing":
        task_type = data.get("type") or data.get("task_type") or "task2"
        prompt_text = data.get("prompt_text") or data.get("promptText") or data.get("prompt") or ""
        topic = service.create_writing_topic(
            title=title,
            prompt_text=prompt_text,
            task_type=task_type,
            image_key=image_key,
            image_url=image_url,
            target_band_level=target_band,
            created_by_id=created_by_id,
        )
    else:  # speaking
        part = data.get("type") or data.get("part") or "part2"
        prompt_text = data.get("prompt_text") or data.get("promptText") or data.get("prompt") or ""
        bullet_points = data.get("bullet_points") or data.get("bulletPoints")
        followup_questions = data.get("followup_questions") or data.get("followupQuestions")

        if isinstance(bullet_points, str):
            try:
                bullet_points = json.loads(bullet_points)
            except Exception:
                bullet_points = [bp.strip() for bp in bullet_points.split("\n") if bp.strip()]

        if isinstance(followup_questions, str):
            try:
                followup_questions = json.loads(followup_questions)
            except Exception:
                followup_questions = [fq.strip() for fq in followup_questions.split("\n") if fq.strip()]

        topic = service.create_speaking_topic(
            title=title,
            part=part,
            prompt_text=prompt_text,
            bullet_points=bullet_points,
            followup_questions=followup_questions,
            target_band_level=target_band,
            created_by_id=created_by_id,
        )

    return success(topic, status=201)


@api_view(["GET", "DELETE"])
@authentication_classes([OptionalMockJWTAuthentication])
@permission_classes([AllowAny])
def topic_detail_view(request, topic_id: str):
    """GET: Retrieve topic detail.

    DELETE: Soft-delete or hard-delete topic (requires super_admin or admin).
    """
    if request.method == "GET":
        topic = service.get_topic(topic_id)
        if not topic:
            raise ContractAPIException("TOPIC_NOT_FOUND", "Mavzu topilmadi", 404)
        return success(topic)

    # DELETE: Admin or Superadmin required
    if not request.user or not getattr(request.user, "is_authenticated", False):
        raise ContractAPIException("UNAUTHORIZED", "Avval tizimga kiring", 401)
    require_role(request, "super_admin", "admin")

    hard_param = request.query_params.get("hard") or (request.data.get("hard") if isinstance(request.data, dict) else None)
    hard = str(hard_param).lower() in ("true", "1", "yes")

    deleted = service.delete_topic(topic_id, hard=hard)
    if not deleted:
        raise ContractAPIException("TOPIC_NOT_FOUND", "Mavzu topilmadi", 404)
    return success({"deleted": True, "topicId": topic_id})
