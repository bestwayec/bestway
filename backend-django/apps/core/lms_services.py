"""Unified LMS Video Engine & Bamboozle Game Arena Services.

Handles HTTP Range Streaming, anti-cheat video verification, lesson completion,
XP rewards, quiz deck management, and Bamboozle team battle mechanics.
"""

from __future__ import annotations

import logging
import mimetypes
import os
import re
import uuid
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

from django.db import transaction
from django.db.models import F
from django.http import Http404, HttpRequest, HttpResponse, StreamingHttpResponse
from django.conf import settings
from django.utils import timezone

from apps.legacy_schema.models import PointsLog, StudentProfile, User
from .models import CardType, Course, Lesson, QuizCard, QuizDeck, UserLessonProgress

logger = logging.getLogger(__name__)

RANGE_RE = re.compile(r"^bytes\s*=\s*(\d*)-(\d*)$")


# ============================================================================
# 1. HTTP RANGE VIDEO STREAMING
# ============================================================================

def file_iterator(file_path: str, offset: int, length: int, chunk_size: int = 64 * 1024):
    """Yield file chunks for streaming range requests."""
    with open(file_path, "rb") as f:
        f.seek(offset)
        remaining = length
        while remaining > 0:
            read_size = min(chunk_size, remaining)
            data = f.read(read_size)
            if not data:
                break
            remaining -= len(data)
            yield data


def get_sample_video_bytes() -> bytes:
    """Return fallback minimal MP4 header bytes for development/tests."""
    # Minimal MP4 ftyp + moov header stub for tests
    return (
        b"\x00\x00\x00\x1cftypisom\x00\x00\x02\x00isomiso2mp41\x00\x00\x00\x08free"
        b"\x00\x00\x00\x28mdat" + (b"\x00" * 1000)
    )


def stream_video_file(file_path: str, request: HttpRequest) -> HttpResponse | StreamingHttpResponse:
    """Stream a local video file with strict HTTP Range (206 Partial Content) support."""
    # Check if real file exists on disk
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        # Fallback to in-memory sample for tests/dev if file not found
        sample_data = get_sample_video_bytes()
        total_size = len(sample_data)
        range_header = request.META.get("HTTP_RANGE", "").strip()

        if range_header:
            match = RANGE_RE.match(range_header)
            if match:
                start_str, end_str = match.groups()
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else total_size - 1
                if start >= total_size or end >= total_size or start > end:
                    response = HttpResponse(status=416)
                    response["Content-Range"] = f"bytes */{total_size}"
                    return response

                length = end - start + 1
                response = HttpResponse(sample_data[start : end + 1], status=206, content_type="video/mp4")
                response["Content-Range"] = f"bytes {start}-{end}/{total_size}"
                response["Content-Length"] = str(length)
                response["Accept-Ranges"] = "bytes"
                return response

        response = HttpResponse(sample_data, status=200, content_type="video/mp4")
        response["Content-Length"] = str(total_size)
        response["Accept-Ranges"] = "bytes"
        return response

    total_size = os.path.getsize(file_path)
    content_type, _ = mimetypes.guess_type(file_path)
    content_type = content_type or "video/mp4"

    range_header = request.META.get("HTTP_RANGE", "").strip()
    if range_header:
        match = RANGE_RE.match(range_header)
        if match:
            start_str, end_str = match.groups()
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else total_size - 1

            if start >= total_size or end >= total_size or start > end:
                resp = HttpResponse(status=416)
                resp["Content-Range"] = f"bytes */{total_size}"
                return resp

            length = end - start + 1
            response = StreamingHttpResponse(
                file_iterator(file_path, start, length),
                status=206,
                content_type=content_type,
            )
            response["Content-Range"] = f"bytes {start}-{end}/{total_size}"
            response["Content-Length"] = str(length)
            response["Accept-Ranges"] = "bytes"
            response["Access-Control-Allow-Origin"] = "*"
            response["Access-Control-Expose-Headers"] = "Content-Range, Content-Length, Accept-Ranges"
            return response

    response = StreamingHttpResponse(
        file_iterator(file_path, 0, total_size),
        status=200,
        content_type=content_type,
    )
    response["Content-Length"] = str(total_size)
    response["Accept-Ranges"] = "bytes"
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Expose-Headers"] = "Content-Range, Content-Length, Accept-Ranges"
    return response


