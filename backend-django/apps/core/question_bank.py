"""Question bank for the Exam Builder: search reusable question groups and copy them into a draft.

The bank is the questions already authored in exams (the existing item bank). Nothing is shared
by reference: inserting copies a whole question group (its passage/audio context, instructions,
questions, options, keys and metadata) into the target draft, so a later edit in either exam never
changes the other. Media files are referenced by storage key; a file is only deleted when no group,
answer or staged upload references it any more (`mock_media.delete_unreferenced`).

Permissions: staff only. A teacher may reuse groups from exams they created; admins may reuse any.
The listing never contains answer keys; keys are copied server-side only into the actor's draft.
"""
from __future__ import annotations

import re

from django.db import connection, transaction
from django.db.models import Count, Max, Q
from django.utils import timezone

from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection
from common.api.exceptions import ContractAPIException

from .auth_service import audit
from .item_metadata import clean_cefr
from .mock_authoring import STAFF, assert_author, assert_mutable, bump, locked_exam, new_id
from .mock_import_validate import SKILLS

IELTS = ('ielts_academic', 'ielts_general')
MAX_GROUPS = 20
_GAP = re.compile(r'data-gap="(\d+)"')


def _family(exam_type):
    return 'ielts' if exam_type in IELTS else exam_type


def _assert_staff(actor):
    if actor.role not in STAFF:
        raise ContractAPIException('FORBIDDEN', 'Bu amal uchun rolingiz yetarli emas', 403)


def _reusable(actor):
    rows = MockQuestionGroup.objects.select_related('section__exam')
    if actor.role == 'teacher':
        rows = rows.filter(section__exam__created_by_id=actor.id)
    return rows


def search_groups(actor, query) -> dict:
    """Reusable groups with a question preview (prompts, types, options; never keys)."""
    _assert_staff(actor)
    rows = _reusable(actor).annotate(question_count=Count('mockquestion'))
    if query.get('examType'):
        rows = rows.filter(section__exam__type=query['examType'])
    if query.get('section'):
        if query['section'] not in SKILLS:
            raise ContractAPIException('VALIDATION_ERROR', 'section is invalid', 400)
        rows = rows.filter(section__skill=query['section'])
    if query.get('type'):
        rows = rows.filter(mockquestion__type=query['type'])
    if query.get('cefrLevel'):
        rows = rows.filter(mockquestion__cefr_level=clean_cefr(query['cefrLevel']))
    tag = (query.get('tag') or '').strip().lower()
    if tag:
        rows = rows.filter(mockquestion__skill_tags__contains=[tag])
    text = (query.get('search') or '').strip()
    if text:
        rows = rows.filter(Q(title__icontains=text) | Q(instructions__icontains=text) | Q(passage_text__icontains=text)
                           | Q(mockquestion__prompt__icontains=text) | Q(section__exam__title__icontains=text))
    if query.get('excludeExamId'):
        rows = rows.exclude(section__exam_id=query['excludeExamId'])
    try:
        limit = min(100, max(1, int(query.get('limit', 40))))
    except (TypeError, ValueError):
        raise ContractAPIException('VALIDATION_ERROR', 'limit must be a number', 400)
    groups = list(rows.filter(question_count__gt=0).distinct().order_by('-section__exam__updated_at', 'section__sort_order', 'sort_order')[:limit])
    questions = {}
    for q in MockQuestion.objects.filter(group_id__in=[g.id for g in groups]).order_by('sort_order', 'number'):
        questions.setdefault(q.group_id, []).append(q)
    items = []
    for g in groups:
        qs = questions.get(g.id, [])
        items.append(dict(
            groupId=g.id, title=g.title, instructions=g.instructions, skill=g.section.skill, partNumber=g.part_number,
            examId=g.section.exam_id, examTitle=g.section.exam.title, examType=g.section.exam.type,
            hasAudio=bool(g.audio_key), hasImage=bool(g.image_key),
            passageExcerpt=(g.passage_text or '')[:280],
            questionCount=len(qs),
            questions=[dict(number=q.number, type=q.type, prompt=q.prompt[:300], options=list(q.options or []),
                            cefrLevel=q.cefr_level, skillTags=list(q.skill_tags or [])) for q in qs],
        ))
    return dict(items=items, count=len(items))


def _renumber_html(html, mapping):
    if not html:
        return html
    return _GAP.sub(lambda m: f'data-gap="{mapping.get(int(m.group(1)), int(m.group(1)))}"', html)


