"""The Listening play window is the measured length of the uploaded file, never a guess."""
from __future__ import annotations

import math
import struct
import tempfile
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.core import mock_audio_probe, mock_media


def _wav(path: Path, seconds: float, rate: int = 8000):
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(i / 9))) for i in range(int(rate * seconds))))


class AudioProbeTests(SimpleTestCase):
    def test_wav_length_is_measured_and_rounded_up(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'part.wav'
            _wav(path, 3.4)
            self.assertAlmostEqual(mock_audio_probe.packet_duration(path), 3.4, places=2)
            self.assertEqual(mock_audio_probe.measure_seconds(path), 4)
            _wav(path, 5.0)
            self.assertEqual(mock_audio_probe.measure_seconds(path), 5)

    def test_compressed_audio_is_measured_from_its_packets(self):
        try:
            import av
        except ImportError:  # PyAV ships with the production requirements
            self.skipTest('PyAV not installed')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'part.flac'
            with av.open(str(path), mode='w') as out:
                stream = out.add_stream('flac', rate=44100)
                import numpy
                for index in range(60):  # 60 × 0.1 s
                    samples = (numpy.sin(numpy.arange(4410) / 9) * 3000).astype('int16').reshape(1, -1)
                    frame = av.AudioFrame.from_ndarray(samples, format='s16', layout='mono')
                    frame.sample_rate = 44100
                    frame.pts = index * 4410
                    for packet in stream.encode(frame):
                        out.mux(packet)
                for packet in stream.encode(None):
                    out.mux(packet)
            self.assertAlmostEqual(mock_audio_probe.packet_duration(path), 6.0, delta=0.2)
            self.assertEqual(mock_audio_probe.measure_seconds(path), 6)

    def test_unreadable_file_gives_no_duration(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'broken.mp3'
            path.write_bytes(b'not audio at all' * 50)
            self.assertIsNone(mock_audio_probe.measure_seconds(path))
            self.assertIsNone(mock_audio_probe.measure_seconds(Path(folder) / 'missing.wav'))


class GroupMediaDurationTests(SimpleTestCase):
    def _upload(self, measured):
        group = SimpleNamespace(id='g1', audio_key='mock/old.mp3', image_key=None, audio_duration_sec=77,
                                section=SimpleNamespace(exam_id='e1'), save=MagicMock())
        exam = SimpleNamespace(id='e1', content_version=3)
        manager = MagicMock()
        manager.select_for_update.return_value.get.return_value = group
        with patch.object(mock_media, '_group_or_throw', return_value=group), \
                patch.object(mock_media, 'locked_exam', return_value=exam), \
                patch.object(mock_media, 'assert_author'), patch.object(mock_media, 'assert_mutable'), \
                patch.object(mock_media, 'MockQuestionGroup', SimpleNamespace(objects=manager)), \
                patch.object(mock_media, 'store_upload', return_value='mock/new.mp3'), \
                patch.object(mock_media, 'resolve_key', return_value=Path('/nonexistent/new.mp3')), \
                patch.object(mock_media, 'bump'), patch.object(mock_media, 'audit_event'), \
                patch.object(mock_media, 'media_url', return_value='/v1/mock/groups/g1/audio'), \
                patch.object(mock_media.transaction, 'atomic', return_value=MagicMock(__enter__=lambda s: None, __exit__=lambda s, *a: False)), \
                patch.object(mock_media.transaction, 'on_commit'), \
                patch('apps.core.mock_audio_probe.measure_seconds', return_value=measured) as probe:
            result = mock_media.set_group_media(SimpleNamespace(id='t1', role='teacher'), 'g1', {'audio': object()})
        probe.assert_called_once()
        return group, result

    def test_audio_upload_stores_the_measured_length(self):
        group, result = self._upload(184)
        self.assertEqual(group.audio_duration_sec, 184)
        self.assertEqual(result['audioDurationSec'], 184)
        self.assertIn('audio_duration_sec', group.save.call_args.kwargs['update_fields'])

    def test_unmeasurable_audio_does_not_keep_the_old_length(self):
        group, result = self._upload(None)
        self.assertIsNone(group.audio_duration_sec)
        self.assertIsNone(result['audioDurationSec'])
