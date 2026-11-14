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


if __name__ == '__main__':
    print(json.dumps({'duration': packet_duration(sys.argv[1])}))
