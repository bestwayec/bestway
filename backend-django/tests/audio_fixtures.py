"""Tiny valid MP3/M4A files for upload-validator tests (generated in memory, never stored as content)."""
from __future__ import annotations

import io
import math

import av
import numpy as np


def _encode(fmt: str, codec: str, seconds: float, rate: int = 22050) -> bytes:
    buffer = io.BytesIO()
    with av.open(buffer, mode='w', format=fmt) as out:
        stream = out.add_stream(codec, rate=rate)
        stream.layout = 'mono'
        total, step, position = int(seconds * rate), 1024, 0
        while position < total:
            count = min(step, total - position)
            t = (np.arange(position, position + count) / rate)
            wave = (0.2 * np.sin(2 * math.pi * 220 * t) * 32767).astype(np.int16).reshape(1, -1)
            frame = av.AudioFrame.from_ndarray(wave, format='s16', layout='mono')
            frame.sample_rate = rate
            frame.pts = position
            for packet in stream.encode(frame):
                out.mux(packet)
            position += count
        for packet in stream.encode(None):
            out.mux(packet)
    return buffer.getvalue()


def make_mp3(seconds: float = 75) -> bytes:
    return _encode('mp3', 'libmp3lame', seconds)


def make_m4a(seconds: float = 75) -> bytes:
    return _encode('ipod', 'aac', seconds)
