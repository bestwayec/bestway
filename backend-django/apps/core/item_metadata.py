"""Item bank metadata of a question.

Exam, section, part and question type come from the question's own rows (group -> section ->
exam), so they cannot drift. Two fields are stored on the question (additive, nullable columns):
the CEFR level the item targets and its skill tags. A value that is not known is reported as
``unknown`` (scalars) or an empty list (tags); nothing is guessed.
"""
from __future__ import annotations

import re

from common.api.exceptions import ContractAPIException

UNKNOWN = 'unknown'
CEFR_LEVELS = ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')
MAX_TAGS = 8
_TAG = re.compile(r'^[a-z][a-z0-9_-]{1,39}$')


def clean_cefr(value):
    if value is None or value == '' or value == UNKNOWN:
        return None
    if not isinstance(value, str) or value.upper() not in CEFR_LEVELS:
        raise ContractAPIException('VALIDATION_ERROR', f'cefrLevel must be one of {", ".join(CEFR_LEVELS)} or unknown', 400)
    return value.upper()


def clean_tags(value):
    if value is None:
        return None
    if not isinstance(value, list) or len(value) > MAX_TAGS or not all(isinstance(tag, str) and _TAG.match(tag.strip().lower()) for tag in value):
        raise ContractAPIException('VALIDATION_ERROR', f'skillTags must be up to {MAX_TAGS} short lowercase tags (letters, digits, - or _)', 400)
    tags = []
    for tag in value:
        tag = tag.strip().lower()
        if tag not in tags:
            tags.append(tag)
    return tags or None


def describe(question, group=None, section=None, exam=None) -> dict:
    """Metadata of one question; pass the related rows when they are already loaded."""
    group = group or question.group
    section = section or group.section
    exam = exam or section.exam
    part = group.part_number if getattr(group, 'part_number', None) is not None else None
    return {
        'examId': exam.id,
        'examType': exam.type or UNKNOWN,
        'section': section.skill or UNKNOWN,
        'part': part if part is not None else UNKNOWN,
        'type': question.type or UNKNOWN,
        'cefrLevel': question.cefr_level or UNKNOWN,
        'skillTags': list(question.skill_tags or []),
    }


FILTERS = ('examType', 'section', 'cefrLevel', 'type', 'tag')


def list_items(query) -> dict:
    """Staff read of the item bank with its metadata (never answers or keys), filtered."""
    from apps.legacy_schema.models import MockQuestion
    rows = MockQuestion.objects.select_related('group__section__exam').order_by('group__section__exam_id', 'group__section__sort_order', 'group__sort_order', 'sort_order')
    if query.get('examType'): rows = rows.filter(group__section__exam__type=query['examType'])
    if query.get('section'): rows = rows.filter(group__section__skill=query['section'])
    if query.get('type'): rows = rows.filter(type=query['type'])
    level = query.get('cefrLevel')
    if level == UNKNOWN: rows = rows.filter(cefr_level__isnull=True)
    elif level: rows = rows.filter(cefr_level=clean_cefr(level))
    try:
        limit = min(500, max(1, int(query.get('limit', 200))))
    except (TypeError, ValueError):
        raise ContractAPIException('VALIDATION_ERROR', 'limit must be a number', 400)
    tag = (query.get('tag') or '').strip().lower()
    items = []
    for question in rows.iterator():
        if tag and tag not in (question.skill_tags or []):
            continue
        items.append(dict(id=question.id, number=question.number, **describe(question)))
        if len(items) >= limit:
            break
    return {'items': items, 'count': len(items), 'unknownMeansNotSet': True}