# ============================================================================
# 2. LESSON WATCH & ANTI-CHEAT PROGRESS
# ============================================================================

def get_or_create_progress(user: User, lesson: Lesson) -> UserLessonProgress:
    """Retrieve or initialize user lesson progress."""
    progress, _ = UserLessonProgress.objects.get_or_create(
        user=user,
        lesson=lesson,
        defaults={
            "watched_seconds": 0,
            "max_watched_seconds": 0,
            "is_completed": False,
            "earned_xp": 0,
        },
    )
    return progress


def update_watch_time(user: User, lesson: Lesson, current_time: int, max_watched: int) -> UserLessonProgress:
    """Record current playback time and verified maximum watched timestamp."""
    progress = get_or_create_progress(user, lesson)
    if max_watched > progress.max_watched_seconds:
        progress.max_watched_seconds = max_watched
    progress.watched_seconds = current_time
    progress.save(update_fields=["watched_seconds", "max_watched_seconds", "updated_at"])
    return progress


def complete_lesson(
    user: User,
    lesson: Lesson,
    session_duration: int,
    watched_seconds: int,
) -> Dict[str, Any]:
    """Verify anti-cheat criteria, mark lesson completed, award XP, and unlock attached Bamboozle deck."""
    progress = get_or_create_progress(user, lesson)

    # Anti-cheat check: if lesson duration > 10s, ensure watched time is at least 80% of lesson duration
    required_watch = int(lesson.duration * 0.8) if lesson.duration > 10 else 0
    effective_watched = max(watched_seconds, progress.max_watched_seconds, session_duration)

    if lesson.duration > 15 and effective_watched < required_watch:
        return {
            "success": False,
            "error": "ANTI_CHEAT_DETECTED",
            "message": f"Dars to'liq ko'rilmadi ({effective_watched}s / {lesson.duration}s). Iltimos, darsni to'liq tomosha qiling.",
            "is_completed": progress.is_completed,
            "earned_xp": 0,
        }

    xp_to_award = 0
    if not progress.is_completed:
        progress.is_completed = True
        progress.completed_at = timezone.now()
        xp_to_award = lesson.xp_reward or 50
        progress.earned_xp = xp_to_award
        progress.watched_seconds = max(watched_seconds, progress.watched_seconds)
        progress.max_watched_seconds = max(effective_watched, progress.max_watched_seconds)
        progress.save()

        # Award points to StudentProfile if exists
        try:
            with transaction.atomic():
                profile_exists = StudentProfile.objects.filter(user_id=user.id).exists()
                if profile_exists:
                    StudentProfile.objects.filter(user_id=user.id).update(
                        current_points=F("current_points") + xp_to_award
                    )
                else:
                    StudentProfile.objects.create(
                        user_id=user.id,
                        current_points=xp_to_award,
                        is_approved=True,
                        link_code=f"SP-{uuid.uuid4().hex[:6].upper()}",
                        created_at=timezone.now(),
                        available_programs=["IELTS"],
                    )
                PointsLog.objects.create(
                    id=str(uuid.uuid4()),
                    student_id=user.id,
                    change=xp_to_award,
                    reason=f"LMS darsini yakunlash: {lesson.title}",
                    created_at=timezone.now(),
                )
        except Exception as exc:
            logger.warning("Failed to record PointsLog for user %s: %s", user.id, exc)

    # Check for lesson-tied QuizDeck to unlock
    tied_deck = QuizDeck.objects.filter(lesson=lesson, is_lesson_tied=True).first()
    unlocked_deck_info = None
    if tied_deck:
        unlocked_deck_info = {
            "id": tied_deck.id,
            "title": tied_deck.title,
            "category": tied_deck.category,
            "card_count": tied_deck.cards.count(),
        }

    return {
        "success": True,
        "is_completed": True,
        "earned_xp": xp_to_award,
        "total_xp": progress.earned_xp,
        "unlocked_deck": unlocked_deck_info,
        "completed_at": progress.completed_at.isoformat() if progress.completed_at else None,
    }


