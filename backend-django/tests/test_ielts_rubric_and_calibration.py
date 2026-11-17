"""Every band boundary of the IELTS Listening / Reading tables, the Writing and Speaking rubric
(four criteria, Task 2 weighted twice), the provisional AI flag and the calibration MAE.

Expected ranges are the indicative tables ielts.org publishes ("IELTS scoring in detail");
they are written out here independently of apps.core.mock_scoring so a table edit is caught.
Rows below the published range (Listening < 11, Academic < 10, General < 15) are not official
and are only checked for shape in test_scoring_boundaries.py.
"""
from types import SimpleNamespace

import pytest

from apps.core import assessment_results as results
from apps.core import calibration
from apps.core import mock_scoring as score

# (lowest raw, highest raw, band) — ielts.org indicative conversion, out of 40.
OFFICIAL = {
    ('listening', 'ielts_academic'): [(39, 40, 9), (37, 38, 8.5), (35, 36, 8), (32, 34, 7.5), (30, 31, 7), (26, 29, 6.5),
        (23, 25, 6), (18, 22, 5.5), (16, 17, 5), (13, 15, 4.5), (11, 12, 4)],
    ('reading', 'ielts_academic'): [(39, 40, 9), (37, 38, 8.5), (35, 36, 8), (33, 34, 7.5), (30, 32, 7), (27, 29, 6.5),
        (23, 26, 6), (19, 22, 5.5), (15, 18, 5), (13, 14, 4.5), (10, 12, 4)],
    ('reading', 'ielts_general'): [(40, 40, 9), (39, 39, 8.5), (37, 38, 8), (36, 36, 7.5), (34, 35, 7), (32, 33, 6.5),
        (30, 31, 6), (27, 29, 5.5), (23, 26, 5), (19, 22, 4.5), (15, 18, 4)],
}
OFFICIAL[('listening', 'ielts_general')] = OFFICIAL[('listening', 'ielts_academic')]


def official_band(skill, exam_type, raw):
    return next(band for low, high, band in OFFICIAL[(skill, exam_type)] if low <= raw <= high)


EVERY_PUBLISHED_RAW = [(skill, exam, raw) for (skill, exam), rows in OFFICIAL.items()
    for raw in range(rows[-1][0], 41)]


@pytest.mark.parametrize('skill,exam_type,raw', EVERY_PUBLISHED_RAW)
def test_every_published_raw_score_gives_the_published_band(skill, exam_type, raw):
    assert score.band_from_raw(skill, exam_type, raw, 40) == official_band(skill, exam_type, raw)


# The edges named in the audit, plus one either side of every band floor.
EDGES = [
    ('listening', 'ielts_academic', 29, 6.5), ('listening', 'ielts_academic', 30, 7), ('listening', 'ielts_academic', 31, 7),
    ('listening', 'ielts_academic', 38, 8.5), ('listening', 'ielts_academic', 39, 9), ('listening', 'ielts_academic', 40, 9),
    ('listening', 'ielts_general', 29, 6.5), ('listening', 'ielts_general', 30, 7), ('listening', 'ielts_general', 39, 9),
    ('reading', 'ielts_academic', 29, 6.5), ('reading', 'ielts_academic', 30, 7), ('reading', 'ielts_academic', 31, 7),
    ('reading', 'ielts_academic', 38, 8.5), ('reading', 'ielts_academic', 39, 9), ('reading', 'ielts_academic', 40, 9),
    ('reading', 'ielts_general', 29, 5.5), ('reading', 'ielts_general', 30, 6), ('reading', 'ielts_general', 31, 6),
    ('reading', 'ielts_general', 38, 8), ('reading', 'ielts_general', 39, 8.5), ('reading', 'ielts_general', 40, 9),
]


@pytest.mark.parametrize('skill,exam_type,raw,band', EDGES)
def test_named_band_edges(skill, exam_type, raw, band):
    assert score.band_from_raw(skill, exam_type, raw, 40) == band


@pytest.mark.parametrize('key', list(OFFICIAL))
def test_one_below_each_floor_is_the_next_band_down(key):
    skill, exam_type = key
    rows = OFFICIAL[key]
    for (low, _, band), (_, _, lower_band) in zip(rows, rows[1:]):
        assert score.band_from_raw(skill, exam_type, low, 40) == band
        assert score.band_from_raw(skill, exam_type, low - 1, 40) == lower_band


def test_general_training_reading_is_not_scored_on_the_academic_table():
    # 30 correct: Academic 7.0, General Training 6.0 (same raw, different published band).
    assert score.band_from_raw('reading', 'ielts_academic', 30, 40) == 7
    assert score.band_from_raw('reading', 'ielts_general', 30, 40) == 6
    # Listening is one table for both modules.
    assert all(score.band_from_raw('listening', 'ielts_academic', r, 40) == score.band_from_raw('listening', 'ielts_general', r, 40)
        for r in range(41))


