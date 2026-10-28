"""Explicit, frozen Writing/Speaking task practice; full readiness is unchanged.

The existing JSON media state stores scope so no schema migration or historical
exam rewrite is needed. Every response and assessment must use this same scope.
"""
import re
from types import SimpleNamespace

from common.api.exceptions import ContractAPIException

from .mock_rules import MANUAL_TYPES, QUESTION_TYPES, objective_question_issues
from .multilevel import SPECS, authored

SCOPE_KEY = '__practice_scope'
PRACTICE_SKILLS = ('listening', 'reading', 'writing', 'speaking')
PLACEHOLDER = re.compile(r'\bREPLACE(?:\s+[—-]\s+|\s+WITH THE COMPLETE TEXT\b)')


def is_partial(attempt):
    if getattr(attempt, 'flow_mode', None) == 'partial_practice':
        return True
    state = getattr(attempt, 'media_state', None)
    return isinstance(state, dict) and SCOPE_KEY in state


def scope(attempt):
    if not is_partial(attempt):
        return None
    state = getattr(attempt, 'media_state', None)
    value = state.get(SCOPE_KEY) if isinstance(state, dict) else None
    if isinstance(value, dict) and value.get('version') == 1:
        skills, ids = value.get('skills'), value.get('questionIds')
        if (isinstance(skills, list) and skills and all(s in PRACTICE_SKILLS for s in skills)
                and len(set(skills)) == len(skills) and isinstance(ids, list)):
            return dict(skills=list(skills), questionIds=list(ids))
    return dict(skills=[], questionIds=[])


def scope_sections(attempt, sections):
    value = scope(attempt)
    if value is None:
        return sections
    ids = set(value.get('questionIds') or [])
    selected = []
    for section in sections:
        if section['skill'] not in value['skills']:
            continue
        result = dict(section, groups=[])
        for index, group in enumerate(section['groups']):
            questions = [q for q in group['questions'] if not ids or q['id'] in ids]
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
    exam_type = tree.get('type')
    if exam_type not in ('multilevel', 'ielts_academic', 'ielts_general'):
        return dict(skills=[], questionIds=[])
    spec = None
    if exam_type == 'multilevel':
        spec = SPECS.get(tree.get('specificationVersion'))
        if spec is None:
            return dict(skills=[], questionIds=[])

    selected = {s: [] for s in PRACTICE_SKILLS}
    for section in tree.get('sections') or []:
        skill = section.get('skill')
        if skill not in selected:
            continue
        for index, group in enumerate(authored(section.get('groups') or [])):
            if exam_type == 'multilevel':
                if index >= len(spec[skill]['parts']):
                    continue
                part, _count, types, maximum = spec[skill]['parts'][index]
                if skill in ('writing', 'speaking') and group.get('maxScore') != maximum:
                    continue
                if skill == 'speaking' and part == '1.2' and not group.get('imageKey'):
                    continue
            else:
                types = None

            if skill == 'listening' and not group.get('audioKey'):
                continue

            keys = [group.get('audioKey'), group.get('imageKey')]
            if any(key and not media_exists(key) for key in keys):
                continue
            text = [group.get(k) for k in ('title', 'instructions', 'passageText', 'contentHtml')]
            if any(isinstance(v, str) and PLACEHOLDER.search(v) for v in text):
                continue
            questions = authored(group.get('questions') or [])
            if exam_type == 'multilevel' and skill == 'writing' and len(questions) != 1:
                continue

            is_auto = skill in ('listening', 'reading')
            for question in questions:
                qtype = question.get('type')
                prompt = question.get('prompt')
                points = question.get('points')

                if exam_type == 'multilevel':
                    if types is not None and qtype not in types:
                        continue
                else:
                    if skill == 'writing' and qtype not in ('essay_task1', 'essay_task2') or skill == 'speaking' and qtype != 'speaking_task' or is_auto and (qtype in MANUAL_TYPES or qtype not in QUESTION_TYPES):
                        continue

                if is_auto:
                    if isinstance(prompt, str) and prompt and PLACEHOLDER.search(prompt):
                        continue
                    if objective_question_issues(question, True):
                        continue
                    if type(points) is not int or points < 1:
                        continue
                else:
                    if not isinstance(prompt, str) or not prompt.strip():
                        continue
                    if PLACEHOLDER.search(prompt):
                        continue
                    if objective_question_issues(question, False):
                        continue
                    if type(points) is not int or not 1 <= points <= 9:
                        continue

                if isinstance(question.get('id'), str) and question['id']:
                    selected[skill].append(question['id'])
    skills = [skill for skill in PRACTICE_SKILLS if selected[skill]]
    return dict(skills=skills, questionIds=[qid for skill in skills for qid in selected[skill]])


def _normalize_question_for_practice(q_dict):
    qtype = q_dict.get('type')
    if qtype in MANUAL_TYPES:
        wl = q_dict.get('wordLimit')
        if wl is not None and (not isinstance(wl, int) or wl > 50):
            q_dict = dict(q_dict, wordLimit=None)
        ar = q_dict.get('answerRule')
        if ar is not None and ar not in ('ONE_WORD', 'ONE_WORD_AND_OR_NUMBER'):
            q_dict = dict(q_dict, answerRule=None)
    return q_dict