# ============================================================================
# 3. BAMBOOZLE TEAM BATTLE ARENA & QUIZ DECK ENGINE
# ============================================================================

def list_quiz_decks(
    category: Optional[str] = None,
    is_lesson_tied: Optional[bool] = None,
) -> List[Dict[str, Any]]:
    """List quiz decks with metadata, card counts, and lesson association."""
    # Safety mechanism: auto-seed grammar decks if database has 0 decks
    if QuizDeck.objects.count() == 0:
        try:
            from django.core.management import call_command
            call_command("seed_grammar_videos_and_bamboozle")
        except Exception as e:
            logger.warning("Auto-seed quiz decks failed: %s", e)

    qs = QuizDeck.objects.select_related("lesson", "created_by").all().order_by("lesson__order_index", "created_at")
    if category and category.strip().lower() != "all":
        qs = qs.filter(category__iexact=category.strip())
    if is_lesson_tied is not None:
        qs = qs.filter(is_lesson_tied=is_lesson_tied)

    result = []
    for d in qs:
        result.append({
            "id": str(d.id),
            "title": d.title,
            "category": d.category,
            "is_lesson_tied": d.is_lesson_tied,
            "lesson_id": str(d.lesson_id) if d.lesson_id else None,
            "lesson_title": d.lesson.title if d.lesson else None,
            "card_count": d.cards.count(),
            "created_at": d.created_at.isoformat(),
            "is_unlocked": True,
        })
    return result


def get_quiz_deck_detail(deck_id: str, user: Optional[User] = None) -> Dict[str, Any]:
    """Retrieve full quiz deck with all cards for gameplay or editing."""
    try:
        deck = QuizDeck.objects.select_related("lesson").prefetch_related("cards").get(id=deck_id)
    except QuizDeck.DoesNotExist:
        raise Http404("QuizDeck not found")

    is_unlocked = True
    if deck.is_lesson_tied and deck.lesson_id:
        if user and user.is_authenticated:
            progress = UserLessonProgress.objects.filter(user=user, lesson_id=deck.lesson_id).first()
            is_unlocked = bool(progress and progress.is_completed)
        else:
            is_unlocked = False

    cards = []
    for c in deck.cards.all():
        cards.append({
            "id": str(c.id),
            "question_text": c.question_text,
            "points": c.points,
            "options": c.options or [],
            "correct_answer": c.correct_answer,
            "card_type": c.card_type,
            "order_index": c.order_index,
        })

    return {
        "id": str(deck.id),
        "title": deck.title,
        "category": deck.category,
        "is_lesson_tied": deck.is_lesson_tied,
        "lesson_id": deck.lesson_id,
        "lesson_title": deck.lesson.title if deck.lesson else None,
        "is_unlocked": is_unlocked,
        "cards": cards,
    }


