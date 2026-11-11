"""Isolated media fixtures for Record Mock importer tests (temp directories only)."""
from __future__ import annotations

import shutil
import tempfile
import wave
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.test import override_settings

from apps.core.record_mock_1_content import REQUIRED_MEDIA

REPO_MEDIA = Path(settings.BASE_DIR).resolve().parent / "media"


def write_silent_wav(path: Path, seconds: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(1)
        handle.setframerate(8000)
        handle.writeframes(b"\x80" * int(8000 * seconds))


@contextmanager
def isolated_record_mock_media(listening_seconds: float):
    """SEED_MEDIA_DIR with synthetic WAVs of the given length + an empty MEDIA_ROOT."""
    with tempfile.TemporaryDirectory() as seed, tempfile.TemporaryDirectory() as media_root:
        seed_root = Path(seed)
        for src, _ in REQUIRED_MEDIA:
            target = seed_root / src
            if src.endswith(".wav"):
                write_silent_wav(target, listening_seconds)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(REPO_MEDIA / src, target)
        with mock.patch.dict("os.environ", {"SEED_MEDIA_DIR": seed}), override_settings(MEDIA_ROOT=media_root):
            yield seed_root, Path(media_root)
