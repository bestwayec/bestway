"""Explicit, frozen Writing/Speaking task practice; full readiness is unchanged.

The existing JSON media state stores scope so no schema migration or historical
exam rewrite is needed. Every response and assessment must use this same scope.
"""
import re
from types import SimpleNamespace

from .multilevel import SPECS, authored
from .mock_rules import objective_question_issues
from common.api.exceptions import ContractAPIException

SCOPE_KEY = '__practice_scope'
PRACTICE_SKILLS = ('writing', 'speaking')
PLACEHOLDER = re.compile(r'\bREPLACE(?:\s+[—-]\s+|\s+WITH THE COMPLETE TEXT\b)')


def is_partial(attempt):
    return getattr(attempt, 'flow_mode', None) == 'partial_practice'


def scope(attempt):
    if not is_partial(attempt):
        return None
    state = getattr(attempt, 'media_state', None)
    value = state.get(SCOPE_KEY) if isinstance(state, dict) else None
    # Damaged scope fails closed; it must never fall back to the whole exam.
    if not isinstance(value, dict) or value.get('version') != 1:
        return dict(skills=[], questionIds=[])
    skills, ids = value.get('skills'), value.get('questionIds')
    if (not isinstance(skills, list) or not skills or any(s not in PRACTICE_SKILLS for s in skills)
            or len(set(skills)) != len(skills) or not isinstance(ids, list) or not ids
            or any(not isinstance(q, str) or not q for q in ids) or len(set(ids)) != len(ids)):
        return dict(skills=[], questionIds=[])
    return dict(skills=list(skills), questionIds=list(ids))


def scope_sections(attempt, sections):
    value = scope(attempt)
    if value is None:
        return sections
    ids = set(value['questionIds'])
    selected = []
    for section in sections:
        if section['skill'] not in value['skills']:
            continue
        result = dict(section, groups=[])
        for index, group in enumerate(section['groups']):
            questions = [q for q in group['questions'] if q['id'] in ids]
            if questions:
                result['groups'].append(dict(group, questions=questions,
                                             sourcePartIndex=group.get('sourcePartIndex', index)))
        if result['groups']:
            selected.append(result)
    return selected


def task_scope(tree, media_exists):
    """Identify real authored tasks without certifying the whole blueprint.

    An invalid or empty part is omitted rather than converted into fake content.
    Referenced media and the required picture part must still be available.
    """
    spec = SPECS.get(tree.get('specificationVersion'))
    if tree.get('type') != 'multilevel' or spec is None:
        return dict(skills=[], questionIds=[])
    selected = {s: [] for s in PRACTICE_SKILLS}
    for section in tree.get('sections') or []:
        skill = section.get('skill')
        if skill not in selected:
            continue
        for index, group in enumerate(authored(section.get('groups') or [])):
            if index >= len(spec[skill]['parts']):
                continue
            part, _count, types, maximum = spec[skill]['parts'][index]
            if group.get('maxScore') != maximum:
                continue
            if skill == 'speaking' and part == '1.2' and not group.get('imageKey'):
                continue
            keys = [group.get('audioKey'), group.get('imageKey')]
            if any(key and not media_exists(key) for key in keys):
                continue
            text = [group.get(k) for k in ('title', 'instructions', 'passageText', 'contentHtml')]
            if any(isinstance(v, str) and PLACEHOLDER.search(v) for v in text):
                continue
            questions = authored(group.get('questions') or [])
            if skill == 'writing' and len(questions) != 1:
                continue
            for question in questions:
                prompt = question.get('prompt')
                if (question.get('type') not in types or not isinstance(prompt, str) or not prompt.strip()
                        or PLACEHOLDER.search(prompt) or objective_question_issues(question, False)
                        or type(question.get('points')) is not int or not 1 <= question['points'] <= 9):
                    continue
                if isinstance(question.get('id'), str) and question['id']:
                    selected[skill].append(question['id'])
    skills = [skill for skill in PRACTICE_SKILLS if selected[skill]]
    return dict(skills=skills, questionIds=[qid for skill in skills for qid in selected[skill]])


def practice_plan(exam):
    from apps.legacy_schema.models import MockQuestion, MockQuestionGroup, MockSection, MockImportReviewIssue
    from .mock_authoring import group_payload, question_payload
    from .mock_media import resolve_key
    if exam.type != 'multilevel':
        return dict(skills=[], questionIds=[])
    # Unresolved import validation is not an authorisation to use sample content.
    if MockImportReviewIssue.objects.filter(import_record__exam_id=exam.id, status='open').exists():
        return dict(skills=[], questionIds=[])
    sections = []
    for section in MockSection.objects.filter(exam_id=exam.id, skill__in=PRACTICE_SKILLS).order_by('sort_order', 'id'):
        groups = []
        for group in MockQuestionGroup.objects.filter(section_id=section.id).order_by('sort_order', 'id'):
            value = group_payload(group)
            value['questions'] = [question_payload(q) for q in MockQuestion.objects.filter(group_id=group.id).order_by('sort_order', 'number', 'id')]
            groups.append(value)
        sections.append(dict(skill=section.skill, groups=groups))
    def available(key):
        try:
            return resolve_key(key).is_file()
        except (OSError, ValueError, ContractAPIException):
            return False
    return task_scope(dict(type=exam.type, specificationVersion=exam.specification_version, sections=sections), available)


def metadata(exam):
    value = practice_plan(exam)
    return dict(practiceReady=bool(value['questionIds']), practiceSkills=value['skills'],
                practiceQuestionCount=len(value['questionIds']))


def selected_scope(exam, skills):
    value = practice_plan(exam)
    if any(skill not in value['skills'] for skill in skills):
        raise ContractAPIException('MOCK_PRACTICE_NOT_READY', 'The selected practice skill has no valid authored tasks', 400)
    # IDs are grouped by skill above. Shape against this scope so selection can
    # never bring the invalid Listening/Reading parts into the new attempt.
    from .mock_catalog import shape_exam
    candidate = SimpleNamespace(flow_mode='partial_practice', media_state={
        SCOPE_KEY: dict(version=1, skills=skills, questionIds=value['questionIds'])})
    sections = scope_sections(candidate, shape_exam(exam, False)['sections'])
    ids = [q['id'] for s in sections for g in s['groups'] for q in g['questions']]
    if not ids:
        raise ContractAPIException('MOCK_PRACTICE_NOT_READY', 'No valid authored practice tasks are available', 400)
    return dict(version=1, skills=[s for s in PRACTICE_SKILLS if s in skills], questionIds=ids)
