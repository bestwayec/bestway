"""Validated MP3/M4A upload, safe replacement and verification of Listening part recordings.

Everything goes through the existing secure media system (``mock_media.set_group_media``:
random storage keys, contained paths, authenticated streaming, deferred deletion of the old
file). This module adds format validation in front of it and the verification state behind it.
"""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

from django.db import transaction
from django.utils import timezone

from apps.core.mock_audio_probe import inspect_audio
from apps.core.mock_authoring import _group_or_throw, assert_author, assert_mutable, audit_event, locked_exam
from apps.core.models import MockExamGate, MockListeningAudio
from apps.legacy_schema.models import MockQuestion, MockQuestionGroup
from common.api.exceptions import ContractAPIException

from . import gates

MB = 1024 * 1024
MIN_BYTES = 20 * 1024
MIN_SECONDS, MAX_SECONDS = 60, 20 * 60
# IELTS parts normally run 4-12 minutes; outside that is accepted but flagged to the uploader.
USUAL_SECONDS = (4 * 60, 12 * 60)
FORMATS = {
    '.mp3': dict(container='mp3', codecs={'mp3'}, mimes={'audio/mpeg', 'audio/mp3', 'audio/x-mpeg', 'audio/x-mp3'}),
    '.m4a': dict(container='m4a', codecs={'aac'}, mimes={'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/aac', 'audio/mpeg'}),
}
VERIFIER_ROLES = ('admin', 'super_admin')


def max_bytes() -> int:
    return int(os.environ.get('LISTENING_AUDIO_MAX_MB', '200')) * MB


def reject(code: str, message: str, status: int = 400):
    raise ContractAPIException(code, message, status)


def sniff_format(head: bytes, extension: str) -> bool:
    """Magic bytes: MP3 = ID3 tag or an MPEG frame sync; M4A = an ISO-BMFF ``ftyp`` box."""
    if extension == '.mp3':
        return head[:3] == b'ID3' or (len(head) >= 2 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0)
    if extension == '.m4a':
        return len(head) >= 12 and head[4:8] == b'ftyp'
    return False


def _stream_digest(upload) -> tuple[str, int, bytes]:
    digest, size, head = hashlib.sha256(), 0, b''
    for chunk in upload.chunks():
        if not head:
            head = bytes(chunk[:16])
        digest.update(chunk)
        size += len(chunk)
    upload.seek(0)
    return digest.hexdigest(), size, head


def inspect_upload(upload) -> dict:
    """Validate one uploaded file completely before anything is stored. Raises ContractAPIException."""
    name = Path(upload.name or '').name
    extension = Path(name).suffix.lower()
    spec = FORMATS.get(extension)
    if spec is None:
        reject('INVALID_FILE_TYPE', 'Only MP3 or M4A recordings are accepted for Listening')
    mime = (upload.content_type or '').split(';')[0].strip().lower()
    if mime not in spec['mimes'] and mime != 'application/octet-stream':
        reject('INVALID_FILE_TYPE', f'File type "{mime or "unknown"}" does not match a {extension[1:].upper()} recording')
    if upload.size > max_bytes():
        reject('FILE_TOO_LARGE', f'Recording is larger than {max_bytes() // MB} MB')
    if upload.size < MIN_BYTES:
        reject('FILE_TOO_SMALL', 'Recording is too small to be a real Listening part')
    sha256, size, head = _stream_digest(upload)
    if not sniff_format(head, extension):
        reject('INVALID_FILE_CONTENT', f'The file content is not a valid {extension[1:].upper()} (extension was renamed?)')
    path = getattr(upload, 'temporary_file_path', None)
    cleanup = None
    if callable(path):
        probe_path = path()
    else:
        handle = tempfile.NamedTemporaryFile(suffix=extension, delete=False)
        try:
            for chunk in upload.chunks():
                handle.write(chunk)
        finally:
            handle.close()
        upload.seek(0)
        probe_path = cleanup = handle.name
    try:
        info = inspect_audio(probe_path)
    finally:
        if cleanup:
            Path(cleanup).unlink(missing_ok=True)
    if info is None or not info.get('codec'):
        reject('AUDIO_UNREADABLE', 'The recording could not be read — it may be corrupted or truncated')
    if not info.get('decodable'):
        reject('AUDIO_UNREADABLE', 'The recording has no decodable audio')
    if info['codec'] not in spec['codecs']:
        reject('AUDIO_CODEC', f'Unsupported audio codec "{info["codec"]}" for {extension[1:].upper()}')
    container = str(info.get('container') or '')
    if (extension == '.mp3' and container != 'mp3') or (extension == '.m4a' and 'mp4' not in container):
        reject('INVALID_FILE_CONTENT', 'The audio container does not match the file extension')
    duration = float(info.get('duration') or 0)
    if duration < MIN_SECONDS:
        reject('AUDIO_TOO_SHORT', f'Recording is {duration:.0f}s long — a Listening part is at least {MIN_SECONDS}s')
    if duration > MAX_SECONDS:
        reject('AUDIO_TOO_LONG', f'Recording is {duration / 60:.0f} minutes — a Listening part is at most {MAX_SECONDS // 60} minutes')
    warnings = []
    if not USUAL_SECONDS[0] <= duration <= USUAL_SECONDS[1]:
        warnings.append(f'Unusual length for an IELTS Listening part: {duration / 60:.1f} minutes (usual 4–12)')
    return dict(name=name[:255], extension=extension, mime=mime, sha256=sha256, size=size, container=spec['container'],
                codec=info['codec'], duration_ms=int(round(duration * 1000)), sample_rate=info.get('sample_rate'),
                channels=info.get('channels'), warnings=warnings)


