"""Atomic schema-1.0 package commit, media ledger, provenance and review routes."""
import hashlib
from datetime import timedelta

from django.db import connection, transaction, IntegrityError, OperationalError
from django.utils import timezone

from apps.legacy_schema.models import (MockExam, MockSection, MockQuestionGroup, MockQuestion,
    MockExamImport, MockImportSourceMap, MockImportReviewIssue, MockStagedMedia, MockAttempt)
from common.api.exceptions import ContractAPIException
from .mock_authoring import new_id, audit_event, bump
from .mock_content import sanitize_content
from .mock_import_validate import validate_package
from .mock_rules import canonical_decision
from .multilevel import CURRENT_SPEC, CURRENT_SPEAKING_PROFILE


def assert_staff(actor):
    if actor.role not in ('teacher', 'admin', 'super_admin'):
        raise ContractAPIException('MOCK_FORBIDDEN', 'Bu amal faqat xodimlar uchun', 403)


def status_payload(row, *, replay=True, added=False):
    return dict(importId=row.id, examId=row.exam_id, revision=row.revision, replay=replay,
                addedToExisting=added, editorUrl=f'/exam-builder/{row.exam_id}')


def replay_or_conflict(row, checksum, target):
    if row.normalized_checksum != checksum:
        raise ContractAPIException('MOCK_IMPORT_CONFLICT', 'Same revision with changed content — increment revision for a new draft', 409)
    return status_payload(row, added=bool(target and target == row.exam_id))


def resolve_issue_source(pkg, pointer):
    if not isinstance(pointer, str) or not pointer.startswith('/'):
        return None
    parts = [p.replace('~1', '/').replace('~0', '~') for p in pointer[1:].split('/')]
    if parts[:2] != ['exam', 'sections']:
        return None
    def at(items, index):
        try:
            number = float(index or '0')
            return items[int(number)] if number.is_integer() and 0 <= number < len(items) else None
        except (ValueError, TypeError):
            return None
    section = at(pkg.get('exam', {}).get('sections', []), parts[2] if len(parts) > 2 else 'NaN')
    if not isinstance(section, dict) or not isinstance(section.get('key'), str):
        return None
    source = dict(kind='section', key=section['key'])
    if len(parts) > 4 and parts[3] == 'groups':
        group = at(section.get('groups', []), parts[4])
        if not isinstance(group, dict) or not isinstance(group.get('key'), str):
            return source
        source = dict(kind='group', key=group['key'])
        if len(parts) > 6 and parts[5] == 'questions':
            question = at(group.get('questions', []), parts[6])
            if isinstance(question, dict) and isinstance(question.get('key'), str):
                source = dict(kind='question', key=question['key'])
    return source


def resolve_bindings(actor, pkg, bindings):
    kinds = {m['key']: m['kind'] for m in pkg.get('media', [])}
    for key in bindings:
        if key not in kinds:
            raise ContractAPIException('MOCK_IMPORT_BINDING', f'Unknown media key "{key}"', 422)
    rows = {row.id: row for row in MockStagedMedia.objects.filter(id__in=list(bindings.values()))}
    result = {}
    for key, upload_id in bindings.items():
        row = rows.get(upload_id)
        if row is None:
            raise ContractAPIException('MOCK_IMPORT_MEDIA', f'Staged upload not found for "{key}"', 422)
        if row.owner_id != actor.id:
            raise ContractAPIException('MOCK_IMPORT_MEDIA', f'Staged upload for "{key}" belongs to another user', 403)
        if row.expires_at < timezone.now():
            raise ContractAPIException('MOCK_IMPORT_MEDIA', f'Staged upload for "{key}" has expired', 410)
        if row.kind != kinds[key]:
            raise ContractAPIException('MOCK_IMPORT_MEDIA', f'Media kind mismatch for "{key}"', 422)
        result[key] = row
    return result


