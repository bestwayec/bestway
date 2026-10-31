"""Unified LMS Video Engine & Bamboozle Game Arena API Views."""

from __future__ import annotations

import os
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny

from common.api.exceptions import ContractAPIException
from .models import Course, Lesson, QuizDeck, UserLessonProgress
from .lms_services import (
    apply_bamboozle_card_effect,
    complete_lesson,
    create_or_update_quiz_deck,
    get_lms_leaderboard,
    get_or_create_progress,
    get_quiz_deck_detail,
    list_quiz_decks,
    stream_video_file,
    hls_is_ready,
    stream_hls_file,
    get_hls_transcode_status,
    trigger_hls_transcoding,
    update_watch_time,
    get_lesson_solo_quiz,
    submit_lesson_solo_quiz,
)
from .views import require_authenticated, require_role, success


@api_view(["GET"])
@permission_classes([AllowAny])
def courses_list_view(request):
    """List all available LMS courses with lesson count and progress."""
    user = None
    try:
        user = require_authenticated(request)
    except Exception:
        pass

    courses = Course.objects.prefetch_related("lessons").all()
    result = []
    for c in courses:
        total_lessons = c.lessons.count()
        completed_count = 0
        if user and user.is_authenticated:
            completed_count = UserLessonProgress.objects.filter(
                user=user,
                lesson__course=c,
                is_completed=True,
            ).count()

        result.append({
            "id": c.id,
            "title": c.title,
            "description": c.description,
            "thumbnail_url": c.thumbnail_url,
            "total_lessons": total_lessons,
            "completed_lessons": completed_count,
        })
    return success(result)


