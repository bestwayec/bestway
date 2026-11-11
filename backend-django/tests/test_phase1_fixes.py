from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.core import attempt_signature as sig
from apps.core.mock_attempts import switch_section, upload_speaking
from common.api.exceptions import ContractAPIException


def test_mismatched_signature_is_rejected_even_for_the_owner():
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
        # The owner fallback was removed: a supplied signature must match exactly.
        with pytest.raises(ContractAPIException) as caught:
            sig.verify_request(request, "attempt_1")
        assert caught.value.status_code == 403


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
    assert "1 KB" in exc.value.contract_message


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


def test_strict_speaking_keeps_the_original_recording():
    from apps.core import mock_attempts as engine
    with patch("apps.core.mock_speaking_policy.strict", return_value=True), patch.object(engine.transaction, "on_commit") as on_commit:
        assert engine.schedule_speaking_compression(SimpleNamespace(), "private/a.webm", "a1", "q1") is False
    on_commit.assert_not_called()
    with patch("apps.core.mock_speaking_policy.strict", return_value=False), patch.object(engine.transaction, "on_commit") as on_commit:
        assert engine.schedule_speaking_compression(SimpleNamespace(), "private/a.webm", "a1", "q1") is True
    on_commit.assert_called_once()


def test_seed_media_preserves_existing_files_before_any_copy(tmp_path, settings, monkeypatch):
    import io
    from apps.core import record_mock_1_content as content

    source = tmp_path / 'source'
    target = tmp_path / 'target'
    source.mkdir()
    target.mkdir()
    monkeypatch.setattr(content, 'REQUIRED_MEDIA', (('one.wav', 'one.wav'), ('two.wav', 'two.wav')))
    monkeypatch.setenv('SEED_MEDIA_DIR', str(source))
    settings.MEDIA_ROOT = target
    (source / 'one.wav').write_bytes(b'new')
    (source / 'two.wav').write_bytes(b'fake')
    (target / 'two.wav').write_bytes(b'real')  # Same size is also a conflict.
    with pytest.raises(content.SeedMediaMissing, match='refusing to overwrite'):
        content.ensure_media_assets(io.StringIO())
    assert (target / 'two.wav').read_bytes() == b'real'
    assert not (target / 'one.wav').exists()


def test_seed_media_identical_files_are_idempotent(tmp_path, settings, monkeypatch):
    import io
    from apps.core import record_mock_1_content as content

    source = tmp_path / 'source'
    source.mkdir()
    (source / 'audio.wav').write_bytes(b'authentic')
    monkeypatch.setattr(content, 'REQUIRED_MEDIA', (('audio.wav', 'audio.wav'),))
    monkeypatch.setenv('SEED_MEDIA_DIR', str(source))
    settings.MEDIA_ROOT = tmp_path / 'target'
    content.ensure_media_assets(io.StringIO())
    content.ensure_media_assets(io.StringIO())
    assert (settings.MEDIA_ROOT / 'audio.wav').read_bytes() == b'authentic'


@pytest.mark.django_db
@pytest.mark.parametrize("size", [1023, 1024, 1025])
def test_speaking_upload_size_boundary(size):
    upload = SimpleUploadedFile("test.webm", b"x" * size, content_type="audio/webm")
    with patch("apps.core.mock_attempts.own", side_effect=RuntimeError("reached ownership check")):
        if size < 1024:
            with pytest.raises(ContractAPIException) as exc:
                upload_speaking(SimpleNamespace(id="student"), "attempt", "question", upload)
            assert exc.value.contract_code == "FILE_TOO_SMALL"
        else:
            with pytest.raises(RuntimeError, match="reached ownership check"):
                upload_speaking(SimpleNamespace(id="student"), "attempt", "question", upload)


def test_invalid_audio_header_is_rejected():
    from apps.core.mock_attempts import validate_audio_container
    with pytest.raises(ContractAPIException) as exc:
        validate_audio_container(SimpleUploadedFile("fake.webm", b"x" * 1024, content_type="audio/webm"))
    assert exc.value.contract_code == "INVALID_AUDIO"