def stage_media(actor, upload):
    assert_staff(actor)
    if upload is None:
        raise ContractAPIException('NO_FILE', 'Fayl yuklanmadi', 400)
    from .mock_media import store_upload, delete_created
    key = store_upload(upload, staged=True)
    stamp = timezone.now()
    try:
        row = MockStagedMedia.objects.create(id=new_id(), owner_id=actor.id, storage_key=key,
            file_name=upload.name[:255], mime_type=upload.content_type, size_bytes=upload.size,
            checksum=hashlib.sha256(f'{key.split("/")[-1]}:{upload.size}'.encode()).hexdigest(),
            kind='audio' if upload.content_type.startswith('audio/') else 'image',
            expires_at=stamp + timedelta(hours=24), claimed_at=None, claimed_import_id=None, created_at=stamp)
    except Exception:
        delete_created(key)
        raise
    return dict(uploadId=row.id, fileName=row.file_name, mimeType=row.mime_type,
                sizeBytes=row.size_bytes, kind=row.kind, expiresAt=row.expires_at)


def commit_import(actor, pkg, bindings, checksum, raw_text=None, target_id=None):
    assert_staff(actor)
    report = validate_package(pkg, bindings, raw_text)
    if not report['canImport']:
        first = next(i for i in report['issues'] if 'import' in i['blocks'])
        tail = f' (+{report["totalIssues"] - 1})' if report['totalIssues'] > 1 else ''
        raise ContractAPIException('MOCK_IMPORT_INVALID', f'Import validation failed: {first["code"]} {first["path"]}{tail}', 422)
    if not checksum or checksum != report['checksum']:
        raise ContractAPIException('MOCK_IMPORT_STALE', 'Validated checksum mismatch — run validate again before import', 422)
    identity = dict(created_by_id=actor.id, package_id=pkg['packageId'], revision=pkg['revision'])
    existing = MockExamImport.objects.filter(**identity).first()
    if existing:
        return replay_or_conflict(existing, checksum, target_id)
    staged = resolve_bindings(actor, pkg, bindings)
    nested = connection.in_atomic_block
    try:
        with transaction.atomic():
            if not nested:
                with connection.cursor() as cursor:
                    cursor.execute('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
            target = MockExam.objects.select_for_update().filter(id=target_id).first() if target_id else None
            if target_id and target is None:
                raise ContractAPIException('MOCK_EXAM_NOT_FOUND', 'Tanlangan imtihon topilmadi', 404)
            if target:
                if actor.role == 'teacher' and target.created_by_id != actor.id:
                    raise ContractAPIException('MOCK_NOT_OWNER', 'Bu imtihonni tahrirlash huquqi yo‘q', 403)
                if target.is_published or MockAttempt.objects.filter(exam_id=target.id).exists():
                    raise ContractAPIException('MOCK_CONTENT_LOCKED', 'Nashr qilingan yoki o‘quvchilar ishlatgan imtihonga import qilib bo‘lmaydi. Avval nusxa oling', 409)
                if target.type != pkg['exam']['type']:
                    raise ContractAPIException('MOCK_IMPORT_TYPE_MISMATCH', f'Paket turi {pkg["exam"]["type"]}, tanlangan imtihon turi esa {target.type}', 409)
                bump(target)
            value, stamp = pkg['exam'], timezone.now()
            exam = target or MockExam.objects.create(id=new_id(), type=value['type'], title=value['title'][:200],
                description=value.get('description'), level=value.get('level'), practice_level=value.get('practiceLevel'),
                is_demo=value.get('isDemo', False), is_published=False, price=value.get('price', 0),
                is_free_for_approved=value.get('isFreeForApproved', False), created_by_id=actor.id,
                profile=pkg.get('profile', 'practice'), content_version=1, blueprint_ref=None, assessment_policy=None,
                specification_version=CURRENT_SPEC if value['type'] == 'multilevel' else None,
                speaking_profile_version=CURRENT_SPEAKING_PROFILE if value['type'] == 'multilevel' else None,
                created_at=stamp, updated_at=stamp)
            maps = []
            for si, section in enumerate(value['sections']):
                old = MockSection.objects.filter(exam_id=exam.id, skill=section['skill']).first() if target else None
                old_groups = list(MockQuestionGroup.objects.filter(section_id=old.id)) if old else []
                if old:
                    numbers = set(MockQuestion.objects.filter(group__section_id=old.id).values_list('number', flat=True))
                    collision = next((q['number'] for g in section['groups'] for q in g['questions'] if q['number'] in numbers), None)
                    if collision is not None:
                        raise ContractAPIException('MOCK_IMPORT_NUMBER_COLLISION', f'{section["skill"]} bo‘limida {collision}-savol allaqachon mavjud', 409)
                    if section['skill'] == 'listening':
                        parts = {g.part_number for g in old_groups if g.part_number is not None}
                        collision = next((g['partNumber'] for g in section['groups'] if g.get('partNumber') in parts), None)
                        if collision is not None:
                            raise ContractAPIException('MOCK_IMPORT_PART_COLLISION', f'Listening Part {collision} tanlangan imtihonda allaqachon mavjud', 409)
                saved_section = old or MockSection.objects.create(id=new_id(), exam_id=exam.id, skill=section['skill'],
                    title=section.get('title'), sort_order=('listening', 'reading', 'writing', 'speaking').index(section['skill']),
                    duration_minutes=section.get('durationMinutes'), instructions=section.get('instructions'))
                maps.append(('section', section['key'], saved_section.id))
                base = max((g.sort_order for g in old_groups), default=-1) + 1
                for gi, group in enumerate(section['groups']):
                    audio, image = staged.get(group.get('audioRef')), staged.get(group.get('imageRef'))
                    saved_group = MockQuestionGroup.objects.create(id=new_id(), section_id=saved_section.id, sort_order=base + gi,
                        title=group.get('title'), instructions=group.get('instructions'), passage_text=group.get('passageText') or None,
                        content_html=sanitize_content(group.get('contentHtml')), audio_script=sanitize_content(group.get('audioScript')),
                        content_layout=group.get('contentLayout'), options_reusable=group.get('optionsReusable'),
                        part_number=group.get('partNumber') if section['skill'] == 'listening' else None,
                        audio_play_limit=group.get('audioPlayLimit', 1), audio_duration_sec=None,
                        audio_key=audio.storage_key if audio else None, image_key=image.storage_key if image else None,
                        max_score=None, stimulus_ref=None, created_at=stamp)
                    maps.append(('group', group['key'], saved_group.id))
                    for qi, question in enumerate(group['questions']):
                        keys = question.get('correctAnswers', [])
                        if question['type'] in ('true_false_notgiven', 'yes_no_notgiven'):
                            keys = [canonical_decision(k) for k in keys]
                        saved_question = MockQuestion.objects.create(id=new_id(), group_id=saved_group.id,
                            number=question['number'], sort_order=qi, type=question['type'], prompt=question['prompt'].strip(),
                            options=question.get('options', []), correct_answers=keys, accepted_variants=question.get('acceptedVariants', []),
                            points=question.get('points', 1), word_limit=question.get('wordLimit'), answer_rule=question.get('answerRule'), created_at=stamp)
                        maps.append(('question', question['key'], saved_question.id))
            row = MockExamImport.objects.create(id=new_id(), **identity, schema_version='1.0', profile=pkg['profile'],
                raw_checksum=checksum, normalized_checksum=checksum, validated_checksum=checksum, exam_id=exam.id, created_at=stamp)
            MockImportSourceMap.objects.bulk_create([MockImportSourceMap(id=new_id(), import_record_id=row.id,
                kind=kind, source_key=key, entity_id=entity) for kind, key, entity in maps])
            reviews = []
            for issue in pkg.get('reviewIssues', []):
                source = resolve_issue_source(pkg, issue['path']) or {}
                reviews.append(MockImportReviewIssue(id=new_id(), import_record_id=row.id,
                    source_key=source.get('key'), entity_kind=source.get('kind'), code=issue['code'], path=issue['path'],
                    message=issue['message'], status='open', resolved_by_id=None, resolved_at=None, created_at=stamp))
            MockImportReviewIssue.objects.bulk_create(reviews)
            if staged:
                MockStagedMedia.objects.filter(id__in=[s.id for s in staged.values()]).update(claimed_at=stamp, claimed_import_id=row.id)
        audit_event(actor, 'mock.exam.import.append' if target else 'mock.exam.import', 'mockExam', exam.id,
            new=dict(packageId=pkg['packageId'], revision=pkg['revision'], checksum=checksum, targetExamId=target_id))
        return status_payload(row, replay=False, added=bool(target))
    except IntegrityError:
        raced = MockExamImport.objects.filter(**identity).first()
        if raced:
            return replay_or_conflict(raced, checksum, target_id)
        raise
    except OperationalError as error:
        if getattr(error.__cause__, 'sqlstate', None) == '40001':
            raise ContractAPIException('MOCK_CONTENT_CONFLICT', 'Another editor changed this exam. Reload before importing', 409)
        raise


def by_package(actor, package_id, revision):
    assert_staff(actor)
    row = MockExamImport.objects.filter(created_by_id=actor.id, package_id=package_id, revision=revision).first()
    if row is None and actor.role in ('admin', 'super_admin'):
        row = MockExamImport.objects.filter(package_id=package_id, revision=revision).first()
    if row is None:
        raise ContractAPIException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404)
    return status_payload(row)


