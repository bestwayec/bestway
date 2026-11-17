"""IELTS -> CEFR mapping, the group-export level, raw marks below the published band range,
an unanswered section, the Multilevel AI prompt and the band-table comparison command."""
import re
from io import StringIO
from unittest.mock import patch

import pytest

from apps.core import assessment_prompts, assessment_quality
from apps.core import mock_scoring as score
from apps.core.group_exam_export import (
    CEFR_REPORT_LEVELS,
    cefr_display,
    cefr_distribution_text,
    compute_cefr_level,
)
from apps.core.management.commands import check_band_tables
from apps.core.system_settings import BAND_DEFAULTS

# ---- IELTS band -> CEFR (ielts.org: C2 8.5-9.0, C1 7.0-8.0, B2 5.5-6.5, B1 4.0-5.0) -------------

@pytest.mark.parametrize('band,level', [
    (9.0, 'C2'), (8.5, 'C2'), (8.0, 'C1'), (7.5, 'C1'), (7.0, 'C1'),
    (6.5, 'B2'), (6.0, 'B2'), (5.5, 'B2'),
    (5.0, 'B1'), (4.5, 'B1'), (4.0, 'B1'),
    (3.5, 'BELOW_B1'), (3.0, 'BELOW_B1'), (0, 'BELOW_B1'),
    (8.49, 'C1'), (6.99, 'B2'), (5.49, 'B1'), (3.99, 'BELOW_B1'),
])
def test_ielts_band_to_cefr_follows_ielts_org(band, level):
    assert score.cefr_band(band) == level


def ielts_listening_result(correct, answered_questions=40):
    sections = [dict(skill='listening', groups=[dict(questions=[
        dict(id=f'q{i}', type='short_answer', points=1, correctAnswers=['yes']) for i in range(answered_questions)])])]
    answers = {f'q{i}': dict(response='yes' if i < correct else 'no') for i in range(answered_questions)}
    return score.calculate('ielts_academic', sections, answers, full_test=False)[0]


def test_overall_band_to_cefr_through_calculate():
    # 36/40 Listening = band 8.0 -> C1; 37/40 = 8.5 -> C2.
    assert ielts_listening_result(36)['cefrLevel'] == 'C1'
    assert ielts_listening_result(37)['cefrLevel'] == 'C2'
    assert ielts_listening_result(23)['cefrLevel'] == 'B2'    # 6.0
    assert ielts_listening_result(13)['cefrLevel'] == 'B1'    # 4.5
    assert ielts_listening_result(5)['cefrLevel'] == 'BELOW_B1'    # below 4.0 -> 3.5


# ---- group export: level from the exam's own type ------------------------------------------

@pytest.mark.parametrize('value,level', [
    (75, 'C1'), (65, 'C1'), (64, 'B2'), (51, 'B2'), (50, 'B1'), (38, 'B1'), (37, 'BELOW_B1'), (0, 'BELOW_B1'),
    # 7.5 out of 75 is a Multilevel score, not an IELTS band: it is far below B1.
    (7.5, 'BELOW_B1'), (8.9, 'BELOW_B1'), (9, 'BELOW_B1'),
])
def test_multilevel_level_uses_the_main_scale(value, level):
    assert compute_cefr_level(value, 'multilevel') == level


@pytest.mark.parametrize('exam_type', ['ielts_academic', 'ielts_general'])
@pytest.mark.parametrize('value,level', [(9, 'C2'), (8.5, 'C2'), (7.5, 'C1'), (6.5, 'B2'), (4.0, 'B1'), (3.5, 'BELOW_B1')])
def test_ielts_level_uses_the_ielts_scale(exam_type, value, level):
    assert compute_cefr_level(value, exam_type) == level


def test_scale_is_never_guessed_from_the_value():
    assert compute_cefr_level(62, 'ielts_academic') == '-'     # 62 is not a band
    assert compute_cefr_level(10, 'ielts_general') == '-'
    assert compute_cefr_level(76, 'multilevel') == '-'
    assert compute_cefr_level(-1, 'multilevel') == '-'
    assert compute_cefr_level(50, None) == '-'
    assert compute_cefr_level(50, 'unknown') == '-'
    assert compute_cefr_level('abc', 'multilevel') == '-'


def test_stored_level_wins_and_no_score_is_a_dash():
    assert compute_cefr_level(None, 'multilevel') == '-'
    assert compute_cefr_level(None, 'multilevel', existing_cefr='b2') == 'B2'
    assert compute_cefr_level(70, 'multilevel', existing_cefr=' below_b1 ') == 'BELOW_B1'


