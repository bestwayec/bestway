"""Idempotent, transactional import of Full Mock Test 27 as a DRAFT through the existing validated importer."""
from __future__ import annotations

import json
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.utils import timezone

from apps.core.mock_import_validate import validate_package
from apps.core.mock_imports import commit_import, stage_media
from apps.core.models import MockExamGate
from apps.legacy_schema.models import MockAttempt, MockExam, MockExamImport
from common.api.exceptions import ContractAPIException

from . import EXAM_SLUG, EXAM_TITLE
from .original_content import DESCRIPTION, speaking_package, writing_package
from .package_checks import evidence_issues, objective_issues, script_evidence_issues

ASSETS = Path(__file__).parent / 'assets'
PRIVATE_FILES = {'listening': ('listening.package.json', 4), 'reading': ('reading.package.json', 3)}
ORDER = ('listening', 'reading', 'writing', 'speaking')


class ImportProblem(RuntimeError):
    pass


def load_private_packages(source_dir: Path | None, suffix: str = '') -> dict[str, tuple[dict, str]]:
    packages = {}
    if source_dir is None:
        return packages
    for skill, (name, groups) in PRIVATE_FILES.items():
        path = Path(source_dir) / name
        if not path.is_file():
            continue
        raw = path.read_text(encoding='utf-8')
        package = json.loads(raw)
        package['packageId'] += suffix
        problems = objective_issues(package, expected_groups=groups) + (evidence_issues(package) if skill == 'reading' else [])
        if problems:
            raise ImportProblem(f'{skill}: ' + '; '.join(problems))
        packages[skill] = (package, raw)
    return packages


def _validated(package: dict, raw: str, bindings: dict) -> str:
    report = validate_package(package, bindings, raw)
    if not report['canImport']:
        first = next(i for i in report['issues'] if 'import' in i['blocks'])
        raise ImportProblem(f'{package["packageId"]}: {first["code"]} {first["path"]} {first["message"]}')
    return report['checksum']


def load_original_packages(suffix: str = '') -> dict[str, tuple[dict, str]]:
    """The fully original Listening/Reading replacement committed with the repository."""
    from .original_listening import listening_package
    from .original_reading import reading_package
    packages = {}
    for skill, builder, groups in (('listening', listening_package, 4), ('reading', reading_package, 3)):
        package = builder()
        package['packageId'] += suffix
        problems = objective_issues(package, expected_groups=groups) + (evidence_issues(package) if skill == 'reading' else script_evidence_issues(package))
        if problems:
            raise ImportProblem(f'original {skill}: ' + '; '.join(problems))
        packages[skill] = (package, json.dumps(package, ensure_ascii=False))
    return packages


def import_mock27(actor, *, source_dir: Path | None = None, source_digests: dict | None = None, dry_run: bool = False,
                  exam_id: str = EXAM_SLUG, id_suffix: str = '', content: str = 'supplied') -> dict:
    """Create/extend the draft exam. Never publishes; re-running changes nothing.

    content='supplied': Listening/Reading from the owner's private packages (rights stay unverified).
    content='original': the fully original replacement committed in this repository (rights 'original').
    """
    if content not in ('supplied', 'original'):
        raise ImportProblem('content must be "supplied" or "original"')
    if content == 'original' and source_dir is not None:
        raise ImportProblem('--source-dir cannot be combined with --content original')
    packages = load_original_packages(id_suffix) if content == 'original' else load_private_packages(source_dir, id_suffix)
    for skill, builder in (('writing', writing_package), ('speaking', speaking_package)):
        package = builder()
        package['packageId'] += id_suffix
        packages[skill] = (package, json.dumps(package, ensure_ascii=False))
    plan = {skill: _validated(*packages[skill], bindings=({'task1_maps': 'x'} if skill == 'writing' else {})) for skill in packages}
    if dry_run:
        return dict(dryRun=True, skills=sorted(packages), checksums=plan)

    result = dict(examId=exam_id, imported=[], replayed=[], skippedMissingSources=[s for s in ORDER if s not in packages])
    with transaction.atomic():
        exam = MockExam.objects.select_for_update().filter(id=exam_id).first()
        if exam is not None and (exam.is_published or exam.is_demo):
            raise ImportProblem('The exam is already published/demo; refusing to modify it. Clone it instead.')
        if exam is None:
            stamp = timezone.now()
            exam = MockExam.objects.create(id=exam_id, type='ielts_academic', title=EXAM_TITLE, description=DESCRIPTION,
                                           level='IELTS Academic', is_published=False, is_demo=False, price=0,
                                           is_free_for_approved=True, created_by_id=actor.id, profile='full_mock',
                                           content_version=1, created_at=stamp, updated_at=stamp)
        if MockAttempt.objects.filter(exam_id=exam_id).exists():
            raise ImportProblem('Attempts exist for this exam; refusing to import into it.')
        for skill in ORDER:
            if skill not in packages:
                continue
            package, raw = packages[skill]
            done = MockExamImport.objects.filter(package_id=package['packageId'], revision=package['revision'], exam_id=exam_id).first()
            if done is not None:
                if done.normalized_checksum != plan[skill]:
                    raise ImportProblem(f'{skill}: content changed since revision {done.revision}; clone the exam to import a new revision')
                result['replayed'].append(skill)
                continue
            bindings = {}
            if skill == 'writing':
                data = (ASSETS / 'riverside-park-maps.png').read_bytes()
                staged = stage_media(actor, SimpleUploadedFile('riverside-park-maps.png', data, content_type='image/png'))
                bindings = {'task1_maps': staged['uploadId']}
            try:
                commit_import(actor, package, bindings, plan[skill], raw, target_id=exam_id)
            except ContractAPIException as error:
                raise ImportProblem(f'{skill}: {error.contract_code if hasattr(error, "contract_code") else error}') from error
            result['imported'].append(skill)
        sources = {s: ('original_practice' if packages[s][0]['source']['kind'] == 'original_practice' else 'provided_material') for s in packages}
        for s in ORDER:
            sources.setdefault(s, 'not_imported')
        all_original = all(v == 'original_practice' for v in sources.values())
        gate, created = MockExamGate.objects.get_or_create(exam_id=exam_id, defaults=dict(
            content_rights='original' if all_original else 'unverified', rights_sources=sources,
            require_verified_audio=True, source_digests=source_digests or {}))
        if not created and not all_original and (source_digests or {}) != gate.source_digests and source_digests:
            gate.content_rights, gate.rights_sources, gate.source_digests = 'unverified', sources, source_digests
            gate.rights_verified_by_id = gate.rights_verified_at = None
            gate.save()
        elif not created and gate.rights_sources != sources:
            gate.rights_sources = sources
            gate.content_rights = 'original' if all_original else ('unverified' if gate.content_rights == 'original' else gate.content_rights)
            gate.save()
    result['rights'] = MockExamGate.objects.get(exam_id=exam_id).content_rights
    return result
