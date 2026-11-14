"""Table-driven boundary tests for the one scoring module (apps.core.mock_scoring).

The expected values come from the published sources named in docs/agent/EXAM_PROGRAM.md:
ielts.org "IELTS scoring in detail" and the agency's Multilevel criteria. BestWay's
conversion tables themselves are not changed here; rows the sources do not publish are
only checked for shape (monotonic, half-band steps).
"""
import pytest

from apps.core import mock_scoring as score

# ielts.org worked examples and rounding rule.
OVERALL_BAND_CASES = [
    ([6.5, 6.5, 5.0, 7.0], 6.5),   # average 6.25  -> 6.5 (test taker A)
    ([4.0, 3.5, 4.0, 4.0], 4.0),   # average 3.875 -> 4.0 (test taker B)
    ([6.5, 6.5, 5.5, 6.0], 6.0),   # average 6.125 -> 6.0 (test taker C)
    ([7.0, 7.0, 6.5, 6.5], 7.0),   # average 6.75  -> 7.0
    ([6.0, 6.0, 6.0, 6.5], 6.0),   # average 6.125 -> 6.0
    ([6.0, 6.5, 6.5, 6.5], 6.5),   # average 6.375 -> 6.5
    ([9.0, 9.0, 9.0, 9.0], 9.0),
    ([0, 0, 0, 0], 0),
]


@pytest.mark.parametrize("bands,expected", OVERALL_BAND_CASES)
def test_ielts_overall_band_rounding(bands, expected):
    assert score.ielts_overall_band(bands, full_test=True) == expected
    assert score.ielts_overall_band(bands) == expected


@pytest.mark.parametrize("value,expected", [(6.25, 6.5), (6.75, 7.0), (6.24, 6.0), (6.74, 6.5), (6.125, 6.0), (3.875, 4.0), (8.75, 9.0)])
def test_round_half_boundaries(value, expected):
    assert score.round_half(value) == expected


def test_a_full_test_always_divides_by_four_sections():
    assert score.ielts_overall_band([7.0, 7.0, 7.0], full_test=True) == 5.5   # 21 / 4 = 5.25
    assert score.ielts_overall_band([7.0, 7.0, 7.0]) == 7.0


# Average marks ielts.org publishes for a band (out of 40).
PUBLISHED_IELTS_MARKS = [
    ("listening", "ielts_academic", 16, 5), ("listening", "ielts_academic", 23, 6),
    ("listening", "ielts_academic", 30, 7), ("listening", "ielts_academic", 35, 8),
    ("reading", "ielts_academic", 15, 5), ("reading", "ielts_academic", 23, 6),
    ("reading", "ielts_academic", 30, 7), ("reading", "ielts_academic", 35, 8),
    ("reading", "ielts_general", 15, 4), ("reading", "ielts_general", 23, 5),
    ("reading", "ielts_general", 30, 6), ("reading", "ielts_general", 35, 7),
]


@pytest.mark.parametrize("skill,exam_type,marks,band", PUBLISHED_IELTS_MARKS)
def test_published_ielts_marks_give_the_published_band(skill, exam_type, marks, band):
    assert score.band_from_raw(skill, exam_type, marks, 40) == band
    # One mark fewer is never a higher band.
    assert score.band_from_raw(skill, exam_type, marks - 1, 40) <= band


@pytest.mark.parametrize("table", [score.LISTENING, score.ACADEMIC, score.GENERAL])
def test_ielts_tables_are_monotonic_half_band_steps(table):
    minimums = [minimum for minimum, _band in table]
    bands = [band for _minimum, band in table]
    assert minimums == sorted(minimums, reverse=True) and minimums[-1] == 0
    assert bands == sorted(bands, reverse=True)
    assert all(band * 2 == int(band * 2) and 0 <= band <= 9 for band in bands)


def test_academic_and_general_training_reading_use_different_tables():
    assert score.band_from_raw("reading", "ielts_academic", 30, 40) == 7
    assert score.band_from_raw("reading", "ielts_general", 30, 40) == 6
    # Listening is the same test for both.
    assert score.band_from_raw("listening", "ielts_general", 30, 40) == score.band_from_raw("listening", "ielts_academic", 30, 40)


def test_no_band_without_an_attempt_or_a_maximum():
    assert score.band_from_raw("reading", "ielts_academic", 0, 40, attempted=False) == 0
    assert score.band_from_raw("reading", "ielts_academic", 10, 0) == 0