def test_group_report_text_writes_below_b1_out():
    assert cefr_display('BELOW_B1') == 'B1 dan quyi' and cefr_display('BELOW_B1', short=True) == '<B1'
    assert cefr_display('C1') == 'C1'
    counts = {level: 0 for level in (*CEFR_REPORT_LEVELS, 'A2', 'A1')}
    counts.update(C1=2, BELOW_B1=1)
    text = cefr_distribution_text(counts)
    assert text == 'C1: 2 ta   |   B2: 0 ta   |   B1: 0 ta   |   B1 dan quyi: 1 ta'     # C2 / legacy levels only when present
    counts.update(C2=1, A2=3)
    assert cefr_distribution_text(counts).startswith('C2: 1 ta   |   C1: 2 ta')
    assert cefr_distribution_text(counts).endswith('A2: 3 ta')


# ---- raw marks below the published range ------------------------------------------------------

FLOORS = [('listening', 'ielts_academic', 'listening', 11), ('listening', 'ielts_general', 'listening', 11),
          ('reading', 'ielts_academic', 'readingAcademic', 10), ('reading', 'ielts_general', 'readingGeneral', 15)]


@pytest.mark.parametrize('skill,exam_type,key,floor', FLOORS)
def test_the_floor_is_the_band_four_row_of_the_table(skill, exam_type, key, floor):
    assert score.OFFICIAL_BAND_FLOOR[key] == floor
    row = next(minimum for minimum, band in BAND_DEFAULTS[key] if band == 4)
    assert row == floor


@pytest.mark.parametrize('skill,exam_type,key,floor', FLOORS)
def test_marks_under_the_floor_are_below_4_and_count_as_3_5(skill, exam_type, key, floor):
    for raw in (0, 1, floor - 1):
        assert score.below_official_range(skill, exam_type, raw, 40) is True
        assert score.band_from_raw(skill, exam_type, raw, 40) == 3.5
    assert score.below_official_range(skill, exam_type, floor, 40) is False
    assert score.band_from_raw(skill, exam_type, floor, 40) == 4


@pytest.mark.parametrize('skill,exam_type,key,floor', FLOORS)
def test_nothing_answered_is_band_zero_not_below_4(skill, exam_type, key, floor):
    assert score.band_from_raw(skill, exam_type, 0, 40, attempted=False) == 0
    assert score.below_official_range(skill, exam_type, 0, 40, attempted=False) is False


def test_an_edited_table_cannot_give_a_band_below_the_floor():
    custom = {'listening': [(0, 9)]}      # an admin table that would give everyone a 9.0
    assert score.band_from_raw('listening', 'ielts_academic', 10, 40, custom) == 3.5
    assert score.band_from_raw('listening', 'ielts_academic', 11, 40, custom) == 9


def test_calculate_gives_3_5_in_the_overall_and_flags_it():
    result = ielts_listening_result(10)           # one under the Listening floor
    assert result['sectionBands']['listening'] == 3.5
    assert result['overallBand'] == 3.5
    assert score.band_is_below_range('ielts_academic', 'listening', 3.5, result['rawScores']['listening']) is True
    ok = ielts_listening_result(11)
    assert ok['sectionBands']['listening'] == 4 and ok['overallBand'] == 4
    assert score.band_is_below_range('ielts_academic', 'listening', 4, ok['rawScores']['listening']) is False


def test_a_real_3_5_above_the_floor_is_not_flagged():
    assert score.band_is_below_range('ielts_academic', 'listening', 3.5, dict(score=20, max=40)) is False
    assert score.band_is_below_range('multilevel', 'listening', 3.5, dict(score=1, max=40)) is False
    assert score.band_is_below_range('ielts_academic', 'writing', 3.5, dict(score=1, max=40)) is False
    assert score.band_is_below_range('ielts_academic', 'listening', 3.5, None) is False


def test_below_range_listening_pulls_the_overall_average_down_with_3_5():
    bands = [3.5, 7.0, 7.0, 7.0]
    assert score.ielts_overall_band(bands, full_test=True) == 6.0      # 24.5 / 4 = 6.125 -> 6.0


