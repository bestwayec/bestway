"""Measure the playing time of an uploaded exam audio file in a bounded subprocess.

Listening parts need `audio_duration_sec`: the runner opens the server play window for exactly
that long. The value is measured from the file itself (packet timeline, no decoding), never
guessed. When the file cannot be measured the caller leaves the stored value untouched.
"""
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

MAX_SECONDS = 3 * 60 * 60


def packet_duration(path):
    path = Path(path)
    if path.suffix.lower() == '.wav':
        with wave.open(str(path), 'rb') as source:
            rate = source.getframerate()
            return source.getnframes() / rate if rate else 0.
    import av
    with av.open(str(path), mode='r') as source:
        if not source.streams.audio:
            return 0.
        stream = source.streams.audio[0]
        end = 0.
        for packet in source.demux(stream):
            if packet.pts is None or packet.duration is None or packet.time_base is None:
                continue
            end = max(end, float((packet.pts + packet.duration) * packet.time_base))
        if not end and source.duration:
            end = source.duration / 1_000_000
        return end


def measure_seconds(path):
    """Whole seconds (rounded up) or None when the file cannot be measured."""
    try:
        result = subprocess.run([sys.executable, '-m', 'apps.core.mock_audio_probe', str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=60, check=False)
        if result.returncode or len(result.stdout) > 1000:
            return None
        duration = json.loads(result.stdout)['duration']
        if type(duration) not in (int, float) or not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS:
            return None
        return max(1, math.ceil(duration - 0.05))
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
        return None


def stream_info(path):
    """Container, codec, rate and channels of the first audio stream, plus a real decode of its first frames.

    Used to validate staff uploads: a file whose packets can be walked but whose first frames do not
    decode (truncated, DRM, renamed video) must be refused instead of failing in the student's exam.
    """
    import av
    path = Path(path)
    with av.open(str(path), mode='r') as source:
        if not source.streams.audio:
            return dict(duration=0., codec=None, container=source.format.name, sample_rate=None, channels=None, decodable=False)
        stream = source.streams.audio[0]
        decoded = 0
        try:
            for frame in source.decode(stream):
                decoded += frame.samples
                if decoded >= 4096:
                    break
        except Exception:
            decoded = 0
        return dict(duration=packet_duration(path), codec=stream.codec_context.codec.canonical_name, container=source.format.name,
                    sample_rate=stream.codec_context.sample_rate, channels=stream.codec_context.channels, decodable=decoded > 0)


def inspect_audio(path):
    """stream_info in a bounded subprocess; None when the file cannot be inspected at all."""
    try:
        result = subprocess.run([sys.executable, '-m', 'apps.core.mock_audio_probe', '--info', str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=90, check=False)
        if result.returncode or len(result.stdout) > 2000:
            return None
        info = json.loads(result.stdout)
        duration = info.get('duration')
        if type(duration) not in (int, float) or not math.isfinite(duration) or not 0 <= duration <= MAX_SECONDS:
            return None
        return info
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
        return None


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--info':
        print(json.dumps(stream_info(sys.argv[2])))
    else:
        print(json.dumps({'duration': packet_duration(sys.argv[1])}))