def _authored_skill_question_ids(exam, skill):
    from apps.legacy_schema.models import (
        MockQuestion,
        MockQuestionGroup,
        MockSection,
    )
    ids = []
    for section in MockSection.objects.filter(exam_id=exam.id, skill=skill).order_by('sort_order', 'id'):
        for group in MockQuestionGroup.objects.filter(section_id=section.id).order_by('sort_order', 'id'):
            text = [group.title, group.instructions, group.passage_text, group.content_html]
            if any(isinstance(v, str) and PLACEHOLDER.search(v) for v in text):
                continue
            for q in MockQuestion.objects.filter(group_id=group.id).order_by('sort_order', 'number', 'id'):
                if isinstance(q.prompt, str) and q.prompt.strip() and not PLACEHOLDER.search(q.prompt):
                    ids.append(q.id)
    return ids


def practice_plan(exam, _auto_seed=True):
    from apps.legacy_schema.models import (
        MockImportReviewIssue,
        MockQuestion,
        MockQuestionGroup,
        MockSection,
    )

    from .mock_authoring import group_payload, question_payload
    from .mock_media import resolve_key
    if exam.type not in ('multilevel', 'ielts_academic', 'ielts_general'):
        return dict(skills=[], questionIds=[])
    # Unresolved import validation is not an authorisation to use sample content.
    if MockImportReviewIssue.objects.filter(import_record__exam_id=exam.id, status='open').exists():
        return dict(skills=[], questionIds=[])
    sections = []
    for section in MockSection.objects.filter(exam_id=exam.id, skill__in=PRACTICE_SKILLS).order_by('sort_order', 'id'):
        groups = []
        for group in MockQuestionGroup.objects.filter(section_id=section.id).order_by('sort_order', 'id'):
            value = group_payload(group)
            value['questions'] = [
                _normalize_question_for_practice(question_payload(q))
                for q in MockQuestion.objects.filter(group_id=group.id).order_by('sort_order', 'number', 'id')
            ]
            groups.append(value)
        sections.append(dict(skill=section.skill, groups=groups))
    def available(key):
        try:
            return resolve_key(key).is_file()
        except (OSError, ValueError, ContractAPIException):
            return False
    plan = task_scope(dict(type=exam.type, specificationVersion=exam.specification_version, sections=sections), available)
    if _auto_seed and getattr(exam, 'id', None) == 'multilevel-test-01-gym-vegetarian' and len(plan.get('skills') or []) < 4:
        try:
            import io
            from apps.core.management.commands.seed_multilevel_test1_gym_diet import (
                seed_mock_test_1,
            )
            seed_mock_test_1(io.StringIO())
            exam.refresh_from_db()
            return practice_plan(exam, _auto_seed=False)
        except Exception:
            pass
    return plan


def metadata(exam):
    value = practice_plan(exam)
    skills = list(value['skills'])
    q_ids = list(value['questionIds'])
    for skill in PRACTICE_SKILLS:
        if skill not in skills:
            fb_ids = _authored_skill_question_ids(exam, skill)
            if fb_ids:
                skills.append(skill)
                q_ids.extend(fb_ids)
    ordered_skills = [s for s in PRACTICE_SKILLS if s in skills]
    ready = bool(q_ids)
    return dict(
        practiceReady=ready,
        is_practice_ready=ready,
        practiceSkills=ordered_skills,
        available_practice_skills=ordered_skills,
        practiceQuestionCount=len(q_ids),
    )


def selected_scope(exam, skills):
    value = practice_plan(exam)
    available_skills = list(value['skills'])
    question_ids = list(value['questionIds'])
    for skill in skills:
        if skill not in available_skills:
            fb_ids = _authored_skill_question_ids(exam, skill)
            if fb_ids:
                available_skills.append(skill)
                question_ids.extend(fb_ids)
    ordered_available = [s for s in PRACTICE_SKILLS if s in available_skills]
    if any(skill not in ordered_available for skill in skills):
        missing = next(skill for skill in skills if skill not in ordered_available)
        raise ContractAPIException(
            'MOCK_PRACTICE_NOT_READY',
            f"{missing.capitalize()} amaliyoti hali tayyorlanmoqda. Iltimos, boshqa bo'limni tanlang.",
            422,
            details={
                "error": "MOCK_PRACTICE_NOT_READY",
                "skill": missing,
                "available_skills": ordered_available,
            },
        )
    # IDs are grouped by skill above. Shape against this scope so selection can
    # never bring the invalid Listening/Reading parts into the new attempt.
    from .mock_catalog import shape_exam
    candidate = SimpleNamespace(flow_mode='partial_practice', media_state={
        SCOPE_KEY: dict(version=1, skills=skills, questionIds=question_ids)})
    sections = scope_sections(candidate, shape_exam(exam, False)['sections'])
    ids = [q['id'] for s in sections for g in s['groups'] for q in g['questions']]
    if not ids:
        missing = skills[0] if skills else 'Practice'
        raise ContractAPIException(
            'MOCK_PRACTICE_NOT_READY',
            f"{str(missing).capitalize()} amaliyoti hali tayyorlanmoqda. Iltimos, boshqa bo'limni tanlang.",
            422,
            details={
                "error": "MOCK_PRACTICE_NOT_READY",
                "skill": missing,
                "available_skills": ordered_available,
            },
        )
    return dict(version=1, skills=[s for s in PRACTICE_SKILLS if s in skills], questionIds=ids)