@pytest.mark.parametrize('bands,expected', [
    ([6.0, 6.0, 6.5, 6.5], 6.5),   # 6.25  -> 6.5
    ([6.5, 6.5, 7.0, 7.0], 7.0),   # 6.75  -> 7.0
    ([6.0, 6.0, 6.0, 6.5], 6.0),   # 6.125 -> 6.0
    ([6.0, 6.5, 6.5, 6.5], 6.5),   # 6.375 -> 6.5
    ([5.5, 5.5, 6.0, 6.0], 6.0),   # 5.75  -> 6.0
    ([8.5, 8.5, 9.0, 9.0], 9.0),   # 8.75  -> 9.0
    ([4.0, 4.0, 4.5, 4.5], 4.5),   # 4.25  -> 4.5
])
def test_overall_band_quarter_rounding(bands, expected):
    assert score.ielts_overall_band(bands, full_test=True) == expected


# ---- Writing / Speaking rubric -------------------------------------------------------------

WRITING_INPUT = dict(program='IELTS_ACADEMIC', skill='writing', pronunciationEvidence='UNAVAILABLE',
    parts=[dict(id='task1:q1', max=9, weight=1), dict(id='task2:q2', max=9, weight=2)])
SPEAKING_INPUT = dict(program='IELTS_ACADEMIC', skill='speaking', pronunciationEvidence='ACOUSTIC',
    parts=[dict(id='speaking', max=9)])


def writing_result(task1, task2):
    def part(identifier, values):
        return dict(id=identifier, rawScore=None, criteria=dict(zip(['ta', 'cc', 'lr', 'gra'], values)),
            evidence={k: f'{identifier} {k} evidence' for k in ['ta', 'cc', 'lr', 'gra']}, feedback={})
    return dict(parts=[part('task1:q1', task1), part('task2:q2', task2)], confidence=0.9)


@pytest.mark.parametrize('task1,task2,band', [
    ([6, 6, 6, 6], [7, 7, 7, 7], 6.5),           # (6 + 14) / 3 = 6.67 -> 6.5
    ([5, 5, 5, 5], [7, 7, 7, 7], 6.5),           # (5 + 14) / 3 = 6.33 -> 6.5
    ([7, 7, 7, 7], [5, 5, 5, 5], 5.5),           # (7 + 10) / 3 = 5.67 -> 5.5: Task 2 dominates
    ([6.5, 6, 6, 6], [6.5, 6.5, 6, 6], 6.0),     # task bands 6.125 / 6.25 -> 6.21 -> 6.0
    ([9, 9, 9, 9], [9, 9, 9, 9], 9.0),
])
def test_writing_band_weights_task_two_twice(task1, task2, band):
    scored = results.score(WRITING_INPUT, writing_result(task1, task2))
    assert scored['score'] == band
    t1, t2 = (p['score'] for p in scored['parts'])
    assert scored['score'] == score.ielts_writing_band(t1, t2)


def test_writing_reports_four_criteria_for_each_task_with_their_explanations():
    rows = results.criteria_by_part(writing_result([6, 6.5, 6, 5.5], [7, 7, 6.5, 6]), WRITING_INPUT)
    assert [(r['part'], r['weight']) for r in rows] == [('Task 1', 1), ('Task 2', 2)]
    assert [c['code'] for c in rows[0]['criteria']] == ['TA', 'CC', 'LR', 'GRA']
    assert [c['code'] for c in rows[1]['criteria']] == ['TR', 'CC', 'LR', 'GRA']
    assert rows[1]['criteria'][0] == dict(key='ta', code='TR', criterion='Task Response (TR)', score=7, comment='task2:q2 ta evidence')

    feedback = results.format_diagnostic_feedback(writing_result([6, 6.5, 6, 5.5], [7, 7, 6.5, 6]), WRITING_INPUT)
    # Task 2's criteria were dropped before (only the first part's keys were kept).
    assert len(feedback['criteria_scores']) == 8
    assert feedback['criteria_scores'][4]['criterion'] == 'Task 2 · Task Response (TR)'
    assert all(c['comment'] for c in feedback['criteria_scores'])