@pytest.mark.parametrize("task1,task2,expected", [
    (6.0, 7.0, 6.5),   # (6 + 14) / 3 = 6.67 -> 6.5
    (7.0, 6.0, 6.5),   # (7 + 12) / 3 = 6.33 -> 6.5
    (5.0, 7.0, 6.5),   # 6.33
    (8.0, 6.0, 6.5),   # 6.67
    (5.0, 6.5, 6.0),   # 6.0
    (9.0, 9.0, 9.0),
    (4.0, 7.0, 6.0),   # 6.0: Task 2 outweighs Task 1
])
def test_ielts_writing_task_two_counts_twice(task1, task2, expected):
    assert score.ielts_writing_band(task1, task2) == expected


# Agency table for the 2025 Writing format: expert score out of 16 -> standard score.
OFFICIAL_WRITING_2025 = {
    16: 75, 15.5: 72, 15: 69, 14.5: 67, 14: 65, 13.5: 64, 13: 63, 12.5: 62, 12: 61, 11.5: 59, 11: 57,
    10.5: 55, 10: 53, 9.5: 51, 9: 50, 8.5: 48, 8: 47, 7.5: 45, 7: 43, 6.5: 41, 6: 40, 5.5: 38, 5: 37,
    4.5: 35, 4: 33, 3.5: 31, 3: 28, 2.5: 25, 2: 21, 1.5: 17, 1: 14, 0.5: 10, 0: 0,
}


@pytest.mark.parametrize("raw,standard", sorted(OFFICIAL_WRITING_2025.items()))
def test_multilevel_writing_conversion_matches_the_agency_table(raw, standard):
    assert score.convert_expert("writing", raw) == standard


def test_multilevel_speaking_conversion_shape():
    table = score.SPEAKING
    assert len(table) == 43 and table[0] == 0 and table[-1] == 75          # 0 .. 21 in half points
    assert table == sorted(table)
    assert score.convert_expert("speaking", 21) == 75


@pytest.mark.parametrize("skill,raw", [("writing", 16.5), ("writing", -0.5), ("writing", 3.25), ("speaking", 21.5), ("speaking", float("nan"))])
def test_expert_scores_outside_the_scale_are_rejected(skill, raw):
    with pytest.raises(ValueError):
        score.convert_expert(skill, raw)


# Agency: approximate correct answers per level for Listening/Reading (out of 35).
@pytest.mark.parametrize("correct,standard", [(0, 0), (9, 37), (10, 38), (17, 50), (18, 51), (27, 64), (28, 65), (35, 75)])
def test_multilevel_objective_estimate_anchors(correct, standard):
    item = score.estimate_objective(correct, 35)
    assert item["estimatedStandardScore"] == standard
    assert item["isOfficial"] is False and item["scoreMethod"] == "ESTIMATED"


def test_multilevel_objective_estimate_is_monotonic():
    values = [score.estimate_objective(raw, 35)["estimatedStandardScore"] for raw in range(36)]
    assert values == sorted(values) and values[0] == 0 and values[-1] == 75


@pytest.mark.parametrize("scores,expected", [([51, 51, 51, 50], 50.8), ([65, 65, 65, 64], 64.8), ([38, 38, 38, 37], 37.8), ([75, 75, 75, 75], 75.0)])
def test_multilevel_overall_is_the_mean_of_the_sections(scores, expected):
    assert score.multilevel_overall_score(scores) == expected


def test_multilevel_level_boundaries_follow_the_one_threshold_table():
    floors = score.MULTILEVEL_LEVEL_FLOORS
    assert [level for _floor, level in floors] == ["C1", "B2", "B1"]
    assert [floor for floor, _level in floors] == sorted((floor for floor, _level in floors), reverse=True)
    for floor, level in floors:
        assert score.multilevel_level(floor) == level
        assert score.multilevel_level(floor - 0.1) != level
    lowest = floors[-1][0]
    assert score.multilevel_level(lowest - 1) == score.MULTILEVEL_BELOW_B1
    assert score.multilevel_level(0) == score.MULTILEVEL_BELOW_B1
    assert score.multilevel_level(75) == "C1"


@pytest.mark.parametrize("value", [-1, 75.1, float("inf"), float("nan")])
def test_multilevel_level_rejects_scores_outside_the_scale(value):
    with pytest.raises(ValueError):
        score.multilevel_level(value)
