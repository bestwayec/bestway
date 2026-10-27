"""Re-export of audio optimization services for convenience."""
from apps.exams.audio_service import (
    compress_speaking_audio_async,
    compress_speaking_audio_for_answer,
    compress_speaking_audio_task,
    optimize_speaking_audio,
    resolve_media_path,
)

__all__ = [
    "resolve_media_path",
    "optimize_speaking_audio",
    "compress_speaking_audio_for_answer",
    "compress_speaking_audio_task",
    "compress_speaking_audio_async",
]