def _require_listening(group):
    if group.section.skill != 'listening':
        reject('NOT_LISTENING_PART', 'This audio belongs to Listening parts only', 400)


def upload_part_audio(actor, group_id: str, upload, *, image=None) -> dict:
    """Validate, store and register the recording of one Listening part (replacing any previous one)."""
    from apps.core.mock_media import delete_created, media_url, resolve_key, set_group_media

    group = _group_or_throw(group_id)
    _require_listening(group)
    info = inspect_upload(upload)
    new_key = None
    try:
        with transaction.atomic():
            exam = locked_exam(group.section.exam_id)
            assert_author(actor, exam)
            assert_mutable(exam)
            old = MockListeningAudio.objects.select_for_update().filter(group_id=group_id).first()
            files = {'audio': upload}
            if image is not None:
                files['image'] = image
            set_group_media(actor, group_id, files, _validated=True)
            fresh = MockQuestionGroup.objects.get(id=group_id)
            new_key = fresh.audio_key
            if gates.sha256_file(resolve_key(new_key)) != info['sha256']:
                reject('UPLOAD_ERROR', 'The stored file differs from the uploaded file — please retry', 500)
            now = timezone.now()
            fields = dict(exam_id=exam.id, part_number=group.part_number or 0, storage_key=new_key, sha256=info['sha256'],
                          size_bytes=info['size'], original_name=info['name'], mime_type=info['mime'],
                          container=info['container'], codec=info['codec'], duration_ms=info['duration_ms'],
                          sample_rate=info['sample_rate'], channels=info['channels'], uploaded_by_id=actor.id,
                          uploaded_at=now, status='uploaded', verified_by_id=None, verified_at=None,
                          verified_sha256=None, verified_fingerprint=None, verification_note='')
            if old is None:
                record = MockListeningAudio.objects.create(group_id=group_id, revision=1, **fields)
            else:
                for field, value in fields.items():
                    setattr(old, field, value)
                old.revision += 1
                old.save()
                record = old
            replaced = None if old is None else dict(revision=record.revision - 1)
    except Exception:
        if new_key and not MockQuestionGroup.objects.filter(audio_key=new_key).exists():
            delete_created(new_key)
        raise
    audit_event(actor, 'mock.listening.audio.upload', 'mockQuestionGroup', group_id,
                old=replaced, new=dict(sha256=info['sha256'], bytes=info['size'], codec=info['codec'],
                                      durationMs=info['duration_ms'], revision=record.revision))
    state = gates.part_state(fresh, record, [], check_file=False)
    return dict(id=group_id, hasAudio=True, audioDurationSec=fresh.audio_duration_sec,
                audioUrl=media_url(group_id, 'audio'), imageUrl=media_url(group_id, 'image') if fresh.image_key else None,
                status=state['status'], revision=record.revision, replaced=old is not None, warnings=info['warnings'],
                version=exam.content_version)


