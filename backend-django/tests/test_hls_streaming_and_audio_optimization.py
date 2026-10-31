"""Tests for HLS Adaptive Video Streaming and Speaking Audio Optimization Pipeline."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
import uuid
from unittest.mock import MagicMock, patch
from django.http import Http404
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings

from apps.core.lms_services import (
    HLS_COMPLETE_MARKER,
    HLS_RESOLUTIONS,
    generate_master_playlist_content,
    hls_is_ready,
    resolve_hls_storage_dir,
    stream_hls_file,
    transcode_video_to_hls,
    trigger_hls_transcoding,
    validate_hls_directory,
)
from apps.exams.audio_service import (
    compress_speaking_audio_async,
    optimize_speaking_audio,
    resolve_media_path,
)


def _write_variant(directory, name, segment_count, seg_seconds=6.0, ended=True):
    lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:6", "#EXT-X-MEDIA-SEQUENCE:0"]
    for i in range(segment_count):
        seg = f"{name}_{i:03d}.ts"
        with open(os.path.join(directory, seg), "wb") as fh:
            fh.write(b"\x47" + b"\x00" * 187)
        lines += [f"#EXTINF:{seg_seconds:.3f},", seg]
    if ended:
        lines.append("#EXT-X-ENDLIST")
    with open(os.path.join(directory, f"{name}.m3u8"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def _write_master(directory, names):
    content = generate_master_playlist_content([p for p in HLS_RESOLUTIONS if p["name"] in names])
    for name in ("master.m3u8", "playlist.m3u8"):
        with open(os.path.join(directory, name), "w", encoding="utf-8") as fh:
            fh.write(content)


class HLSStreamingTestCase(TestCase):
    """Test adaptive HLS playlist generation, validation, and streaming."""
    databases = {"default"}

    def setUp(self):
        self.factory = RequestFactory()
        self.temp_dir = tempfile.mkdtemp()
        self.lesson_id = f"test-hls-{uuid.uuid4().hex[:8]}"
        self.settings_override = override_settings(STORAGE_DIR=self.temp_dir)
        self.settings_override.enable()

    def tearDown(self):
        self.settings_override.disable()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_ready_dir(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        _write_master(out_dir, ["480p"])
        _write_variant(out_dir, "480p", 3)
        with open(os.path.join(out_dir, HLS_COMPLETE_MARKER), "w", encoding="utf-8") as fh:
            json.dump({"lesson_id": self.lesson_id}, fh)
        return out_dir

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

    def test_transcode_without_source_creates_no_placeholder_playlists(self):
        out_dir = os.path.join(self.temp_dir, "hls_out")
        res = transcode_video_to_hls("non_existent.mp4", out_dir, self.lesson_id)

        self.assertFalse(res["success"])
        self.assertFalse(os.path.exists(os.path.join(out_dir, "master.m3u8")))
        self.assertFalse(os.path.exists(os.path.join(out_dir, "1080p.m3u8")))
        self.assertFalse(hls_is_ready(self.lesson_id))

    def test_validate_rejects_single_segment_placeholder_playlist(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        _write_master(out_dir, ["480p"])
        _write_variant(out_dir, "480p", 1)

        check = validate_hls_directory(out_dir, expected_duration=1097.0)
        self.assertFalse(check["valid"])
        self.assertIn("source is", check["reason"])

    def test_validate_rejects_playlist_without_endlist(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        _write_master(out_dir, ["480p"])
        _write_variant(out_dir, "480p", 5, ended=False)

        self.assertFalse(validate_hls_directory(out_dir)["valid"])

    def test_validate_rejects_missing_segment_file(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        _write_master(out_dir, ["480p"])
        _write_variant(out_dir, "480p", 4)
        os.remove(os.path.join(out_dir, "480p_002.ts"))

        self.assertFalse(validate_hls_directory(out_dir)["valid"])

    def test_validate_accepts_complete_stream_covering_source(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        _write_master(out_dir, ["480p"])
        _write_variant(out_dir, "480p", 10)

        check = validate_hls_directory(out_dir, expected_duration=58.0)
        self.assertTrue(check["valid"], check["reason"])

    def test_unmarked_hls_directory_is_never_served(self):
        out_dir = resolve_hls_storage_dir(self.lesson_id)
        _write_master(out_dir, ["480p"])
        _write_variant(out_dir, "480p", 1)

        self.assertFalse(hls_is_ready(self.lesson_id))
        request = self.factory.get(f"/v1/lessons/{self.lesson_id}/hls/playlist.m3u8")
        with self.assertRaises(Http404):
            stream_hls_file(self.lesson_id, "playlist.m3u8", request)
        with self.assertRaises(Http404):
            stream_hls_file(self.lesson_id, "480p_000.ts", request)

    def test_stream_never_synthesizes_missing_variant_playlist(self):
        out_dir = self._make_ready_dir()
        request = self.factory.get(f"/v1/lessons/{self.lesson_id}/hls/720p.m3u8")

        with self.assertRaises(Http404):
            stream_hls_file(self.lesson_id, "720p.m3u8", request)
        self.assertFalse(os.path.exists(os.path.join(out_dir, "720p.m3u8")))

    def test_stream_rejects_path_traversal(self):
        self._make_ready_dir()
        request = self.factory.get("/x")
        for bad in ("../master.m3u8", "..%2Fmaster.m3u8", ".complete.json", "a/b.ts"):
            with self.assertRaises(Http404):
                stream_hls_file(self.lesson_id, bad, request)

    def test_stream_hls_playlist_returns_correct_content_type_and_headers(self):
        self._make_ready_dir()
        request = self.factory.get(f"/v1/lessons/{self.lesson_id}/hls/playlist.m3u8")
        response = stream_hls_file(self.lesson_id, "playlist.m3u8", request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/vnd.apple.mpegurl")
        self.assertEqual(response["Cache-Control"], "public, max-age=60")
        self.assertEqual(response["Access-Control-Allow-Origin"], "*")
        self.assertIn(b"#EXTM3U", response.content)

    def test_stream_hls_segment_returns_mpeg_ts_and_immutable_cache(self):
        self._make_ready_dir()
        request = self.factory.get(f"/v1/lessons/{self.lesson_id}/hls/480p_000.ts")
        response = stream_hls_file(self.lesson_id, "480p_000.ts", request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "video/mp2t")
        self.assertEqual(response["Cache-Control"], "public, max-age=86400, immutable")
        self.assertEqual(response["Access-Control-Allow-Origin"], "*")

    @patch("apps.core.lms_services.execute_hls_transcode_for_lesson")
    def test_trigger_hls_transcoding_async(self, mock_exec):
        result = trigger_hls_transcoding(self.lesson_id, async_mode=True)
        self.assertTrue(result["queued"])
        self.assertEqual(result["lesson_id"], self.lesson_id)

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    def test_real_transcode_covers_full_source_duration(self):
        source = os.path.join(self.temp_dir, "source.mp4")
        subprocess.run(
            [
                shutil.which("ffmpeg"), "-y",
                "-f", "lavfi", "-i", "testsrc=duration=14:size=320x240:rate=25",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=14",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=120,
        )
        out_dir = os.path.join(self.temp_dir, "hls_real")
        res = transcode_video_to_hls(source, out_dir, self.lesson_id, resolutions=["480p"])

        self.assertTrue(res["success"], res)
        self.assertGreaterEqual(res["duration"], 14 * 0.97)
        self.assertTrue(os.path.exists(os.path.join(out_dir, HLS_COMPLETE_MARKER)))
        self.assertGreater(len([f for f in os.listdir(out_dir) if f.endswith(".ts")]), 1)
        self.assertFalse(os.path.exists(out_dir + ".building"))


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
