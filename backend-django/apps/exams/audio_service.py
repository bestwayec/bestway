"""Audio Optimization Pipeline for Speaking Recordings.

Compresses user-submitted speech recordings into high-efficiency 32kbps mono Opus/WebM,
drastically reducing storage usage and bandwidth while maintaining high acoustic clarity
for Deepgram STT and AI grading models.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from django.conf import settings

logger = logging.getLogger(__name__)


def resolve_media_path(file_key_or_path: str) -> str:
    """Resolve storage key or relative path to absolute filesystem path."""
    if os.path.isabs(file_key_or_path) and os.path.exists(file_key_or_path):
        return file_key_or_path

    storage_dir = getattr(settings, "STORAGE_DIR", None) or getattr(settings, "MEDIA_ROOT", "/app/storage")
    candidates = [
        file_key_or_path,
        os.path.join(storage_dir, file_key_or_path),
        os.path.join(storage_dir, "media", file_key_or_path),
        os.path.join(storage_dir, "audio", file_key_or_path),
        os.path.join("/app/storage", file_key_or_path),
        os.path.join("/app/storage", "audio", file_key_or_path),
        os.path.join("/opt/bestway/backend-django/media", file_key_or_path),
    ]
    for c in candidates:
        if os.path.exists(c) and os.path.isfile(c):
            return c
    return os.path.join(storage_dir, file_key_or_path)


def optimize_speaking_audio(
    input_file_path: str,
    output_file_path: Optional[str] = None,
    bitrate: str = "32k",
    sample_rate: int = 24000,
    replace_original: bool = False,
) -> Dict[str, Any]:
    """Compress audio recording to 32kbps mono Opus format using FFmpeg.

    Args:
        input_file_path: Filesystem path to raw or uploaded audio.
        output_file_path: Target path for .opus output. If None, derives from input.
        bitrate: Target audio bitrate (default '32k').
        sample_rate: Target sampling rate in Hz (default 24000).
        replace_original: If True and compression succeeds, removes the uncompressed input.

    Returns:
        Dictionary with compression metrics (saved_bytes, saved_percentage, file_path).
    """
    resolved_input = resolve_media_path(input_file_path)
    if not os.path.exists(resolved_input) or not os.path.isfile(resolved_input):
        logger.warning("Audio file not found for compression: %s", resolved_input)
        return {
            "success": False,
            "error": "FILE_NOT_FOUND",
            "file_path": resolved_input,
            "original_size": 0,
            "compressed_size": 0,
            "saved_bytes": 0,
            "saved_percentage": 0.0,
        }

    original_size = os.path.getsize(resolved_input)

    # Derive output path if not specified
    if not output_file_path:
        base_root, _ = os.path.splitext(resolved_input)
        output_file_path = f"{base_root}_opt.opus"

    os.makedirs(os.path.dirname(os.path.abspath(output_file_path)), exist_ok=True)

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        logger.info("FFmpeg binary not detected in PATH; skipping audio compression for %s", resolved_input)
        return {
            "success": True,
            "optimized": False,
            "reason": "FFMPEG_UNAVAILABLE",
            "file_path": resolved_input,
            "original_size": original_size,
            "compressed_size": original_size,
            "saved_bytes": 0,
            "saved_percentage": 0.0,
        }

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", resolved_input,
        "-c:a", "libopus",
        "-b:a", bitrate,
        "-ac", "1",  # Mono
        "-ar", str(sample_rate),
        "-vbr", "on",
        "-application", "voip",
        output_file_path,
    ]

    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=120)
        compressed_size = os.path.getsize(output_file_path)
        saved_bytes = max(0, original_size - compressed_size)
        saved_percentage = round((saved_bytes / original_size) * 100, 2) if original_size > 0 else 0.0

        if replace_original and resolved_input != output_file_path:
            try:
                os.remove(resolved_input)
            except OSError as rem_err:
                logger.warning("Could not delete original raw audio %s: %s", resolved_input, rem_err)

        logger.info(
            "Compressed speaking audio %s: %d -> %d bytes (saved %s%%)",
            os.path.basename(resolved_input),
            original_size,
            compressed_size,
            saved_percentage,
        )
        return {
            "success": True,
            "optimized": True,
            "format": "opus",
            "channels": 1,
            "bitrate": bitrate,
            "original_size": original_size,
            "compressed_size": compressed_size,
            "saved_bytes": saved_bytes,
            "saved_percentage": saved_percentage,
            "file_path": output_file_path,
        }
    except Exception as exc:
        logger.warning("FFmpeg compression failed for %s: %s", resolved_input, exc)
        return {
            "success": True,
            "optimized": False,
            "error": str(exc),
            "file_path": resolved_input,
            "original_size": original_size,
            "compressed_size": original_size,
            "saved_bytes": 0,
            "saved_percentage": 0.0,
        }


def compress_speaking_audio_for_answer(
    audio_key_or_path: str,
    attempt_id: Optional[str] = None,
    question_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Process an uploaded speaking answer, compress to Opus, and update MockAnswer."""
    result = optimize_speaking_audio(audio_key_or_path, replace_original=False)

    if result.get("optimized") and attempt_id and question_id:
        try:
            from apps.legacy_schema.models import MockAnswer
            opt_path = result.get("file_path")
            if opt_path:
                storage_dir = getattr(settings, "STORAGE_DIR", None) or getattr(settings, "MEDIA_ROOT", "/app/storage")
                rel_key = os.path.relpath(opt_path, storage_dir).replace("\\", "/")
                MockAnswer.objects.filter(attempt_id=attempt_id, question_id=question_id).update(audio_key=rel_key)
                result["updated_key"] = rel_key
        except Exception as exc:
            logger.warning("Failed to update MockAnswer audio_key for %s/%s: %s", attempt_id, question_id, exc)

    return result


# Celery task registration with graceful fallback
try:
    from celery import shared_task
    @shared_task(name="apps.exams.audio_service.compress_speaking_audio_task")
    def compress_speaking_audio_task(audio_key_or_path: str, attempt_id: Optional[str] = None, question_id: Optional[str] = None):
        return compress_speaking_audio_for_answer(audio_key_or_path, attempt_id, question_id)
except Exception:
    def compress_speaking_audio_task(audio_key_or_path: str, attempt_id: Optional[str] = None, question_id: Optional[str] = None):
        return compress_speaking_audio_for_answer(audio_key_or_path, attempt_id, question_id)


def compress_speaking_audio_async(
    audio_key_or_path: str,
    attempt_id: Optional[str] = None,
    question_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Trigger background audio compression via Celery or daemon thread."""
    try:
        if hasattr(compress_speaking_audio_task, "delay"):
            compress_speaking_audio_task.delay(audio_key_or_path, attempt_id, question_id)
            return {"queued": True, "mode": "celery", "audio": audio_key_or_path}
    except Exception:
        pass

    thread = threading.Thread(
        target=compress_speaking_audio_for_answer,
        args=(audio_key_or_path, attempt_id, question_id),
        daemon=True,
    )
    thread.start()
    return {"queued": True, "mode": "thread", "audio": audio_key_or_path}