def verify_part_audio(actor, group_id: str, data: dict) -> dict:
    """Staff attestation that every answer of the part is heard in the attached recording."""
    from apps.core.mock_media import resolve_key

    if actor.role not in VERIFIER_ROLES:
        reject('FORBIDDEN', 'Only administrators can verify Listening audio', 403)
    if data.get('attestation') is not True or data.get('listenedFully') is not True:
        reject('ATTESTATION_REQUIRED', 'Confirm that you listened to the whole recording and checked every answer', 400)
    note = data.get('note') or ''
    if not isinstance(note, str) or len(note) > 1000:
        reject('VALIDATION_ERROR', 'Note must be text of at most 1000 characters', 400)
    heard = data.get('heardQuestions')
    if not isinstance(heard, list) or any(type(n) is not int for n in heard):
        reject('VALIDATION_ERROR', 'heardQuestions must be a list of question numbers', 400)
    group = _group_or_throw(group_id)
    _require_listening(group)
    with transaction.atomic():
        exam = locked_exam(group.section.exam_id)
        assert_author(actor, exam, allow_any_staff=True)
        record = MockListeningAudio.objects.select_for_update().filter(group_id=group_id).first()
        group = MockQuestionGroup.objects.get(id=group_id)
        if record is None or not group.audio_key:
            reject('AUDIO_NOT_UPLOADED', 'Upload the recording before verifying it', 409)
        if record.storage_key != group.audio_key:
            reject('AUDIO_RECORD_STALE', 'The recording changed outside the audio pipeline — upload it again', 409)
        path = resolve_key(group.audio_key)
        if not path.is_file() or gates.sha256_file(path) != record.sha256:
            reject('AUDIO_CHECKSUM_MISMATCH', 'The stored recording no longer matches the validated upload', 409)
        expected = sorted(MockQuestion.objects.filter(group_id=group_id).values_list('number', flat=True))
        if not expected:
            reject('NO_QUESTIONS', 'The part has no questions to align with the recording', 409)
        if sorted(set(heard)) != expected:
            missing = sorted(set(expected) - set(heard))
            extra = sorted(set(heard) - set(expected))
            reject('ALIGNMENT_INCOMPLETE', 'Every question of the part must be confirmed'
                   + (f' (missing {missing})' if missing else '') + (f' (not in this part {extra})' if extra else ''), 400)
        now = timezone.now()
        record.status, record.verified_by_id, record.verified_at = 'verified', actor.id, now
        record.verified_sha256, record.verified_fingerprint = record.sha256, gates.questions_fingerprint(group_id)
        record.verification_note = note.strip()
        record.save()
    audit_event(actor, 'mock.listening.audio.verify', 'mockQuestionGroup', group_id,
                new=dict(sha256=record.sha256, revision=record.revision, questions=expected))
    return dict(groupId=group_id, status=gates.VERIFIED, verifiedAt=record.verified_at, verifiedBy=actor.id, revision=record.revision)


def set_content_rights(actor, exam_id: str, data: dict) -> dict:
    """Administrator decision on redistribution rights of the supplied material."""
    if actor.role not in VERIFIER_ROLES:
        reject('FORBIDDEN', 'Only administrators can record content rights', 403)
    status = data.get('status')
    if status not in ('verified', 'unverified'):
        reject('VALIDATION_ERROR', 'status must be "verified" or "unverified"', 400)
    evidence = data.get('evidence') or ''
    if not isinstance(evidence, str):
        reject('VALIDATION_ERROR', 'evidence must be text', 400)
    if status == 'verified' and (data.get('attestation') is not True or len(evidence.strip()) < 20):
        reject('EVIDENCE_REQUIRED', 'Verified rights need an attestation and a written permission reference (at least 20 characters)', 400)
    with transaction.atomic():
        exam = locked_exam(exam_id)
        gate = MockExamGate.objects.select_for_update().filter(exam_id=exam_id).first()
        if gate is None:
            reject('GATE_NOT_FOUND', 'This exam has no content-rights gate', 404)
        old = gate.content_rights
        gate.content_rights = status
        gate.rights_note = evidence.strip() if status == 'verified' else ''
        gate.rights_verified_by_id = actor.id if status == 'verified' else None
        gate.rights_verified_at = timezone.now() if status == 'verified' else None
        gate.save()
        if status == 'unverified' and exam.is_published:  # withdrawing permission must hide the exam at once
            exam.is_published = False
            exam.save(update_fields=['is_published'])
    audit_event(actor, 'mock.exam.content_rights', 'mockExam', exam_id, old=dict(status=old), new=dict(status=status))
    return gates.gate_payload(exam)