def by_exam(actor, exam_id):
    assert_staff(actor)
    exam = MockExam.objects.filter(id=exam_id).first()
    if exam is None:
        raise ContractAPIException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404)
    if actor.role == 'teacher' and exam.created_by_id != actor.id:
        raise ContractAPIException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404)
    latest = MockExamImport.objects.filter(exam_id=exam.id).order_by('-revision').first()
    if latest is None:
        raise ContractAPIException('MOCK_IMPORT_NOT_FOUND', 'Import topilmadi', 404)
    issues = list(MockImportReviewIssue.objects.filter(import_record_id=latest.id).order_by('created_at'))
    maps = MockImportSourceMap.objects.filter(import_record_id=latest.id)
    return dict(packageId=latest.package_id, revision=latest.revision, profile=latest.profile, importedAt=latest.created_at,
        openIssues=sum(i.status != 'resolved' for i in issues),
        issues=[dict(id=i.id, code=i.code, path=i.path, message=i.message, sourceKey=i.source_key, entityKind=i.entity_kind, status=i.status) for i in issues],
        sourceMaps=[dict(kind=m.kind, sourceKey=m.source_key, entityId=m.entity_id) for m in maps])


def resolve_issue(actor, issue_id):
    assert_staff(actor)
    with transaction.atomic():
        issue = MockImportReviewIssue.objects.select_for_update().select_related('import_record__exam').filter(id=issue_id).first()
        if issue is None:
            raise ContractAPIException('MOCK_IMPORT_NOT_FOUND', 'Issue topilmadi', 404)
        if actor.role == 'teacher' and issue.import_record.exam.created_by_id != actor.id:
            raise ContractAPIException('MOCK_FORBIDDEN', 'Bu amal faqat imtihon egasi uchun', 403)
        issue.status, issue.resolved_by_id, issue.resolved_at = 'resolved', actor.id, timezone.now()
        issue.save(update_fields=['status', 'resolved_by_id', 'resolved_at'])
    audit_event(actor, 'mock.exam.import.issue.resolve', 'mockImportReviewIssue', issue.id, new=dict(code=issue.code, path=issue.path))
    return dict(id=issue.id, importId=issue.import_record_id, sourceKey=issue.source_key, entityKind=issue.entity_kind,
        code=issue.code, path=issue.path, message=issue.message, status=issue.status,
        resolvedById=issue.resolved_by_id, resolvedAt=issue.resolved_at, createdAt=issue.created_at)