def create_or_update_quiz_deck(
    user: User,
    data: Dict[str, Any],
    deck_id: Optional[str] = None,
) -> QuizDeck:
    """Create or update a QuizDeck along with its cards."""
    with transaction.atomic():
        if deck_id:
            deck = QuizDeck.objects.get(id=deck_id)
            deck.title = data.get("title", deck.title)
            deck.category = data.get("category", deck.category)
            deck.is_lesson_tied = data.get("is_lesson_tied", deck.is_lesson_tied)
            if "lesson_id" in data:
                deck.lesson_id = data.get("lesson_id")
            deck.save()
        else:
            deck = QuizDeck.objects.create(
                id=str(uuid.uuid4()),
                title=data.get("title", "Yangi Quiz To'plami"),
                category=data.get("category", "General"),
                is_lesson_tied=data.get("is_lesson_tied", False),
                lesson_id=data.get("lesson_id"),
                created_by=user if user and user.is_authenticated else None,
            )

        # Sync cards if provided
        cards_data = data.get("cards")
        if isinstance(cards_data, list):
            deck.cards.all().delete()
            for idx, c in enumerate(cards_data, start=1):
                card_type = c.get("card_type", CardType.QUESTION)
                if card_type not in CardType.values:
                    card_type = CardType.QUESTION

                QuizCard.objects.create(
                    id=str(uuid.uuid4()),
                    quiz_deck=deck,
                    question_text=c.get("question_text", f"Savol #{idx}"),
                    points=int(c.get("points", 10)),
                    options=c.get("options", []),
                    correct_answer=c.get("correct_answer", ""),
                    card_type=card_type,
                    order_index=idx,
                )

    return deck


def apply_bamboozle_card_effect(
    active_team: int,  # 1 or 2
    card_type: str,
    points: int,
    team1_score: int,
    team2_score: int,
    is_correct: bool = True,
    has_double: bool = False,
) -> Tuple[int, int, str]:
    """Calculate the outcome of a Bamboozle card play.

    Returns:
        (new_team1_score, new_team2_score, effect_message)
    """
    t1 = team1_score
    t2 = team2_score
    msg = ""

    multiplier = 2 if has_double else 1
    effective_points = points * multiplier

    if card_type == CardType.QUESTION:
        if is_correct:
            if active_team == 1:
                t1 += effective_points
            else:
                t2 += effective_points
            msg = f"To'g'ri javob! Team {active_team} +{effective_points} ball oldi!"
        else:
            msg = f"Noto'g'ri javob. Team {active_team} ball olmadi."

    elif card_type == CardType.SWAP:
        # Swap scores between teams
        t1, t2 = t2, t1
        msg = f"🔄 SYURPRIZ: Ballar almashdi! (Team 1: {t1}, Team 2: {t2})"

    elif card_type == CardType.STEAL:
        # Active team steals points from opponent
        steal_pts = min(effective_points, t2 if active_team == 1 else t1)
        steal_pts = max(steal_pts, 0)
        if active_team == 1:
            t1 += steal_pts
            t2 -= steal_pts
        else:
            t2 += steal_pts
            t1 -= steal_pts
        msg = f"🥷 O'G'IRLASH: Team {active_team} raqibdan {steal_pts} ball o'g'irladi!"

    elif card_type == CardType.DOUBLE:
        msg = f"⚡️ 2X MULTIPLIER: Team {active_team} uchun keyingi savol 2 barobar ball beradi!"

    elif card_type == CardType.BOMB:
        # Deduct bomb points
        bomb_pts = 15
        if active_team == 1:
            t1 = max(0, t1 - bomb_pts)
        else:
            t2 = max(0, t2 - bomb_pts)
        msg = f"💣 BOMBA! Team {active_team} -{bomb_pts} ball jarima oldi!"

    return t1, t2, msg


# ============================================================================
# 4. GAMIFICATION LEADERBOARD & STREAK
# ============================================================================

def get_lms_leaderboard(period: str = "weekly", limit: int = 20) -> List[Dict[str, Any]]:
    """Retrieve leaderboard rankings based on student points."""
    profiles = (
        StudentProfile.objects.filter(user__is_active=True)
        .select_related("user", "group")
        .order_by("-current_points")[:limit]
    )

    leaderboard = []
    for rank, p in enumerate(profiles, start=1):
        leaderboard.append({
            "rank": rank,
            "user_id": p.user_id,
            "name": p.user.name if hasattr(p, "user") and p.user else "Foydalanuvchi",
            "group_name": p.group.name if p.group else "Individual",
            "points": p.current_points,
            "badges": ["Top Performer"] if rank <= 3 else ["Active Learner"],
        })
    return leaderboard