@api_view(["GET"])
@permission_classes([AllowAny])
def course_detail_view(request, course_id):
    """Retrieve course details, its ordered lessons, and user completion progress."""
    try:
        course = Course.objects.prefetch_related("lessons").get(id=course_id)
    except Course.DoesNotExist:
        raise ContractAPIException("COURSE_NOT_FOUND", "Kurs topilmadi", 404)

    user = None
    try:
        user = require_authenticated(request)
    except Exception:
        pass

    completed_lesson_ids = set()
    if user and user.is_authenticated:
        completed_lesson_ids = set(
            UserLessonProgress.objects.filter(
                user=user,
                lesson__course=course,
                is_completed=True,
            ).values_list("lesson_id", flat=True)
        )

    lessons = []
    for idx, l in enumerate(course.lessons.all().order_by("order_index", "created_at"), start=1):
        is_completed = l.id in completed_lesson_ids
        # First lesson is always unlocked, subsequent require previous completed
        is_unlocked = idx == 1 or is_completed
        lessons.append({
            "id": l.id,
            "title": l.title,
            "description": l.description,
            "duration": l.duration,
            "xp_reward": l.xp_reward,
            "order_index": l.order_index,
            "is_completed": is_completed,
            "is_unlocked": is_unlocked,
            "has_quiz": l.quiz_decks.filter(is_lesson_tied=True).exists(),
            "hls_playlist_url": (l.hls_playlist_url or f"/media/videos/hls/{l.id}/playlist.m3u8") if hls_is_ready(l.id) else None,
            "hls_url": f"/v1/lessons/{l.id}/hls/playlist.m3u8" if hls_is_ready(l.id) else None,
        })

    return success({
        "id": course.id,
        "title": course.title,
        "description": course.description,
        "thumbnail_url": course.thumbnail_url,
        "lessons": lessons,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def lessons_list_view(request):
    """List all available lessons across courses for selectors and video feeds."""
    lessons = Lesson.objects.select_related("course").order_by("order_index", "created_at")
    result = []
    for l in lessons:
        deck_id = l.quiz_decks.filter(is_lesson_tied=True).values_list("id", flat=True).first()
        result.append({
            "id": l.id,
            "title": l.title,
            "description": l.description,
            "duration": l.duration,
            "order_index": l.order_index,
            "xp_reward": l.xp_reward,
            "course_id": l.course_id,
            "course_title": l.course.title if l.course else None,
            "has_quiz": bool(deck_id),
            "bamboozle_deck_id": deck_id,
            "hls_playlist_url": (l.hls_playlist_url or f"/media/videos/hls/{l.id}/playlist.m3u8") if hls_is_ready(l.id) else None,
            "hls_url": f"/v1/lessons/{l.id}/hls/playlist.m3u8" if hls_is_ready(l.id) else None,
        })
    return success(result)


@api_view(["GET"])
@permission_classes([AllowAny])
def lesson_stream_view(request, lesson_id):
    """Stream lesson video with strict HTTP Range support (206 Partial Content)."""
    try:
        lesson = Lesson.objects.get(id=lesson_id)
    except Lesson.DoesNotExist:
        raise ContractAPIException("LESSON_NOT_FOUND", "Dars topilmadi", 404)

    file_path = lesson.video_file or ""
    basename = os.path.basename(file_path) if file_path else ""
    # Support relative and mounted paths under media/storage
    candidates = [
        file_path,
        os.path.join(getattr(settings, "STORAGE_DIR", "/app/storage"), file_path),
        os.path.join(getattr(settings, "MEDIA_ROOT", "/app/media"), file_path),
        os.path.join("/app/storage", file_path),
        os.path.join("/app/media", file_path),
        os.path.join("/app/storage/videos", basename),
        os.path.join("/app/storage/videos/grammar", basename),
        os.path.join("/opt/bestway/storage/videos", basename),
        os.path.join("/opt/bestway/storage/videos/grammar", basename),
        os.path.join("/opt/bestway/backend-django/media", file_path),
    ]
    resolved_path = file_path
    for c in candidates:
        if c and os.path.exists(c) and os.path.isfile(c):
            resolved_path = c
            break

    return stream_video_file(resolved_path, request)


@api_view(["GET"])
@permission_classes([AllowAny])
def lesson_hls_playlist_view(request, lesson_id):
    """Serve HLS master playlist for adaptive video streaming."""
    return stream_hls_file(lesson_id, "playlist.m3u8", request)


@api_view(["GET"])
@permission_classes([AllowAny])
def lesson_hls_file_view(request, lesson_id, filename):
    """Serve specific HLS playlist or segment chunk."""
    return stream_hls_file(lesson_id, filename, request)


@api_view(["GET"])
@permission_classes([AllowAny])
def lesson_hls_status_view(request, lesson_id):
    """Return real-time HLS transcode status for player polling."""
    return success(get_hls_transcode_status(lesson_id))


@api_view(["POST"])
@permission_classes([AllowAny])
def lesson_hls_transcode_trigger_view(request, lesson_id):
    """Trigger background HLS transcoding for a lesson."""
    user = require_authenticated(request)
    require_role(user, ["admin", "super_admin", "teacher"])
    result = trigger_hls_transcoding(lesson_id, async_mode=True)
    return success(result)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def lesson_progress_view(request, lesson_id):
    """Retrieve or update watch progress for anti-cheat tracking."""
    user = require_authenticated(request)
    try:
        lesson = Lesson.objects.get(id=lesson_id)
    except Lesson.DoesNotExist:
        raise ContractAPIException("LESSON_NOT_FOUND", "Dars topilmadi", 404)

    if request.method == "POST":
        data = request.data or {}
        current_time = int(data.get("currentTime", 0))
        max_watched = int(data.get("maxWatched", current_time))
        progress = update_watch_time(user, lesson, current_time, max_watched)
    else:
        progress = get_or_create_progress(user, lesson)

    return success({
        "lesson_id": lesson.id,
        "watched_seconds": progress.watched_seconds,
        "max_watched_seconds": progress.max_watched_seconds,
        "is_completed": progress.is_completed,
        "earned_xp": progress.earned_xp,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def lesson_complete_view(request, lesson_id):
    """Submit lesson completion with anti-cheat verification and unlock attached Bamboozle deck."""
    user = require_authenticated(request)
    try:
        lesson = Lesson.objects.get(id=lesson_id)
    except Lesson.DoesNotExist:
        raise ContractAPIException("LESSON_NOT_FOUND", "Dars topilmadi", 404)

    data = request.data or {}
    session_duration = int(data.get("sessionDuration", 0))
    watched_seconds = int(data.get("watchedSeconds", 0))

    result = complete_lesson(user, lesson, session_duration, watched_seconds)
    if not result.get("success"):
        raise ContractAPIException("ANTI_CHEAT_VIOLATION", result.get("message", "Dars to'liq ko'rilmadi"), 400)

    return success(result)


# ============================================================================
# BAMBOOZLE QUIZ DECKS & BATTLE VIEWS
# ============================================================================

@api_view(["GET"])
@permission_classes([AllowAny])
def quiz_decks_list_view(request):
    """List quiz decks for Free Play Arena or lesson integration."""
    category = request.query_params.get("category")
    is_lesson_tied = request.query_params.get("is_lesson_tied")
    if is_lesson_tied is not None:
        is_lesson_tied = is_lesson_tied.lower() in ("true", "1", "yes")

    decks = list_quiz_decks(category=category, is_lesson_tied=is_lesson_tied)
    return success(decks)


@api_view(["GET"])
@permission_classes([AllowAny])
def quiz_deck_detail_view(request, deck_id):
    """Retrieve full quiz deck with cards."""
    user = None
    try:
        user = require_authenticated(request)
    except Exception:
        pass

    deck_data = get_quiz_deck_detail(deck_id, user=user)
    return success(deck_data)


@api_view(["POST"])
@permission_classes([AllowAny])
def quiz_deck_create_view(request):
    """Create a new QuizDeck with cards (Teacher/Admin only)."""
    user = require_authenticated(request)
    require_role(request, "teacher", "admin", "super_admin")

    data = request.data or {}
    deck = create_or_update_quiz_deck(user, data)
    return success({"id": deck.id, "title": deck.title}, status_code=201)


@api_view(["POST"])
@permission_classes([AllowAny])
def bamboozle_card_turn_view(request):
    """Calculate the outcome of a Bamboozle card selection."""
    data = request.data or {}
    active_team = int(data.get("activeTeam", 1))
    card_type = data.get("cardType", "question")
    points = int(data.get("points", 10))
    team1_score = int(data.get("team1Score", 0))
    team2_score = int(data.get("team2Score", 0))
    is_correct = bool(data.get("isCorrect", True))
    has_double = bool(data.get("hasDouble", False))

    t1, t2, message = apply_bamboozle_card_effect(
        active_team=active_team,
        card_type=card_type,
        points=points,
        team1_score=team1_score,
        team2_score=team2_score,
        is_correct=is_correct,
        has_double=has_double,
    )

    return success({
        "team1_score": t1,
        "team2_score": t2,
        "message": message,
        "next_team": 2 if active_team == 1 else 1,
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def lms_leaderboard_view(request):
    """Get global XP leaderboard."""
    period = request.query_params.get("period", "weekly")
    limit = int(request.query_params.get("limit", 20))
    data = get_lms_leaderboard(period=period, limit=limit)
    return success(data)



# ============================================================================
# SOLO GRAMMAR QUIZ VIEWS
# ============================================================================

@api_view(["GET"])
@permission_classes([AllowAny])
def lesson_quiz_view(request, lesson_id):
    """Retrieve question cards for solo grammar practice without surprise cards."""
    data = get_lesson_solo_quiz(lesson_id)
    return success(data)


@api_view(["POST"])
@permission_classes([AllowAny])
def lesson_quiz_submit_view(request, lesson_id):
    """Submit quiz answers, evaluate, award +30 XP if >= 80%, and update completion."""
    user = request.user if request.user and request.user.is_authenticated else None
    answers = request.data.get("answers", {}) if isinstance(request.data, dict) else {}
    result = submit_lesson_solo_quiz(user, lesson_id, answers)
    return success(result)
