from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.core import attempt_signature as sig
from apps.core.mock_attempts import switch_section, upload_speaking
from common.api.exceptions import ContractAPIException


def test_signature_fallback_authenticates_owner():
    request = SimpleNamespace(
        META={"HTTP_X_ATTEMPT_SIGNATURE": "outdated_or_mismatched_signature"},
        user=SimpleNamespace(is_authenticated=True, id="student_123")
    )
    settings.ATTEMPT_SIGNATURE_REQUIRED = True

    mock_attempt = SimpleNamespace(
        id="attempt_1",
        student_id="student_123",
        started_at=datetime(2026, 11, 1, 10, 0, 0),
        student=SimpleNamespace(user_id="student_123")
    )

    with patch("apps.legacy_schema.models.MockAttempt.objects.filter") as mock_filter:
        mock_filter.return_value.first.return_value = mock_attempt
        # Should not raise exception because authenticated user owns the attempt
        sig.verify_request(request, "attempt_1")


def test_signature_rejects_foreign_user():
    request = SimpleNamespace(
        META={"HTTP_X_ATTEMPT_SIGNATURE": "invalid_signature"},
        user=SimpleNamespace(is_authenticated=True, id="attacker_999")
    )
    settings.ATTEMPT_SIGNATURE_REQUIRED = True

    mock_attempt = SimpleNamespace(
        id="attempt_1",
        student_id="student_123",
        started_at=datetime(2026, 11, 1, 10, 0, 0),
        student=SimpleNamespace(user_id="student_123")
    )

    with patch("apps.legacy_schema.models.MockAttempt.objects.filter") as mock_filter:
        mock_filter.return_value.first.return_value = mock_attempt
        with pytest.raises(ContractAPIException) as exc:
            sig.verify_request(request, "attempt_1")
        assert exc.value.contract_code == "ATTEMPT_SIGNATURE_INVALID"
        assert exc.value.status_code == 403


def test_upload_speaking_rejects_small_audio():
    actor = SimpleNamespace(id="student_1")
    small_file = SimpleUploadedFile("test.webm", b"too small", content_type="audio/webm")

    with pytest.raises(ContractAPIException) as exc:
        upload_speaking(actor, "att_1", "q_1", small_file)
    assert exc.value.contract_code == "FILE_TOO_SMALL"
    assert "10 KB" in exc.value.contract_message


@pytest.mark.django_db
def test_switch_section_blocks_jumping_forward_in_full_test():
    actor = SimpleNamespace(id="student_1")
    attempt = SimpleNamespace(
        id="att_1",
        exam_id="exam_1",
        student_id="student_1",
        status="in_progress",
        flow_mode="full_test",
        current_skill="listening",
        submitted_sections=[]
    )

    sec = SimpleNamespace(skill="speaking")
    sections = [
        SimpleNamespace(skill="listening"),
        SimpleNamespace(skill="reading"),
        SimpleNamespace(skill="writing"),
        SimpleNamespace(skill="speaking"),
    ]

    with patch("apps.core.mock_attempts.own", return_value=attempt), \
         patch("apps.legacy_schema.models.MockSection.objects.filter") as mock_sec:
        mock_sec.return_value.first.return_value = sec
        mock_sec.return_value.order_by.return_value = sections

        with pytest.raises(ContractAPIException) as exc:
            switch_section(actor, "att_1", "speaking")
        assert exc.value.contract_code == "SECTION_LOCKED"