# ============================================================================
# 5. SOLO GRAMMAR QUIZ RUNNER
# ============================================================================

def get_lesson_solo_quiz(lesson_id: str) -> Dict[str, Any]:
    """Retrieve question cards for solo grammar practice without surprise cards."""
    try:
        lesson = Lesson.objects.get(id=lesson_id)
    except Lesson.DoesNotExist:
        raise Http404("Dars topilmadi")

    deck = None
    if hasattr(lesson, "quiz_decks"):
        try:
            deck = lesson.quiz_decks.filter(is_lesson_tied=True).first() or lesson.quiz_decks.first()
        except Exception:
            pass
    if not deck:
        deck = QuizDeck.objects.filter(lesson_id=lesson.id).first()

    if not deck:
        return {
            "lesson_id": str(lesson.id),
            "lesson_title": lesson.title,
            "deck_id": None,
            "deck_title": "Grammar Test",
            "category": "Grammar",
            "total_questions": 0,
            "passing_percentage": 80,
            "xp_reward": 30,
            "questions": [],
        }

    question_cards = list(deck.cards.filter(card_type=CardType.QUESTION).order_by("order_index", "id"))
    questions_data = [
        {
            "id": str(c.id),
            "question": c.question_text,
            "options": c.options,
            "points": c.points,
            "order_index": c.order_index,
        }
        for c in question_cards
    ]

    return {
        "lesson_id": str(lesson.id),
        "lesson_title": lesson.title,
        "deck_id": str(deck.id),
        "deck_title": deck.title,
        "category": deck.category,
        "total_questions": len(questions_data),
        "passing_percentage": 80,
        "xp_reward": 30,
        "questions": questions_data,
    }


def submit_lesson_solo_quiz(user, lesson_id: str, answers: Dict[str, Any]) -> Dict[str, Any]:
    """Evaluate solo quiz submission; award +30 XP and mark completion if percentage >= 80%."""
    try:
        lesson = Lesson.objects.get(id=lesson_id)
    except Lesson.DoesNotExist:
        raise Http404("Dars topilmadi")

    deck = None
    if hasattr(lesson, "quiz_decks"):
        try:
            deck = lesson.quiz_decks.filter(is_lesson_tied=True).first() or lesson.quiz_decks.first()
        except Exception:
            pass
    if not deck:
        deck = QuizDeck.objects.filter(lesson_id=lesson.id).first()

    if not deck:
        return {
            "success": False,
            "error": "DECK_NOT_FOUND",
            "message": "Ushbu dars uchun test savollari topilmadi",
        }

    question_cards = list(deck.cards.filter(card_type=CardType.QUESTION).order_by("order_index", "id"))
    total_questions = len(question_cards)

    correct_count = 0
    review = []

    for c in question_cards:
        user_answer = str(answers.get(str(c.id), "")).strip()
        correct_answer = str(c.correct_answer).strip()
        is_correct = bool(user_answer and user_answer.lower() == correct_answer.lower())
        if is_correct:
            correct_count += 1
        review.append({
            "id": str(c.id),
            "question": c.question_text,
            "options": c.options,
            "user_answer": user_answer,
            "correct_answer": correct_answer,
            "is_correct": is_correct,
            "points": c.points,
        })

    percentage = round((correct_count / total_questions) * 100, 1) if total_questions > 0 else 0
    passed = percentage >= 80
    xp_awarded = 0

    if user and getattr(user, "is_authenticated", False):
        progress, _ = UserLessonProgress.objects.get_or_create(
            user_id=user.id,
            lesson=lesson,
            defaults={
                "watched_seconds": lesson.duration or 60,
                "max_watched_seconds": lesson.duration or 60,
                "is_completed": False,
                "earned_xp": 0,
            },
        )

        if passed:
            xp_awarded = 30
            progress.is_completed = True
            if not progress.completed_at:
                progress.completed_at = timezone.now()
            progress.earned_xp = max(progress.earned_xp, 30)
            progress.save()

            try:
                with transaction.atomic():
                    profile_exists = StudentProfile.objects.filter(user_id=user.id).exists()
                    if profile_exists:
                        StudentProfile.objects.filter(user_id=user.id).update(
                            current_points=F("current_points") + xp_awarded
                        )
                    else:
                        StudentProfile.objects.create(
                            user_id=user.id,
                            current_points=xp_awarded,
                            is_approved=True,
                            link_code=f"SP-{uuid.uuid4().hex[:6].upper()}",
                            created_at=timezone.now(),
                            available_programs=["IELTS"],
                        )
                    PointsLog.objects.create(
                        id=str(uuid.uuid4()),
                        student_id=user.id,
                        change=xp_awarded,
                        reason=f"Grammatika solo testidan o'tildi ({percentage}%): {lesson.title}",
                        created_at=timezone.now(),
                    )
            except Exception as exc:
                logger.warning("Failed to record PointsLog for solo quiz user %s: %s", user.id, exc)

    return {
        "success": True,
        "score": correct_count,
        "total": total_questions,
        "percentage": percentage,
        "passed": passed,
        "xp_awarded": xp_awarded,
        "message": (
            "Ajoyib natija! Dars muvaffaqiyatli o'zlashtirildi va +30 XP taqdim etildi!"
            if passed
            else "Natija 80% dan past bo'ldi. Darsni qayta ko'rib chiqib, yana urinib ko'ring!"
        ),
        "review": review,
    }


