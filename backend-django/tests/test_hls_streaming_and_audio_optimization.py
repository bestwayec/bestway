"""Tests for HLS Adaptive Video Streaming and Speaking Audio Optimization Pipeline."""

import os
import shutil
import tempfile
import uuid
from unittest.mock import MagicMock, patch
from django.test import RequestFactory, TestCase, SimpleTestCase
from django.conf import settings

from apps.core.lms_services import (
    HLS_RESOLUTIONS,
    generate_master_playlist_content,
    resolve_hls_storage_dir,
    stream_hls_file,
    transcode_video_to_hls,
    trigger_hls_transcoding,
)
from apps.exams.audio_service import (
    compress_speaking_audio_async,
    optimize_speaking_audio,
    resolve_media_path,
)


class HLSStreamingTestCase(TestCase):
    """Test adaptive HLS playlist generation, resolution variants, and streaming."""
    databases = {"default"}

    def setUp(self):
        self.factory = RequestFactory()
        self.temp_dir = tempfile.mkdtemp()
        self.lesson_id = f"test-hls-{uuid.uuid4().hex[:8]}"

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_master_playlist_content_includes_all_resolutions(self):
        content = generate_master_playlist_content(HLS_RESOLUTIONS)
        self.assertIn("#EXTM3U", content)
        self.assertIn("#EXT-X-VERSION:3", content)
        self.assertIn('RESOLUTION=1920x1080,NAME="1080p"', content)
        self.assertIn('RESOLUTION=1280x720,NAME="720p"', content)
        self.assertIn('RESOLUTION=854x480,NAME="480p"', content)
        self.assertIn("1080p.m3u8", content)
        self.assertIn("720p.m3u8", content)
        self.assertIn("480p.m3u8", content)

    def test_transcode_video_to_hls_generates_valid_files(self):
        video_dummy = os.path.join(self.temp_dir, "dummy_lesson.mp4")
        with open(video_dummy, "wb") as f:
            f.write(b"\x00" * 2000)

        out_dir = os.path.join(self.temp_dir, "hls_out")
        res = transcode_video_to_hls(video_dummy, out_dir, self.lesson_id)

        self.assertTrue(res["success"])
        self.assertEqual(res["lesson_id"], self.lesson_id)
        self.assertIn("playlist_url", res)
        self.assertTrue(os.path.exists(os.path.join(out_dir, "master.m3u8")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "playlist.m3u8")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "1080p.m3u8")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "720p.m3u8")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "480p.m3u8")))
        self.assertTrue(os.path.exists(os.path.join(out_dir, "1080p_000.ts")))

    def test_stream_hls_playlist_returns_correct_content_type_and_headers(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        transcode_video_to_hls("non_existent.mp4", out_dir, self.lesson_id)

        request = self.factory.get(f"/v1/lessons/{self.lesson_id}/hls/playlist.m3u8")
        response = stream_hls_file(self.lesson_id, "playlist.m3u8", request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/vnd.apple.mpegurl")
        self.assertEqual(response["Cache-Control"], "public, max-age=3600")
        self.assertEqual(response["Access-Control-Allow-Origin"], "*")
        self.assertIn(b"#EXTM3U", response.content)

    def test_stream_hls_segment_returns_mpeg_ts_and_immutable_cache(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        transcode_video_to_hls("non_existent.mp4", out_dir, self.lesson_id)

        request = self.factory.get(f"/v1/lessons/{self.lesson_id}/hls/1080p_000.ts")
        response = stream_hls_file(self.lesson_id, "1080p_000.ts", request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "video/mp2t")
        self.assertEqual(response["Cache-Control"], "public, max-age=86400, immutable")
        self.assertEqual(response["Access-Control-Allow-Origin"], "*")

    @patch("apps.core.lms_services.execute_hls_transcode_for_lesson")
    def test_trigger_hls_transcoding_async(self, mock_exec):
        result = trigger_hls_transcoding(self.lesson_id, async_mode=True)
        self.assertTrue(result["queued"])
        self.assertEqual(result["lesson_id"], self.lesson_id)


class SpeakingAudioOptimizationTestCase(SimpleTestCase):
    """Test speaking audio compression to 32kbps mono Opus format."""

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.raw_audio = os.path.join(self.temp_dir, "speaking_recording.wav")
        # Generate minimal RIFF/WAV header with 8000 bytes dummy PCM payload
        with open(self.raw_audio, "wb") as f:
            f.write(b"RIFF\x24\x20\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x20\x00\x00" + b"\x00" * 8000)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_optimize_speaking_audio_missing_file_returns_clean_error(self):
        res = optimize_speaking_audio("/invalid/path/to/missing_audio.wav")
        self.assertFalse(res["success"])
        self.assertEqual(res["error"], "FILE_NOT_FOUND")

    def test_optimize_speaking_audio_executes_or_falls_back_gracefully(self):
        out_opus = os.path.join(self.temp_dir, "compressed.opus")
        res = optimize_speaking_audio(self.raw_audio, out_opus, bitrate="32k")

        self.assertTrue(res["success"])
        self.assertIn("file_path", res)
        self.assertIn("original_size", res)
        self.assertIn("compressed_size", res)
        self.assertIn("saved_percentage", res)

    @patch("apps.exams.audio_service.compress_speaking_audio_for_answer")
    def test_compress_speaking_audio_async_triggers_without_error(self, mock_compress):
        res = compress_speaking_audio_async(self.raw_audio)
        self.assertTrue(res["queued"])
        self.assertEqual(res["audio"], self.raw_audio)