def test_speaking_reports_fc_lr_gra_p():
    result = dict(parts=[dict(id='speaking', rawScore=None,
        criteria=dict(fluency=6.5, lexical=6, grammar=6, pronunciation=7),
        evidence=dict(fluency='f', lexical='l', grammar='g', pronunciation='p'), feedback={})], confidence=0.9)
    rows = results.criteria_by_part(result, SPEAKING_INPUT)
    assert [c['code'] for c in rows[0]['criteria']] == ['FC', 'LR', 'GRA', 'P']
    assert rows[0]['criteria'][0]['criterion'] == 'Fluency and Coherence (FC)'
    assert results.score(SPEAKING_INPUT, result)['score'] == 6.5   # mean 6.375 -> 6.5
    # One part: no "Speaking ·" prefix.
    assert results.format_diagnostic_feedback(result, SPEAKING_INPUT)['criteria_scores'][3]['criterion'] == 'Pronunciation (P)'


def test_multilevel_diagnostics_keep_their_own_names():
    result = dict(parts=[dict(id='publication', criteria=dict(taskCoverage=4, grammar=4), evidence=dict(taskCoverage='t', grammar='g'))])
    rows = results.criteria_by_part(result, dict(program='MULTILEVEL'))
    assert [c['criterion'] for c in rows[0]['criteria']] == ['Task Coverage & Content', 'Grammatical Accuracy & Range']
    assert rows[0]['criteria'][0]['code'] is None
    # Without the input the Multilevel keys are still recognised.
    assert results.criteria_by_part(result)[0]['criteria'][1]['criterion'] == 'Grammatical Accuracy & Range'


# ---- Provisional (AI estimate until a teacher confirms) ------------------------------------

def job(identifier, skill, status='SUCCEEDED', source='AI'):
    return SimpleNamespace(id=identifier, skill=skill, status=status, final_score_source=source)


def test_ai_scores_are_provisional_until_a_teacher_confirms():
    jobs = [job('w', 'writing'), job('s', 'speaking', 'NEEDS_REVIEW', None)]
    assert results.provisional_skills(jobs, set()) == ['speaking', 'writing']
    # Accepting the AI result (audit trail) or a teacher score makes it final.
    assert results.provisional_skills(jobs, {'w'}) == ['speaking']
    assert results.provisional_skills([job('w', 'writing', source='TEACHER'), job('s', 'speaking', source='ADJUDICATED')], set()) == ['speaking']
    assert results.provisional_skills([], set()) == []


# ---- Calibration ----------------------------------------------------------------------------

def test_calibration_mae_per_criterion():
    teacher = calibration.parse_rows([
        dict(job_id='j1', part_id='task1:a', ta='6', cc='6', lr='6.5', gra='6', skill='writing'),
        dict(job_id='j1', part_id='task2:b', ta='7', cc='6.5', lr='', gra='6'),
        dict(job_id='j2', part_id='task2:c', ta='5', cc='5', lr='5', gra='5'),
    ])
    ai = calibration.parse_rows([
        dict(job_id='j1', part_id='task1:a', ta='6.5', cc='6', lr='6', gra='7'),
        dict(job_id='j1', part_id='task2:b', ta='6', cc='7', lr='7', gra='6'),
    ])
    report = calibration.mae_by_criterion(teacher, ai)
    assert report['criteria']['ta'] == dict(n=2, mae=0.75, bias=-0.25, withinHalfBand=0.5)
    assert report['criteria']['lr'] == dict(n=1, mae=0.5, bias=-0.5, withinHalfBand=1.0)   # blank teacher cell skipped
    assert report['criteria']['gra'] == dict(n=2, mae=0.5, bias=0.5, withinHalfBand=0.5)
    assert report['overall'] == dict(n=7, mae=0.5)
    assert report['unmatchedParts'] == [('j2', 'task2:c')]
    assert 'ta' in calibration.format_report(report)


def test_calibration_rejects_bad_rows():
    with pytest.raises(ValueError, match='missing part_id'):
        calibration.parse_rows([dict(job_id='j1', part_id='', ta='6')])
    with pytest.raises(ValueError, match='ta'):
        calibration.parse_rows([dict(job_id='j1', part_id='p', ta='six')])
    assert calibration.parse_rows([dict(job_id='j', part_id='p', ta='6,5')])[('j', 'p')] == {'ta': 6.5}


def test_calibration_command_reads_two_csv_files(tmp_path):
    from io import StringIO

    from django.core.management import call_command
    (tmp_path / 't.csv').write_text('job_id,part_id,fluency,lexical\nj,speaking,6,6\n', encoding='utf-8')
    (tmp_path / 'a.csv').write_text('job_id,part_id,fluency,lexical\nj,speaking,7,6\n', encoding='utf-8')
    out = StringIO()
    call_command('calibrate_ai_scores', teacher=str(tmp_path / 't.csv'), ai=str(tmp_path / 'a.csv'), json=True, stdout=out)
    assert '"fluency"' in out.getvalue() and '"mae": 1.0' in out.getvalue()
