"""Schema-1.0 package export of an authored exam (the inverse of ``mock_imports``).

The export is a package the importer accepts unchanged, so a teacher can move an exam
between drafts, keep a backup, or hand a skill to a colleague:

    import -> save -> export -> re-import

Rules:

* Staff only, and a teacher only for an exam they created (the package carries the
  answer keys). Admins may export any exam.
* Media files are never inlined. Each group audio/image becomes a ``media``
  declaration (basename only) with ``audioRef`` / ``imageRef``; on re-import the
  teacher binds the file again. Listening audio is ``requiredForPublish`` so a
  re-imported Listening part can never be published silently without its recording.
* Keys come from the latest import's source map when the exam was imported (stable
  identity across round trips); otherwise deterministic keys are derived from skill,
  group order and question number.
* Nothing is invented: missing optional text exports as ``""`` and missing titles
  fall back to the visible default the builder itself shows ("Reading", "Part 2").
"""
from __future__ import annotations

import re

from apps.legacy_schema.models import (
    MockExam,
    MockExamImport,
    MockImportSourceMap,
    MockQuestion,
    MockQuestionGroup,
    MockSection,
)
from common.api.exceptions import ContractAPIException

from .mock_authoring import assert_author
from .mock_content import LAYOUTS
from .mock_import_validate import KEY, SKILLS

SKILL_TITLES = {'listening': 'Listening', 'reading': 'Reading', 'writing': 'Writing', 'speaking': 'Speaking'}
_SLUG = re.compile(r'[^a-z0-9_-]+')


def _slug(value: str, fallback: str) -> str:
    text = _SLUG.sub('-', (value or '').lower()).strip('-')
    if not text or not text[0].isalpha():
        text = f'{fallback}-{text}' if text else fallback
    return text[:80].rstrip('-') or fallback


class _Keys:
    """Unique, schema-valid keys (the importer rejects duplicates across one package)."""

    def __init__(self, mapped: dict[tuple[str, str], str]):
        self.mapped = mapped
        self.used: set[str] = set()

    def take(self, kind: str, entity_id: str, fallback: str) -> str:
        wanted = self.mapped.get((kind, entity_id))
        key = wanted if isinstance(wanted, str) and KEY.fullmatch(wanted) else _slug(fallback, kind[0])
        base, n = key, 2
        while key in self.used:
            suffix = f'-{n}'
            key = base[: 80 - len(suffix)] + suffix
            n += 1
        self.used.add(key)
        return key


def _source_keys(exam_id: str) -> dict[tuple[str, str], str]:
    latest = MockExamImport.objects.filter(exam_id=exam_id).order_by('-revision', '-created_at').first()
    if latest is None:
        return {}
    return {(row.kind, row.entity_id): row.source_key
            for row in MockImportSourceMap.objects.filter(import_record_id=latest.id)}


def _basename(storage_key: str, fallback: str) -> str:
    name = (storage_key or '').replace('\\', '/').rsplit('/', 1)[-1]
    name = re.sub(r'[:\x00-\x1f\x7f]', '', name).strip()
    return name[:255] if name and name not in ('.', '..') else fallback


def _text(value) -> str:
    return value if isinstance(value, str) else ''


