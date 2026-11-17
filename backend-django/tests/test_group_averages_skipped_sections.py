"""Unanswered sections are skipped, not a 0: they stay out of the group averages and are counted apart."""
from datetime import UTC, datetime
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from openpyxl import load_workbook

from apps.core import groups, statistics
from apps.core.mock_scoring import skipped_skills

# ---- which sections count as skipped -----------------------------------------------------------

BLANK_LISTENING = dict(exam='ielts_academic', raw=dict(listening=dict(score=0, max=40), reading=dict(score=30, max=40)),
                       bands=dict(listening=0, reading=7))


def test_a_blank_full_ielts_section_is_skipped_but_a_wrong_one_is_not():
    assert skipped_skills('ielts_academic', BLANK_LISTENING['raw'], BLANK_LISTENING['bands'], {}) == {'listening'}
    # Every answer wrong: band 3.5 ("below 4.0"), the candidate did take the section.
    wrong = dict(listening=dict(score=0, max=40))
    assert skipped_skills('ielts_academic', wrong, dict(listening=3.5), {}) == set()
    assert skipped_skills('ielts_academic', dict(listening=dict(score=5, max=40)), dict(listening=3.5), {}) == set()


def test_ielts_writing_without_a_band_or_points_is_skipped_only_when_it_has_a_scale():
    assert skipped_skills('ielts_general', dict(writing=dict(score=0, max=18)), {}, {}) == {'writing'}
    assert skipped_skills('ielts_general', dict(writing=dict(score=14, max=18)), {}, {}) == set()      # one task graded: not blank
    assert skipped_skills('ielts_general', dict(writing=dict(score=0, max=18)), dict(writing=6.5), {}) == set()
    assert skipped_skills('ielts_general', dict(writing=dict(score=0, max=0)), {}, {}) == set()


def test_multilevel_skipped_sections_come_from_the_standard_scores():
    standards = dict(listening=dict(status='COMPLETED', estimatedStandardScore=60), reading=dict(status='SKIPPED', estimatedStandardScore=None),
                     speaking=dict(status='SKIPPED'))
    assert skipped_skills('multilevel', dict(reading=dict(score=0, max=35)), {}, standards) == {'reading', 'speaking'}
    assert skipped_skills('multilevel', {}, {}, None) == set()
    assert skipped_skills(None, None, None, None) == set()


# ---- group analytics ----------------------------------------------------------------------------

def attempt(student, exam, raw, bands, standards=None, overall=None, minute=0):
    return SimpleNamespace(id=f'a-{student}-{minute}', student_id=student, status='completed', exam=SimpleNamespace(type=exam),
        finished_at=datetime(2026, 11, 17, 10, minute, tzinfo=UTC), submitted_at=None, started_at=None,
        raw_scores=raw, section_bands=bands, standard_scores=standards or {}, overall_band=overall, overall_score=None)


def run_analytics(attempts):
    with patch.object(groups.MockAttempt, 'objects') as mocks, patch.object(groups.TestAttempt, 'objects') as legacy:
        mocks.filter.return_value.select_related.return_value.order_by.return_value = attempts
        legacy.filter.return_value.order_by.return_value = []
        return groups._compute_student_and_group_analytics(sorted({a.student_id for a in attempts}))


def test_skipped_sections_are_no_score_and_are_counted_per_student_and_group():
    attempts = [
        attempt('s1', 'ielts_academic', dict(listening=dict(score=0, max=40), reading=dict(score=30, max=40)), dict(listening=0, reading=7), overall=5.5),
        attempt('s2', 'ielts_academic', dict(listening=dict(score=30, max=40), reading=dict(score=0, max=40)), dict(listening=7, reading=0), overall=5.5),
        attempt('s3', 'ielts_academic', dict(listening=dict(score=0, max=40)), dict(listening=3.5), overall=3.5),   # answered, all wrong
    ]
    per_student, group = run_analytics(attempts)
    assert per_student['s1']['listeningScore'] is None and per_student['s1']['readingScore'] == 7
    assert per_student['s2']['readingScore'] is None and per_student['s2']['listeningScore'] == 7
    assert per_student['s3']['listeningScore'] == 3.5           # a real (low) result stays
    assert [per_student[s]['skippedSections'] for s in ('s1', 's2', 's3')] == [1, 1, 0]
    assert group['skippedSections'] == dict(listening=1, reading=1, writing=0, speaking=0, total=2)


def test_multilevel_skipped_section_does_not_fall_back_to_its_raw_zero():
    standards = dict(listening=dict(status='COMPLETED', estimatedStandardScore=70), reading=dict(status='SKIPPED', estimatedStandardScore=None))
    per_student, group = run_analytics([attempt('m1', 'multilevel', dict(listening=dict(score=35, max=35), reading=dict(score=0, max=35)), {}, standards)])
    assert per_student['m1']['listeningScore'] == 70 and per_student['m1']['readingScore'] is None
    assert group['skippedSections']['reading'] == 1 and group['skippedSections']['total'] == 1