def test_an_unanswered_full_section_is_band_zero():
    zero = ielts_listening_result(0)
    # 40 questions, none answered: band 0 (not "below 4.0"). The answers below are all wrong, which is 3.5.
    sections = [dict(skill='listening', groups=[dict(questions=[
        dict(id=f'q{i}', type='short_answer', points=1, correctAnswers=['yes']) for i in range(40)])])]
    blank = score.calculate('ielts_academic', sections, {}, full_test=True)[0]
    assert blank['sectionBands']['listening'] == 0
    assert blank['overallBand'] == 0 and blank['cefrLevel'] == 'BELOW_B1'
    assert zero['sectionBands']['listening'] == 3.5      # answered, every answer wrong
    # A short section never gets a band, answered or not.
    short = [dict(skill='listening', groups=[dict(questions=[dict(id='q', type='short_answer', points=1, correctAnswers=['yes'])])])]
    assert score.calculate('ielts_academic', short, {}, full_test=True)[0]['sectionBands']['listening'] is None


# ---- Multilevel AI prompt has no hidden cap ---------------------------------------------------

@pytest.mark.parametrize('skill', ['writing', 'speaking'])
def test_multilevel_prompt_has_no_score_cap_or_secrecy_order(skill):
    prompt = assessment_prompts.legacy_prompt(dict(program='MULTILEVEL', skill=skill, pronunciationEvidence='UNAVAILABLE'))
    for banned in ('55', 'CONFIDENTIALITY', 'must not exceed', 'Explicitly forbid'):
        assert banned not in prompt, banned
    assert not re.search(r'\bcap\b', prompt)
    assert 'whole range is available' in prompt


def test_prompt_version_moved_with_the_prompt():
    assert assessment_quality.PROMPT_VERSION == 'BESTWAY_ASSESSMENT_PROMPT_2026_V3'


# ---- stored band tables vs built-in -----------------------------------------------------------

def rows(table):
    return [list(row) for row in table]


def test_no_stored_table_is_reported_as_default():
    assert check_band_tables.compare_table('listening', None)['status'] == 'DEFAULT'


def test_an_identical_stored_table_is_the_same():
    report = check_band_tables.compare_table('readingAcademic', rows(BAND_DEFAULTS['readingAcademic']))
    assert report['status'] == 'SAME_AS_DEFAULT' and report['differences'] == [] and report['usable'] is True


def test_differences_are_listed_per_raw_mark_with_the_floor_flagged():
    # Listening: raw 11 and 12 get 4.5 (built-in 4.0); raw 6-10 get 3.0 (built-in 3.5, below the floor).
    edited = [[11, 4.5] if (m, b) == (11, 4) else [6, 3] if (m, b) == (6, 3.5) else [m, b] for m, b in BAND_DEFAULTS['listening']]
    report = check_band_tables.compare_table('listening', edited)
    assert report['status'] == 'DIFFERENT'
    by_raw = {d['raw']: d for d in report['differences']}
    assert by_raw[11] == dict(raw=11, stored=4.5, builtIn=4, belowOfficialFloor=False)
    assert by_raw[12]['stored'] == 4.5 and by_raw[12]['builtIn'] == 4
    assert set(by_raw) == {6, 7, 8, 9, 10, 11, 12}
    assert by_raw[8]['belowOfficialFloor'] is True and by_raw[8]['stored'] == 3
    assert 32 not in by_raw                                                              # unchanged mark


def test_a_stored_table_the_app_rejects_is_reported_as_ignored():
    for bad in ('nope', [], [[10, 4]], [[0, 12]], [[0, 4.25]]):
        report = check_band_tables.compare_table('readingGeneral', bad)
        assert report['status'] == 'INVALID_IGNORED' and report['usable'] is False and report['error']


def test_command_is_read_only_and_prints_both_formats():
    stored = {'ieltsBandListening': rows(BAND_DEFAULTS['listening']), 'ieltsBandReadingAcademic': 'broken'}

    class Row:
        def __init__(self, key, value):
            self.key, self.value = key, value

    with patch.object(check_band_tables.Setting.objects, 'filter', return_value=[Row(k, v) for k, v in stored.items()]) as query:
        from django.core.management import call_command
        text, as_json = StringIO(), StringIO()
        call_command('check_band_tables', stdout=text)
        call_command('check_band_tables', json=True, stdout=as_json)
    assert query.call_count == 2
    assert 'listening (ieltsBandListening): SAME_AS_DEFAULT' in text.getvalue()
    assert 'readingAcademic (ieltsBandReadingAcademic): INVALID_IGNORED' in text.getvalue()
    assert 'readingGeneral (ieltsBandReadingGeneral): DEFAULT' in text.getvalue()
    assert '"status": "INVALID_IGNORED"' in as_json.getvalue()
