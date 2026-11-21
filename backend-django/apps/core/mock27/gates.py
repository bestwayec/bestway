"""Derived audio status and publication gates for gated (supplied-material) mocks.

Status is computed from facts, never stored as a free flag:

* MISSING   no recording is attached to the Listening part
* UPLOADED  a validated recording is attached but not (or no longer) verified
* VERIFIED  a staff member attested, for exactly this file and exactly these answer keys,
            that every answer of the part can be heard in the recording
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from apps.core.models import MockExamGate, MockListeningAudio
from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection

MISSING, UPLOADED, VERIFIED = 'MISSING', 'UPLOADED', 'VERIFIED'
RIGHTS_OK = ('verified', 'original')


def gate_for(exam_id: str):
    return MockExamGate.objects.filter(exam_id=exam_id).first()


def requires_validated_audio(exam_id: str) -> bool:
    gate = gate_for(exam_id)
    return bool(gate and gate.require_verified_audio)


def sha256_file(path) -> str:
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def questions_fingerprint(group_id: str) -> str:
    """Digest of the part's answer keys: a later edit of any key invalidates the verification."""
    rows = MockQuestion.objects.filter(group_id=group_id).order_by('number').values_list(
        'number', 'type', 'correct_answers', 'accepted_variants', 'options')
    blob = json.dumps([[n, t, list(c or []), list(v or []), list(o or [])] for n, t, c, v, o in rows],
                      sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode('utf-8')).hexdigest()


def _file_exists(key) -> bool:
    from apps.core.mock_media import resolve_key
    from common.api.exceptions import ContractAPIException
    try:
        return resolve_key(key).is_file()
    except ContractAPIException:
        return False


def part_state(group, record, numbers, *, check_file=True) -> dict:
    """Status plus the problems that explain it, for one Listening part."""
    problems: list[str] = []
    if not group.audio_key:
        return dict(status=MISSING, problems=['No recording attached'])
    if record is None:
        return dict(status=UPLOADED, problems=['Recording was not validated by the audio pipeline — upload it again'])
    if record.storage_key != group.audio_key:
        problems.append('Recording changed outside the audio pipeline — re-upload and verify')
    if check_file and not _file_exists(group.audio_key):
        problems.append('Recording file is not available on the server')
    if record.status != 'verified':
        problems.append('Waiting for staff verification')
    else:
        if record.verified_sha256 != record.sha256:
            problems.append('Verified checksum no longer matches the file')
        if record.verified_fingerprint != questions_fingerprint(group.id):
            problems.append('Answer keys changed after verification — verify again')
    return dict(status=VERIFIED if not problems else UPLOADED, problems=problems)


def listening_groups(exam_id: str) -> list:
    return list(MockQuestionGroup.objects.filter(section__exam_id=exam_id, section__skill='listening')
                .order_by('part_number', 'sort_order'))


def parts_report(exam_id: str) -> list[dict]:
    groups = listening_groups(exam_id)
    records = {r.group_id: r for r in MockListeningAudio.objects.filter(exam_id=exam_id)}
    numbers = {}
    for gid, number in MockQuestion.objects.filter(group__in=groups).order_by('number').values_list('group_id', 'number'):
        numbers.setdefault(gid, []).append(number)
    out = []
    for group in groups:
        record = records.get(group.id)
        nums = numbers.get(group.id, [])
        state = part_state(group, record, nums)
        out.append(dict(
            groupId=group.id, partNumber=group.part_number, title=group.title,
            questionNumbers=nums, questionRange=[nums[0], nums[-1]] if nums else None, questionCount=len(nums),
            status=state['status'], problems=state['problems'], hasAudio=bool(group.audio_key),
            durationSec=group.audio_duration_sec,
            audio=None if record is None else dict(
                container=record.container, codec=record.codec, sizeBytes=record.size_bytes,
                sampleRate=record.sample_rate, channels=record.channels, revision=record.revision,
                originalName=record.original_name, checksum=record.sha256[:16],
                uploadedBy=record.uploaded_by_id, uploadedAt=record.uploaded_at,
                verifiedBy=record.verified_by_id, verifiedAt=record.verified_at,
                verificationNote=record.verification_note or None)))
    return out


def gate_payload(exam: MockExam) -> dict:
    gate = gate_for(exam.id)
    parts = parts_report(exam.id)
    verified = sum(p['status'] == VERIFIED for p in parts)
    return dict(
        examId=exam.id, gated=gate is not None, published=exam.is_published,
        rights=None if gate is None else dict(
            status=gate.content_rights, sources=gate.rights_sources, note=gate.rights_note or None,
            verifiedBy=gate.rights_verified_by_id, verifiedAt=gate.rights_verified_at),
        audio=dict(requiredVerified=bool(gate and gate.require_verified_audio), parts=parts,
                   verifiedParts=verified, totalParts=len(parts), allVerified=bool(parts) and verified == len(parts),
                   missingParts=[p['partNumber'] for p in parts if p['status'] == MISSING]),
        blockers=blockers(exam))


def gate_readiness_items(exam: MockExam) -> list[dict]:
    """Extra readiness items; empty for exams without a gate row (existing mocks are unaffected)."""
    gate = gate_for(exam.id)
    if gate is None:
        return []
    items = []
    ok = gate.content_rights in RIGHTS_OK
    items.append(dict(key='content_rights', ok=ok, detail=(
        f'redistribution rights {gate.content_rights}' if ok else
        'redistribution rights are unverified — an administrator must confirm permission to publish the supplied material')))
    if gate.require_verified_audio and exam.type in ('ielts_academic', 'ielts_general'):
        parts = parts_report(exam.id)
        verified = sum(p['status'] == VERIFIED for p in parts)
        listing = ', '.join(f'Part {p["partNumber"]}: {p["status"]}' for p in parts) or 'no Listening parts'
        items.append(dict(key='listening_audio_verified', ok=bool(parts) and len(parts) == 4 and verified == 4,
                          detail=f'{verified}/{len(parts) or 4} Listening parts verified ({listing})'))
    return items


def blockers(exam: MockExam) -> list[str]:
    return [i['detail'] for i in gate_readiness_items(exam) if not i['ok']]


def assert_gate_allows_exposure(exam: MockExam) -> None:
    """Raise when a gated exam would become visible to students (published or demo)."""
    from common.api.exceptions import ContractAPIException
    problems = blockers(exam)
    if problems:
        raise ContractAPIException('MOCK_NOT_READY', 'Exam not ready to publish: ' + '; '.join(problems), 400)


def copy_gate(source_id: str, clone_id: str) -> None:
    """A clone of a gated exam stays gated (same rights decision); audio must be re-verified for it."""
    gate = gate_for(source_id)
    if gate is None:
        return
    MockExamGate.objects.create(exam_id=clone_id, content_rights=gate.content_rights, rights_sources=gate.rights_sources,
                                rights_note=gate.rights_note, rights_verified_by_id=gate.rights_verified_by_id,
                                rights_verified_at=gate.rights_verified_at, require_verified_audio=gate.require_verified_audio,
                                source_digests=gate.source_digests)


def purge_gate(exam_id: str) -> None:
    MockExamGate.objects.filter(exam_id=exam_id).delete()
    MockListeningAudio.objects.filter(exam_id=exam_id).delete()