def export_package(actor, exam_id: str, skill: str | None = None, *, template: bool = False, group_id: str | None = None) -> dict:
    """`template=True` produces a reusable package *without answer keys*: correctAnswers and
    acceptedVariants are emptied and answer-revealing review fields (evidence, audio timestamps)
    are dropped. The package carries `"template": true`, which lets the importer accept the empty
    keys as a publish blocker (never an import blocker), and an open review issue so a draft made
    from it cannot be published until keys are added. `group_id` exports one question group."""
    exam = MockExam.objects.filter(id=exam_id).first()
    if exam is None:
        raise ContractAPIException('MOCK_EXAM_NOT_FOUND', 'Mock imtihon topilmadi', 404)
    # Answer keys travel in the package: same ownership rule as editing.
    assert_author(actor, exam)
    if skill is not None and skill not in SKILLS:
        raise ContractAPIException('VALIDATION_ERROR', 'skill must be listening, reading, writing or speaking', 400)

    sections = list(MockSection.objects.filter(exam_id=exam.id).order_by('sort_order', 'skill'))
    if skill:
        sections = [s for s in sections if s.skill == skill]
        if not sections:
            raise ContractAPIException('MOCK_SECTION_NOT_FOUND', f'Bu imtihonda {skill} bo‘limi yo‘q', 404)
    groups = list(MockQuestionGroup.objects.filter(section_id__in=[s.id for s in sections]).order_by('sort_order', 'created_at'))
    if group_id is not None:
        groups = [g for g in groups if g.id == group_id]
        if not groups:
            raise ContractAPIException('MOCK_GROUP_NOT_FOUND', 'Savollar guruhi topilmadi', 404)
        sections = [s for s in sections if s.id == groups[0].section_id]
    questions = list(MockQuestion.objects.filter(group_id__in=[g.id for g in groups]).order_by('sort_order', 'number'))
    by_section: dict[str, list] = {}
    for group in groups:
        by_section.setdefault(group.section_id, []).append(group)
    by_group: dict[str, list] = {}
    for question in questions:
        by_group.setdefault(question.group_id, []).append(question)

    keys = _Keys(_source_keys(exam.id))
    media: list[dict] = []
    media_keys: dict[tuple[str, str], str] = {}  # (kind, storage key) -> media key; reused files stay one declaration

    def media_ref(kind: str, storage_key: str | None, group_key: str, required: bool) -> str | None:
        if not storage_key:
            return None
        known = media_keys.get((kind, storage_key))
        if known:
            if required:
                next(m for m in media if m['key'] == known)['requiredForPublish'] = True
            return known
        key = keys.take('media', f'{kind}:{storage_key}', f'{group_key}-{kind}')
        media_keys[(kind, storage_key)] = key
        media.append(dict(key=key, kind=kind, fileName=_basename(storage_key, f'{key}.{"mp3" if kind == "audio" else "png"}'),
                          requiredForPublish=required,
                          description=f'Re-attach the {kind} file used by "{group_key}" before publishing.'))
        return key

    exported_sections = []
    for section in sections:
        section_key = keys.take('section', section.id, section.skill)
        out_groups = []
        for gi, group in enumerate(by_section.get(section.id, [])):
            rows = by_group.get(group.id, [])
            if not rows:
                # The importer needs 1+ questions per group; an empty authoring group
                # has no candidate-facing content to preserve.
                continue
            default_title = f'Part {group.part_number}' if group.part_number else f'{SKILL_TITLES[section.skill]} {gi + 1}'
            group_key = keys.take('group', group.id, f'{section.skill}-g{gi + 1}')
            value = dict(key=group_key, title=(group.title or '').strip() or default_title,
                         instructions=_text(group.instructions), passageText=_text(group.passage_text),
                         contentHtml=_text(group.content_html), audioScript=_text(group.audio_script),
                         contentLayout=group.content_layout if group.content_layout in LAYOUTS else 'document')
            if group.options_reusable is not None:
                value['optionsReusable'] = group.options_reusable
            if group.max_score is not None and section.skill in ('writing', 'speaking'):
                value['maxScore'] = group.max_score
            if group.stimulus_ref and section.skill == 'writing' and KEY.fullmatch(group.stimulus_ref):
                value['stimulusRef'] = group.stimulus_ref
            if section.skill == 'listening':
                if group.part_number is not None:
                    value['partNumber'] = group.part_number
                value['audioPlayLimit'] = group.audio_play_limit or 1
            audio = media_ref('audio', group.audio_key, group_key, section.skill == 'listening')
            image = media_ref('image', group.image_key, group_key, False)
            if audio:
                value['audioRef'] = audio
            if image:
                value['imageRef'] = image
            out_questions = []
            for question in rows:
                item = dict(key=keys.take('question', question.id, f'{section.skill}-q{question.number}'),
                            sourceRef=f'BestWay exam {exam.id} question {question.id}',
                            number=question.number, type=question.type, prompt=question.prompt,
                            options=list(question.options or []), correctAnswers=list(question.correct_answers or []),
                            acceptedVariants=list(question.accepted_variants or []), points=question.points)
                if question.word_limit is not None:
                    item['wordLimit'] = question.word_limit
                if question.answer_rule is not None:
                    item['answerRule'] = question.answer_rule
                if question.cefr_level:
                    item['cefrLevel'] = question.cefr_level
                if question.skill_tags:
                    item['skillTags'] = list(question.skill_tags)
                if question.evidence_text and not template:
                    item['evidenceText'] = question.evidence_text
                if question.audio_start_sec is not None and not template:
                    item['audioStartSec'] = question.audio_start_sec
                if template:
                    item['correctAnswers'], item['acceptedVariants'] = [], []
                    if item.get('answerRule') is None:
                        item.pop('answerRule', None)
                out_questions.append(item)
            value['questions'] = out_questions
            out_groups.append(value)
        entry = dict(key=section_key, skill=section.skill,
                     title=(section.title or '').strip() or SKILL_TITLES[section.skill],
                     instructions=_text(section.instructions), groups=out_groups)
        if section.duration_minutes is not None:
            entry['durationMinutes'] = section.duration_minutes
        exported_sections.append(entry)

    profile = exam.profile if exam.profile in ('practice', 'full_mock') else 'practice'
    if skill and profile == 'full_mock':
        profile = 'practice'  # one skill is never a full mock; keeps the publish blueprint honest
    value = dict(type=exam.type, title=exam.title, description=_text(exam.description), level=_text(exam.level),
                 isDemo=bool(exam.is_demo), price=int(exam.price or 0), isFreeForApproved=bool(exam.is_free_for_approved),
                 sections=exported_sections)
    if exam.practice_level and exam.type == 'multilevel' and profile == 'practice':
        value['practiceLevel'] = exam.practice_level
    if group_id is not None and profile == 'full_mock':
        profile = 'practice'
    stem = f'bw-{"tpl-" if template else ""}{exam.id}' + (f'-{skill}' if skill else '') + (f'-g{group_id[:8]}' if group_id else '')
    package = dict(schemaVersion='1.0', packageId=_slug(stem, 'bw'), revision=max(1, int(exam.content_version or 1)),
                   profile=profile, source=dict(kind='provided_material', label=f'BestWay {"template" if template else "export"}: {exam.title}'[:200]),
                   exam=value, media=media, reviewIssues=[])
    if template:
        package['template'] = True
        package['reviewIssues'] = [dict(key='template-answer-keys', code='MISSING_ANSWER', path='/exam',
            message='Template without answer keys: add and verify every answer key before publishing.',
            sourceRef=f'BestWay template of exam {exam.id}')]
    return package