def test_no_students_has_an_empty_skipped_count():
    assert groups._compute_student_and_group_analytics([])[1]['skippedSections'] == dict(listening=0, reading=0, writing=0, speaking=0, total=0)


# ---- Excel export: averages over submitted sections only ------------------------------------------

def test_excel_averages_leave_out_skipped_sections_and_count_them_apart():
    group = SimpleNamespace(id='g', name='Group A', teacher_id='t')
    students = [SimpleNamespace(user_id=s, user=SimpleNamespace(name=s.upper(), email=None, phone='1')) for s in ('s1', 's2', 's3')]
    attempts = [
        attempt('s1', 'ielts_academic', dict(listening=dict(score=0, max=40), reading=dict(score=30, max=40)), dict(listening=0, reading=7), overall=3.5),
        attempt('s2', 'ielts_academic', dict(listening=dict(score=30, max=40), reading=dict(score=30, max=40)), dict(listening=7, reading=6.5), overall=7),
        attempt('s3', 'ielts_academic', dict(listening=dict(score=11, max=40), reading=dict(score=0, max=40)), dict(listening=4, reading=3.5), overall=3.5),
    ]
    for a in attempts:
        a.exam.title = 'Mock'
        a.cefr_level = None
    with patch.object(groups, 'get_group', return_value=group), patch.object(groups.StudentProfile, 'objects') as profiles,\
            patch.object(groups.MockAttempt, 'objects') as mocks, patch.object(groups.MockAnswer, 'objects') as answers:
        profiles.filter.return_value.select_related.return_value.order_by.return_value = students
        mocks.filter.return_value.select_related.return_value.order_by.return_value = attempts
        answers.filter.return_value.exclude.return_value.exclude.return_value = []
        content, _ = groups.export_group_xlsx(SimpleNamespace(role='admin', id='x'), 'g')
    rows = list(load_workbook(BytesIO(content)).active.iter_rows(values_only=True))
    body = {row[0]: row for row in rows[1:4]}
    assert body['S1'][4] == 'Skipped' and body['S1'][5] == 7
    average, skipped = rows[-2], rows[-1]
    assert average[0] == 'GROUP AVERAGE'
    assert average[4] == 5.5        # (7 + 4) / 2: the blank Listening is not a 0
    assert average[5] == 5.7        # (7 + 6.5 + 3.5) / 3
    assert skipped[0] == 'SKIPPED SECTIONS' and skipped[4] == 1 and skipped[5] == 0 and '1 in total' in skipped[1]


# ---- CSV (statistics) -----------------------------------------------------------------------------

def test_results_csv_prints_dash_for_a_skipped_section_and_counts_it():
    student = SimpleNamespace(user_id='s1', user=SimpleNamespace(name='Ali', phone='9'))
    att = attempt('s1', 'ielts_academic', dict(listening=dict(score=0, max=40), reading=dict(score=30, max=40)), dict(listening=0, reading=7), overall=3.5)
    att.exam.title, att.cefr_level, att.status = 'Mock', None, 'completed'
    att.student = student
    with patch.object(statistics.m.StudentProfile, 'objects') as profiles, patch.object(statistics.m.MockAttempt, 'objects') as mocks,\
            patch.object(statistics, 'csv', side_effect=lambda headers, rows: (headers, rows)):
        profiles.filter.return_value.select_related.return_value.order_by.return_value = [student]
        mocks.filter.return_value.select_related.return_value.order_by.return_value = [att]
        headers, rows = statistics.group_results_csv('g')
    assert headers[-1] == "O'tkazilgan bo'limlar" and headers[3:5] == ['Listening', 'Reading']
    assert rows[0][3] == '-' and rows[0][4] == '7' and rows[0][-1] == 1


def test_results_csv_row_without_attempts_keeps_the_same_width():
    student = SimpleNamespace(user_id='s1', user=SimpleNamespace(name='Ali', phone='9'))
    with patch.object(statistics.m.StudentProfile, 'objects') as profiles, patch.object(statistics.m.MockAttempt, 'objects') as mocks,\
            patch.object(statistics, 'csv', side_effect=lambda headers, rows: (headers, rows)):
        profiles.filter.return_value.select_related.return_value.order_by.return_value = [student]
        mocks.filter.return_value.select_related.return_value.order_by.return_value = []
        headers, rows = statistics.group_results_csv('g')
    assert len(rows[0]) == len(headers) and rows[0][-1] == 0
