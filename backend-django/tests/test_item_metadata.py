from types import SimpleNamespace

import pytest

from apps.core import item_metadata as meta
from common.api.exceptions import ContractAPIException


@pytest.mark.parametrize('value,expected', [(None, None), ('', None), ('unknown', None), ('b2', 'B2'), ('C1', 'C1'), ('A1', 'A1'), ('C2', 'C2')])
def test_cefr_level_is_cleaned(value, expected):
    assert meta.clean_cefr(value) == expected


@pytest.mark.parametrize('value', ['B3', 'IELTS', 7, ['B1']])
def test_cefr_level_outside_the_scale_is_refused(value):
    with pytest.raises(ContractAPIException):
        meta.clean_cefr(value)


def test_skill_tags_are_lowercase_unique_and_bounded():
    assert meta.clean_tags(['Inference', 'detail', 'inference']) == ['inference', 'detail']
    assert meta.clean_tags([]) is None
    assert meta.clean_tags(None) is None
    for bad in ('detail', ['x'], ['has space'], ['a' * 41], [f't{i}x' for i in range(9)], [3]):
        with pytest.raises(ContractAPIException):
            meta.clean_tags(bad)


def test_describe_reports_structure_and_unknown_never_a_guess():
    exam = SimpleNamespace(id='e1', type='multilevel')
    section = SimpleNamespace(skill='reading', exam=exam)
    group = SimpleNamespace(part_number=3, section=section)
    question = SimpleNamespace(type='matching_headings', cefr_level=None, skill_tags=None, group=group)
    assert meta.describe(question) == {'examId': 'e1', 'examType': 'multilevel', 'section': 'reading', 'part': 3,
                                       'type': 'matching_headings', 'cefrLevel': 'unknown', 'skillTags': []}
    group.part_number = None
    question.cefr_level, question.skill_tags = 'B2', ['main-idea']
    assert meta.describe(question)['part'] == 'unknown'
    assert meta.describe(question)['cefrLevel'] == 'B2'