def insert_groups(actor, exam_id: str, group_ids) -> dict:
    """Copy whole groups into the draft's section of the same skill, renumbering after the last
    question of that section (gap tokens follow). All-or-nothing."""
    _assert_staff(actor)
    if not isinstance(group_ids, list) or not group_ids or not all(isinstance(g, str) for g in group_ids):
        raise ContractAPIException('VALIDATION_ERROR', 'groupIds must be a non-empty array of ids', 400)
    if len(set(group_ids)) != len(group_ids) or len(group_ids) > MAX_GROUPS:
        raise ContractAPIException('VALIDATION_ERROR', f'groupIds must be unique and at most {MAX_GROUPS}', 400)
    with transaction.atomic():
        exam = locked_exam(exam_id)
        assert_author(actor, exam)
        assert_mutable(exam)
        sources = {g.id: g for g in _reusable(actor).filter(id__in=group_ids)}
        missing = [gid for gid in group_ids if gid not in sources]
        if missing:
            # Not found and not permitted look the same: no existence oracle for others' content.
            raise ContractAPIException('MOCK_GROUP_NOT_FOUND', 'Savollar guruhi topilmadi yoki undan foydalanish huquqi yo‘q', 404)
        stamp, created = timezone.now(), []
        for gid in group_ids:
            src = sources[gid]
            if _family(src.section.exam.type) != _family(exam.type):
                raise ContractAPIException('MOCK_BANK_TYPE_MISMATCH', 'IELTS va Multilevel savollarini aralashtirib bo‘lmaydi', 409)
            skill = src.section.skill
            section = MockSection.objects.filter(exam_id=exam.id, skill=skill).first()
            if section is None:
                section = MockSection.objects.create(id=new_id(), exam_id=exam.id, skill=skill, title=src.section.title or skill.title(),
                    sort_order=SKILLS.index(skill), duration_minutes=src.section.duration_minutes, instructions=None)
            src_questions = list(MockQuestion.objects.filter(group_id=src.id).order_by('sort_order', 'number'))
            start = (MockQuestion.objects.filter(group__section_id=section.id).aggregate(m=Max('number'))['m'] or 0) + 1
            if start + len(src_questions) - 1 > 200:
                raise ContractAPIException('COUNT_LIMIT', 'Bo‘limda 200 tadan ortiq savol bo‘lib qoladi', 409)
            mapping = {q.number: start + i for i, q in enumerate(src_questions)}
            part = None
            if skill == 'listening':
                used = set(MockQuestionGroup.objects.filter(section_id=section.id).values_list('part_number', flat=True))
                part = src.part_number if src.part_number not in used else None
            order = (MockQuestionGroup.objects.filter(section_id=section.id).aggregate(m=Max('sort_order'))['m'] or -1) + 1
            copy = MockQuestionGroup.objects.create(
                id=new_id(), section_id=section.id, sort_order=order, title=src.title, instructions=src.instructions,
                passage_text=src.passage_text, content_html=_renumber_html(src.content_html, mapping),
                audio_script=src.audio_script, content_layout=src.content_layout, options_reusable=src.options_reusable,
                audio_key=src.audio_key, image_key=src.image_key, max_score=src.max_score, stimulus_ref=src.stimulus_ref,
                part_number=part, audio_play_limit=src.audio_play_limit, audio_duration_sec=src.audio_duration_sec, created_at=stamp)
            # One INSERT per question (as the importer does): MockQuestion.type is a PostgreSQL enum in the
            # Prisma schema, and bulk_create's typed UNNEST arrays cannot be cast to it.
            for q in src_questions:
                MockQuestion.objects.create(
                    id=new_id(), group_id=copy.id, number=mapping[q.number], sort_order=q.sort_order, type=q.type, prompt=q.prompt,
                    options=q.options, correct_answers=q.correct_answers, accepted_variants=q.accepted_variants, points=q.points,
                    word_limit=q.word_limit, answer_rule=q.answer_rule, cefr_level=q.cefr_level, skill_tags=q.skill_tags,
                    evidence_text=q.evidence_text, evidence_offset=q.evidence_offset, audio_start_sec=q.audio_start_sec, review_explanation=getattr(q, "review_explanation", None),
                    created_at=stamp)
            created.append(dict(sourceGroupId=src.id, groupId=copy.id, skill=skill, numbers=[mapping[q.number] for q in src_questions],
                                partNumber=part, partNumberDropped=skill == 'listening' and src.part_number is not None and part is None))
        bump(exam)
        with connection.cursor() as cursor:
            audit(cursor, actor.id, 'mock.exam.bank.insert', 'mockExam', exam.id, new=dict(groups=created))
    return dict(examId=exam.id, inserted=created, version=exam.content_version)