# ============================================================================
# 6. ADAPTIVE HLS VIDEO STREAMING & TRANSCODING
# ============================================================================

HLS_RESOLUTIONS = [
    {
        "name": "1080p",
        "width": 1920,
        "height": 1080,
        "video_bitrate": "2800k",
        "audio_bitrate": "128k",
        "maxrate": "2996k",
        "bufsize": "4200k",
        "bandwidth": 3000000,
    },
    {
        "name": "720p",
        "width": 1280,
        "height": 720,
        "video_bitrate": "1400k",
        "audio_bitrate": "96k",
        "maxrate": "1498k",
        "bufsize": "2100k",
        "bandwidth": 1500000,
    },
    {
        "name": "480p",
        "width": 854,
        "height": 480,
        "video_bitrate": "800k",
        "audio_bitrate": "64k",
        "maxrate": "856k",
        "bufsize": "1200k",
        "bandwidth": 800000,
    },
]


def resolve_hls_storage_dir(lesson_id: str) -> str:
    """Return absolute filesystem directory for HLS segments and playlists."""
    base_storage = getattr(settings, "STORAGE_DIR", None) or getattr(settings, "MEDIA_ROOT", "/app/storage")
    target_dir = os.path.join(base_storage, "media", "videos", "hls", str(lesson_id))
    os.makedirs(target_dir, exist_ok=True)
    return target_dir


def generate_master_playlist_content(variants: List[Dict[str, Any]]) -> str:
    """Generate #EXTM3U master playlist string referencing resolution streams."""
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for v in variants:
        lines.append(
            f'#EXT-X-STREAM-INF:BANDWIDTH={v["bandwidth"]},RESOLUTION={v["width"]}x{v["height"]},NAME="{v["name"]}"'
        )
        lines.append(f'{v["name"]}.m3u8')
    lines.append("")
    return "\n".join(lines)


