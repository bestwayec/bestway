"""Decode the actual audio timeline in a bounded, model-free subprocess."""
import json
import math
import subprocess
import sys
import wave
from pathlib import Path

MAX_BYTES = 25 * 1024 * 1024
# A browser MediaRecorder starts capturing a little after start() and loses the first frames:
# accepted recordings measured 60-240 ms short of the window (local stack, Chromium), right at the
# old symmetric .25 s limit, so slower devices had complete answers rejected (and the client then
# discarded them). Short by up to a second is still a full response; long stays tight.
SHORT_TOLERANCE_SECONDS = 1.0
LONG_TOLERANCE_SECONDS = .5
TOLERANCE_SECONDS = LONG_TOLERANCE_SECONDS  # upper bound used while decoding
GAP_TOLERANCE_SECONDS = .5  # a timestamp gap inside the recording (dropped frames under load)
POLICY = 'FULL_RESPONSE_WINDOW_V1'


def duration_bounds(expected_seconds):
    """(min, max) accepted decoded length in seconds for a response window."""
    return expected_seconds - SHORT_TOLERANCE_SECONDS, expected_seconds + LONG_TOLERANCE_SECONDS


def duration_accepted(expected_seconds, duration_seconds):
    low, high = duration_bounds(expected_seconds)
    return low <= duration_seconds <= high


class InvalidDuration(Exception):
    pass


def decoded_duration(path, maximum):
    path = Path(path)
    if not 0 < path.stat().st_size <= MAX_BYTES:
        raise InvalidDuration()
    if path.suffix.lower() == '.wav':
        with wave.open(str(path), 'rb') as source:
            rate, channels, width = source.getframerate(), source.getnchannels(), source.getsampwidth()
            if not 8000 <= rate <= 192000 or not 1 <= channels <= 8 or not 1 <= width <= 4:
                raise InvalidDuration()
            declared = source.getnframes()
            if declared / rate > maximum:
                raise InvalidDuration()
            count = 0
            while chunk := source.readframes(4096):
                if len(chunk) % (channels * width):
                    raise InvalidDuration()
                count += len(chunk) // (channels * width)
                if count / rate > maximum:
                    raise InvalidDuration()
            if count != declared or not count:
                raise InvalidDuration()
            return count / rate
    import av
    duration, frames, last_end = 0., 0, None
    with av.open(str(path), mode='r') as source:
        if len(source.streams.audio) != 1 or source.streams.video:
            raise InvalidDuration()
        stream = source.streams.audio[0]
        for packet in source.demux(stream):
            if packet.is_corrupt:
                raise InvalidDuration()
            for frame in packet.decode():
                rate, samples = frame.sample_rate, frame.samples
                if not 8000 <= rate <= 192000 or not 0 < samples <= rate * 2 or len(frame.layout.channels) > 8:
                    raise InvalidDuration()
                frames += 1
                duration += samples / rate
                if frames > 25000 or duration > maximum:
                    raise InvalidDuration()
                if frame.pts is not None and frame.time_base is not None:
                    start = float(frame.pts * frame.time_base)
                    if last_end is not None and abs(start - last_end) > GAP_TOLERANCE_SECONDS:
                        raise InvalidDuration()
                    last_end = start + samples / rate
        declared = float(stream.duration * stream.time_base) if stream.duration is not None and stream.time_base else None
        if not frames or declared is not None and abs(declared - duration) > GAP_TOLERANCE_SECONDS:
            raise InvalidDuration()
    return duration


def measure_duration(path, expected_seconds):
    from .mock_attempts import fail
    try:
        result = subprocess.run([sys.executable, '-m', 'apps.core.mock_speaking_duration', str(path), str(duration_bounds(expected_seconds)[1])],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=30, check=False)
        if result.returncode or len(result.stdout) > 1000:
            raise InvalidDuration()
        duration = json.loads(result.stdout)['duration']
        if type(duration) not in (int, float) or not math.isfinite(duration) or not duration_accepted(expected_seconds, duration):
            raise InvalidDuration()
        return round(duration * 1000)
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError, InvalidDuration):
        fail('SPEAKING_AUDIO_DURATION_INVALID', f'Record the complete {expected_seconds}-second response. Short, long or damaged recordings cannot be submitted.')


if __name__ == '__main__':
    try:
        # Hard CPU/address-space bounds apply on the production Linux host.
        try:
            import resource
            resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
            resource.setrlimit(resource.RLIMIT_AS, (384 * 1024 * 1024, 384 * 1024 * 1024))
        except ImportError:
            pass
        print(json.dumps(dict(duration=decoded_duration(sys.argv[1], float(sys.argv[2])))))
    except Exception:
        sys.exit(1)
