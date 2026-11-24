from copy import deepcopy

from apps.core.mock_content import exam_content_units
from apps.core.mock_import_validate import validate_package
from tests.mock27_fixtures import listening_package, reading_package


def test_explicit_reading_continuation_and_identical_distinct_sources():
    first = dict(id='first', stimulusRef='first', passageText='Repeated text')
    second = dict(id='second', stimulusRef='second', passageText='Repeated text')
    gaps = dict(id='gaps', stimulusRef='first', passageText='')
    assert exam_content_units([gaps, second, first], 'reading') == [[gaps, first], [second]]


def test_reading_blueprint_counts_units_and_scoring_positions():
    package = reading_package()
    groups = package['exam']['sections'][0]['groups']
    for index, group in enumerate(groups):
        group['stimulusRef'] = f'passage-{index}'
    continuation = {**groups[0], 'key': 'continuation', 'passageText': '', 'questions': groups[0]['questions'][5:]}
    groups[0]['questions'] = groups[0]['questions'][:5]
    groups.insert(1, continuation)
    assert not [issue for issue in validate_package(package)['issues'] if issue['code'] == 'PASSAGE_SOURCE'
                or (issue['code'] == 'PROFILE_BLUEPRINT' and 'reading' in issue['message'])]
    del continuation['stimulusRef']
    assert 'PASSAGE_SOURCE' in {issue['code'] for issue in validate_package(package)['issues']}


def test_listening_part_uses_one_audio_owner():
    package = listening_package()
    groups = package['exam']['sections'][0]['groups']
    continuation = deepcopy(groups[0])
    continuation.update(key='continuation', questions=groups[0]['questions'][5:])
    groups[0]['questions'] = groups[0]['questions'][:5]
    del continuation['audioRef']
    groups.insert(1, continuation)
    assert not [issue for issue in validate_package(package)['issues'] if issue['code'] == 'PART_AUDIO'
                or (issue['code'] == 'PROFILE_BLUEPRINT' and 'listening' in issue['message'])]
    del groups[0]['audioRef']
    assert 'PART_AUDIO' in {issue['code'] for issue in validate_package(package)['issues']}