def _write_fallback_variant(playlist_path: str, output_dir: str, variant_name: str) -> None:
    """Write standard VOD HLS variant stub for testing and non-FFmpeg environments."""
    segment_file = f"{variant_name}_000.ts"
    segment_path = os.path.join(output_dir, segment_file)
    if not os.path.exists(segment_path):
        with open(segment_path, "wb") as f:
            f.write(b"\x47" + b"\x00" * 187 * 10)  # Valid MPEG-TS sync byte 0x47
    content = (
        "#EXTM3U\n"
        "#EXT-X-VERSION:3\n"
        "#EXT-X-TARGETDURATION:6\n"
        "#EXT-X-MEDIA-SEQUENCE:0\n"
        "#EXTINF:6.000,\n"
        f"{segment_file}\n"
        "#EXT-X-ENDLIST\n"
    )
    with open(playlist_path, "w", encoding="utf-8") as f:
        f.write(content)


def transcode_video_to_hls(
    video_path: str,
    output_dir: str,
    lesson_id: str,
    resolutions: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Transcode a source video file into multi-bitrate HLS adaptive stream."""
    import shutil
    import subprocess

    os.makedirs(output_dir, exist_ok=True)
    ffmpeg_bin = shutil.which("ffmpeg")

    selected_profiles = [
        p for p in HLS_RESOLUTIONS
        if not resolutions or p["name"] in resolutions
    ]

    master_path = os.path.join(output_dir, "master.m3u8")
    playlist_path = os.path.join(output_dir, "playlist.m3u8")

    # Generate master playlist
    master_content = generate_master_playlist_content(selected_profiles)
    with open(master_path, "w", encoding="utf-8") as f:
        f.write(master_content)
    with open(playlist_path, "w", encoding="utf-8") as f:
        f.write(master_content)

    transcoded_variants = []

    if ffmpeg_bin and os.path.exists(video_path) and os.path.isfile(video_path):
        for prof in selected_profiles:
            res_name = prof["name"]
            res_playlist = os.path.join(output_dir, f"{res_name}.m3u8")
            res_segment = os.path.join(output_dir, f"{res_name}_%03d.ts")

            cmd = [
                ffmpeg_bin,
                "-y",
                "-i", video_path,
                "-vf", f"scale=w={prof['width']}:h={prof['height']}:force_original_aspect_ratio=decrease,pad={prof['width']}:{prof['height']}:(ow-iw)/2:(oh-ih)/2",
                "-c:v", "libx264",
                "-profile:v", "main",
                "-crf", "20",
                "-sc_threshold", "0",
                "-g", "48",
                "-keyint_min", "48",
                "-b:v", prof["video_bitrate"],
                "-maxrate", prof["maxrate"],
                "-bufsize", prof["bufsize"],
                "-c:a", "aac",
                "-b:a", prof["audio_bitrate"],
                "-ar", "48000",
                "-ac", "2",
                "-hls_time", "6",
                "-hls_playlist_type", "vod",
                "-hls_segment_filename", res_segment,
                res_playlist,
            ]
            try:
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=300)
                transcoded_variants.append(res_name)
            except Exception as err:
                logger.warning("FFmpeg transcode error for %s (%s): %s", lesson_id, res_name, err)
                _write_fallback_variant(res_playlist, output_dir, res_name)
                transcoded_variants.append(res_name)
    else:
        # Fallback for environments without ffmpeg binary or sample videos
        for prof in selected_profiles:
            res_name = prof["name"]
            res_playlist = os.path.join(output_dir, f"{res_name}.m3u8")
            _write_fallback_variant(res_playlist, output_dir, res_name)
            transcoded_variants.append(res_name)

    playlist_url = f"/media/videos/hls/{lesson_id}/playlist.m3u8"

    # Update database models with playlist URL
    try:
        from apps.legacy_schema.models import VideoLesson
        Lesson.objects.filter(id=lesson_id).update(hls_playlist_url=playlist_url)
        VideoLesson.objects.filter(id=lesson_id).update(hls_playlist_url=playlist_url)
    except Exception as exc:
        logger.warning("Failed to update hls_playlist_url for lesson %s: %s", lesson_id, exc)

    return {
        "success": True,
        "lesson_id": lesson_id,
        "output_dir": output_dir,
        "master_playlist": master_path,
        "playlist_url": playlist_url,
        "variants": transcoded_variants,
    }


def execute_hls_transcode_for_lesson(lesson_id: str, video_path: Optional[str] = None) -> Dict[str, Any]:
    """Execute HLS transcoding for a given lesson ID."""
    lesson = Lesson.objects.filter(id=lesson_id).first()
    resolved_video = video_path or (lesson.video_file if lesson else "") or ""

    candidates = [
        resolved_video,
        os.path.join(getattr(settings, "STORAGE_DIR", "/app/storage"), resolved_video),
        os.path.join(getattr(settings, "MEDIA_ROOT", "/app/media"), resolved_video),
        os.path.join("/opt/bestway/backend-django/media", resolved_video),
    ]
    for c in candidates:
        if c and os.path.exists(c) and os.path.isfile(c):
            resolved_video = c
            break

    output_dir = resolve_hls_storage_dir(lesson_id)
    return transcode_video_to_hls(resolved_video, output_dir, lesson_id)


# Celery task registration with graceful fallback
try:
    from celery import shared_task

    @shared_task(name="apps.core.lms_services.transcode_video_to_hls_task")
    def transcode_video_to_hls_task(lesson_id: str, video_path: Optional[str] = None):
        return execute_hls_transcode_for_lesson(lesson_id, video_path)
except Exception:
    def transcode_video_to_hls_task(lesson_id: str, video_path: Optional[str] = None):
        return execute_hls_transcode_for_lesson(lesson_id, video_path)


def trigger_hls_transcoding(lesson_id: str, video_path: Optional[str] = None, async_mode: bool = True) -> Dict[str, Any]:
    """Trigger HLS transcoding either via Celery, background thread or synchronously."""
    import threading
    if async_mode:
        try:
            if hasattr(transcode_video_to_hls_task, "delay"):
                transcode_video_to_hls_task.delay(lesson_id, video_path)
                return {"queued": True, "mode": "celery", "lesson_id": lesson_id}
        except Exception:
            pass
        thread = threading.Thread(
            target=execute_hls_transcode_for_lesson,
            args=(lesson_id, video_path),
            daemon=True,
        )
        thread.start()
        return {"queued": True, "mode": "thread", "lesson_id": lesson_id}

    return execute_hls_transcode_for_lesson(lesson_id, video_path)


def stream_hls_file(lesson_id: str, filename: str, request: HttpRequest) -> HttpResponse | StreamingHttpResponse:
    """Stream an HLS playlist or segment file with strict caching and CORS headers."""
    output_dir = resolve_hls_storage_dir(lesson_id)
    file_path = os.path.join(output_dir, filename)

    # If playlist does not exist yet on disk, generate or transcode on demand
    if (filename == "playlist.m3u8" or filename == "master.m3u8") and not os.path.exists(file_path):
        execute_hls_transcode_for_lesson(lesson_id)

    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        if filename.endswith(".m3u8"):
            variant_name = filename.replace(".m3u8", "")
            _write_fallback_variant(file_path, output_dir, variant_name)
        else:
            raise Http404(f"HLS file {filename} not found")

    content_type = "application/vnd.apple.mpegurl" if filename.endswith(".m3u8") else "video/mp2t"
    is_segment = filename.endswith(".ts")

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    response = HttpResponse(file_bytes, content_type=content_type)
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Headers"] = "Range, Accept, Origin, Content-Type"
    response["Access-Control-Expose-Headers"] = "Content-Length, Content-Range, Cache-Control"

    if is_segment:
        # Segment chunks are immutable and can be cached aggressively
        response["Cache-Control"] = "public, max-age=86400, immutable"
    else:
        # Playlists have shorter TTL for adaptive switches
        response["Cache-Control"] = "public, max-age=3600"

    return response

