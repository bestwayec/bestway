import pytest
from unittest.mock import patch, MagicMock
from django.test import RequestFactory, SimpleTestCase
from django.http import Http404
from apps.core.lms_services import (
    get_hls_transcode_status,
    set_hls_transcode_status,
    stream_hls_file,
    HLS_STATUS_IDLE,
    HLS_STATUS_PROCESSING,
    HLS_STATUS_READY,
)
from apps.core.lms_views import lesson_hls_status_view


class HlsStatusAndLockingTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("django.core.cache.cache.get")
    def test_get_hls_status_idle(self, mock_cache_get):
        mock_cache_get.return_value = None
        status = get_hls_transcode_status("test-lesson-999")
        self.assertEqual(status["status"], HLS_STATUS_IDLE)
        self.assertFalse(status["is_ready"])

    @patch("django.core.cache.cache.get")
    def test_get_hls_status_from_cache(self, mock_cache_get):
        mock_cache_get.return_value = {"status": HLS_STATUS_PROCESSING, "is_ready": False, "retry_after": 5}
        status = get_hls_transcode_status("test-lesson-123")
        self.assertEqual(status["status"], HLS_STATUS_PROCESSING)
        self.assertEqual(status["retry_after"], 5)

    @patch("apps.core.lms_services.get_hls_transcode_status")
    def test_stream_hls_file_returns_423_locked_when_processing(self, mock_status):
        mock_status.return_value = {"status": HLS_STATUS_PROCESSING, "is_ready": False}
        request = self.factory.get("/v1/lessons/test-lesson/hls/playlist.m3u8")

        response = stream_hls_file("test-lesson", "playlist.m3u8", request)
        self.assertEqual(response.status_code, 423)
        self.assertEqual(response.headers.get("Retry-After"), "5")

    @patch("apps.core.lms_views.get_hls_transcode_status")
    def test_lesson_hls_status_endpoint(self, mock_status):
        mock_status.return_value = {"status": HLS_STATUS_READY, "is_ready": True, "lesson_id": "test-1"}
        request = self.factory.get("/v1/lessons/test-1/hls/status")

        response = lesson_hls_status_view(request, "test-1")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["success"])
        self.assertEqual(response.data["data"]["status"], HLS_STATUS_READY)
