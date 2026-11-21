"""Synthetic structural fixtures for Mock 27 tests. Contain NO supplied or third-party content."""
from __future__ import annotations

import json
from pathlib import Path


def _q(number, qtype, prompt, options=None, answers=None, **extra):
    return dict(key=f'q{number}', number=number, type=qtype, prompt=prompt, options=options or [],
                correctAnswers=answers or [], acceptedVariants=extra.pop('variants', []), points=1,
                sourceRef='synthetic fixture', **extra)


def listening_package() -> dict:
    groups = []
    for part in range(1, 5):
        lo = (part - 1) * 10 + 1
        qs = [_q(n, 'multiple_choice', f'Fixture listening question {n}', ['one', 'two', 'three'], ['B']) for n in range(lo, lo + 10)]
        groups.append(dict(key=f'l{part}', title=f'Listening Part {part}', instructions='Fixture', passageText='', contentHtml='',
                           contentLayout='document', audioScript='', partNumber=part, audioPlayLimit=1, audioRef=f'part{part}_audio', questions=qs))
    media = [dict(key=f'part{n}_audio', kind='audio', fileName=f'part-{n}.mp3', requiredForPublish=True, description='fixture') for n in range(1, 5)]
    return _pkg('bw-mock27-listening', 'listening', 'Listening', 30, groups, media)


def reading_package() -> dict:
    groups, number = [], 1
    for idx, size in enumerate((13, 13, 14), 1):
        qs = []
        for n in range(number, number + size):
            qs.append(_q(n, 'sentence_completion', f'Fixture sentence with ______ ({n})', answers=['alpha'], wordLimit=1, answerRule='ONE_WORD'))
        number += size
        groups.append(dict(key=f'r{idx}', title=f'Fixture passage {idx}', instructions='Fixture', passageText='alpha beta gamma. ' * 20,
                           contentHtml='', contentLayout='document', audioScript='', questions=qs))
    return _pkg('bw-mock27-reading', 'reading', 'Reading', 60, groups, [])


def _pkg(package_id, skill, title, minutes, groups, media):
    return dict(schemaVersion='1.0', packageId=package_id, revision=1, profile='full_mock',
                source=dict(kind='provided_material', label='synthetic fixture', notes='test only'),
                exam=dict(type='ielts_academic', title='Fixture', description='fixture', level='IELTS Academic', isDemo=False, price=0,
                          isFreeForApproved=True, sections=[dict(key=skill, skill=skill, title=title, instructions='Fixture',
                                                                 durationMinutes=minutes, groups=groups)]),
                media=media, reviewIssues=[])


def write_source_dir(directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'listening.package.json').write_text(json.dumps(listening_package()))
    (directory / 'reading.package.json').write_text(json.dumps(reading_package()))
    return directory
