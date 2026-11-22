"""Content-agnostic structural checks for the objective Listening / Reading packages.

These run in addition to ``mock_import_validate.validate_package`` and never look at
specific wording: they verify counts, numbering, keys and answer evidence only.
"""
from __future__ import annotations

import re

from apps.core.mock_rules import canonical_decision, choice_index, string_array

CHOICE = {'multiple_choice', 'matching'}
DECISION = {'true_false_notgiven', 'yes_no_notgiven'}
TEXT = {'note_completion', 'sentence_completion', 'summary_completion', 'short_answer', 'table_completion'}


def _questions(package):
    for section in package['exam']['sections']:
        for group in section['groups']:
            for question in group['questions']:
                yield section['skill'], group, question


def objective_issues(package: dict, *, expected_questions: int = 40, expected_groups: int | None = None) -> list[str]:
    """Return a list of human-readable problems (empty when the package is sound)."""
    issues: list[str] = []
    rows = list(_questions(package))
    numbers = [q['number'] for _s, _g, q in rows]
    if len(rows) != expected_questions:
        issues.append(f'{len(rows)} questions, expected {expected_questions}')
    if numbers != list(range(1, expected_questions + 1)):
        issues.append(f'question numbers are not 1..{expected_questions} in order')
    if len(set(numbers)) != len(numbers):
        issues.append('duplicate question numbers')
    section = package['exam']['sections'][0]
    if expected_groups is not None and len(section['groups']) != expected_groups:
        issues.append(f'{len(section["groups"])} groups, expected {expected_groups}')
    for skill, group, q in rows:
        n, options = q['number'], string_array(q.get('options'))
        answers = [a for a in string_array(q.get('correctAnswers')) if a.strip()]
        if not answers:
            issues.append(f'Q{n}: missing answer key')
        if q['type'] in CHOICE:
            indexes = {choice_index(a, options) for a in answers}
            if None in indexes or len(indexes) != 1:
                issues.append(f'Q{n}: key {answers} does not resolve to one option')
        if q['type'] in DECISION:
            allowed = {'TRUE', 'FALSE', 'NOT_GIVEN'} if q['type'] == 'true_false_notgiven' else {'YES', 'NO', 'NOT_GIVEN'}
            if any(canonical_decision(a) not in allowed for a in answers):
                issues.append(f'Q{n}: decision key {answers} not allowed')
        if q['type'] in TEXT:
            if options:
                issues.append(f'Q{n}: text question carries options')
            limit = q.get('wordLimit')
            if limit and any(len(re.findall(r"[\w'’-]+", a)) > limit for a in answers + string_array(q.get('acceptedVariants'))):
                issues.append(f'Q{n}: an accepted answer exceeds the word limit {limit}')
        if group.get('contentHtml'):
            gaps = [int(x) for x in re.findall(r'data-gap="(\d+)"', group['contentHtml'])]
            if q['type'] in TEXT and n not in gaps:
                issues.append(f'Q{n}: no gap token in the group document')
    return issues


def evidence_issues(package: dict) -> list[str]:
    """Reading only: every completion answer (or accepted variant) occurs in its passage."""
    issues = []
    for section in package['exam']['sections']:
        if section['skill'] != 'reading':
            continue
        for group in section['groups']:
            passage = re.sub(r'\s+', ' ', (group.get('passageText') or '').lower().replace('-', ' '))
            for q in group['questions']:
                if q['type'] not in TEXT:
                    continue
                forms = [a for a in q['correctAnswers'] + q.get('acceptedVariants', [])]
                if not any(re.sub(r'\s+', ' ', f.lower().replace('-', ' ')) in passage for f in forms):
                    issues.append(f'Q{q["number"]}: answer {q["correctAnswers"]} not found in its passage')
    return issues


def summary(package: dict) -> dict:
    rows = list(_questions(package))
    types: dict[str, int] = {}
    for _s, _g, q in rows:
        types[q['type']] = types.get(q['type'], 0) + 1
    return dict(questions=len(rows), groups=sum(len(s['groups']) for s in package['exam']['sections']),
                byType=dict(sorted(types.items())),
                perGroup=[dict(key=g['key'], first=g['questions'][0]['number'], last=g['questions'][-1]['number'],
                               count=len(g['questions'])) for s in package['exam']['sections'] for g in s['groups']])


def script_evidence_issues(package: dict) -> list[str]:
    """Listening with spoken scripts (original content): every completion answer is spoken in its part's script."""
    issues = []
    for section in package['exam']['sections']:
        if section['skill'] != 'listening':
            continue
        for group in section['groups']:
            script = re.sub(r'\s+', ' ', (group.get('audioScript') or '').lower())
            if not script:
                issues.append(f'{group["key"]}: no audio script')
                continue
            for q in group['questions']:
                if q['type'] in TEXT:
                    forms = q['correctAnswers'] + q.get('acceptedVariants', [])
                    if not any(f.lower() in script for f in forms):
                        issues.append(f'Q{q["number"]}: answer {q["correctAnswers"]} is not spoken in its script')
    return issues
