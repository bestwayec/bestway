"""rescore_cefr_levels: what changes on old attempts, dry-run by default, --apply writes, nothing else is touched."""
import json
from io import StringIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from apps.core.management.commands import rescore_cefr_levels as command


def attempt(exam='ielts_academic', **fields):
    values = dict(id='a', status='completed', flow_mode='full_test', score_method=None, overall_band=None, overall_score=None,
                  cefr_level=None, standard_scores=None, raw_scores=None, media_state=None, exam=SimpleNamespace(type=exam))
    values.update(fields)
    return SimpleNamespace(**values)


# ---- IELTS -------------------------------------------------------------------------------------

@pytest.mark.parametrize('band,old,new', [
    (6.5, 'C1', 'B2'), (8.0, 'C1', None), (8.5, 'C1', 'C2'), (7.0, 'B2', 'C1'), (5.5, 'B1', 'B2'),
    (4.0, 'A2', 'B1'), (3.5, 'A2', 'BELOW_B1'), (0, 'A1', 'BELOW_B1'), (7.5, 'C1', None),
])
def test_ielts_level_follows_the_overall_band(band, old, new):
    changes = command.plan(attempt(overall_band=band, cefr_level=old))
    assert changes.get('cefr_level') == new
    assert set(changes) <= {'cefr_level', 'media_state'}      # nothing else of an IELTS result is touched
    if new:
        assert changes['media_state']['certificateAsIssued']['cefrLevel'] == old      # the printed value is kept


def test_ielts_without_a_band_or_with_a_junk_band_is_left_alone():
    assert command.plan(attempt(overall_band=None, cefr_level='C1')) == {}
    assert command.plan(attempt(overall_band=12, cefr_level='C1')) == {}
    assert command.plan(attempt(overall_band=True, cefr_level='C1')) == {}


@pytest.mark.parametrize('fields', [
    dict(status='grading'), dict(status='in_progress'), dict(flow_mode='single_skill'), dict(flow_mode='partial_practice'),
    dict(score_method='PRACTICE_PARTIAL'),
])
def test_unfinished_and_practice_attempts_are_never_touched(fields):
    assert command.plan(attempt(overall_band=3.5, cefr_level='C1', **fields)) == {}


# ---- Multilevel -------------------------------------------------------------------------------

def standards(**scores):
    return {skill: dict(estimatedStandardScore=value, level='C1', cefrLevel='C1', status='COMPLETED') for skill, value in scores.items()}


def test_multilevel_section_levels_and_overall_follow_the_stored_standard_scores():
    row = attempt('multilevel', overall_score=70, cefr_level='C1', standard_scores=standards(listening=70, reading=64, writing=50, speaking=37),
                  raw_scores=dict(writing=dict(score=1, max=16)))
    changes = command.plan(row)
    levels = {skill: item['level'] for skill, item in changes['standard_scores'].items()}
    assert levels == dict(listening='C1', reading='B2', writing='B1', speaking='BELOW_B1')
    assert changes['standard_scores']['speaking']['cefrLevel'] == 'BELOW_B1'
    assert changes['overall_score'] == 55.2 and changes['cefr_level'] == 'B2'     # mean 55.25 -> 55.2
    assert 'raw_scores' not in changes


def test_the_removed_internal_practice_grade_is_dropped_and_the_real_overall_returns():
    row = attempt('multilevel', overall_score=61.1, cefr_level='B2',
        standard_scores={k: dict(estimatedStandardScore=v, level='x') for k, v in dict(listening=75.0, reading=75.0, writing=63, speaking=61).items()},
        raw_scores=dict(listening=dict(score=35, max=35), writing=dict(score=13, max=16, practiceGrade=dict(score=47.2)), speaking=dict(score=17, max=21, practiceGrade=dict(score=47.1))))
    changes = command.plan(row)
    assert changes['overall_score'] == 68.5 and changes['cefr_level'] == 'C1'
    assert changes['raw_scores']['writing'] == dict(score=13, max=16) and changes['raw_scores']['listening'] == dict(score=35, max=35)
    assert row.raw_scores['writing']['practiceGrade']['score'] == 47.2            # the input is not mutated


def test_a_multilevel_result_already_on_the_current_scales_has_no_change():
    row = attempt('multilevel', overall_score=70.0, cefr_level='C1', standard_scores=standards(listening=70, reading=70))
    assert command.plan(row) == {}


def test_multilevel_with_skipped_or_raw_only_sections_keeps_its_overall():
    skipped = standards(listening=70)
    skipped['reading'] = dict(estimatedStandardScore=None, status='SKIPPED', level='NOT_TAKEN')
    row = attempt('multilevel', overall_score=70, cefr_level='C1', standard_scores=skipped)
    assert command.plan(row) == {}              # mean of the one taken section is 70, as stored
    raw_only = standards(listening=70, reading=60)
    raw_only['writing'] = dict(scoreMethod='RAW_ONLY', estimatedStandardScore=None)
    row = attempt('multilevel', overall_score=10, cefr_level='B2', standard_scores=raw_only)
    changes = command.plan(row)
    assert 'overall_score' not in changes and 'cefr_level' not in changes      # a short section: no overall to recompute


def test_unknown_exam_type_and_missing_fields_are_ignored():
    assert command.plan(attempt('other', overall_band=3.5, cefr_level='C1')) == {}
    assert command.plan(attempt('multilevel', overall_score=None, cefr_level='B2', standard_scores=None, raw_scores=None)) == {}


# ---- the command ------------------------------------------------------------------------------

def run(rows, *args):
    """Run the command against fake attempts. Returns (output, the queryset that --apply updates through)."""
    listing = MagicMock()
    listing.select_related.return_value.order_by.return_value.iterator.return_value = iter(rows)
    target = MagicMock()
    out = StringIO()
    with patch.object(command.MockAttempt, 'objects') as objects, patch.object(command.transaction, 'atomic'):
        objects.filter.side_effect = lambda **kw: listing if kw.get('status') == 'completed' else target
        call_command('rescore_cefr_levels', *args, stdout=out)
    return out.getvalue(), target


ROWS = lambda: [attempt(id='a1', overall_band=6.5, cefr_level='C1'), attempt(id='a2', overall_band=7.5, cefr_level='C1'),
                attempt(id='a3', overall_band=3.5, cefr_level='A2')]


def test_default_is_a_dry_run_that_writes_nothing():
    text, target = run(ROWS())
    assert text.startswith('DRY_RUN: scanned 3 finished attempts; would change 2 (nothing written')
    assert 'ielts_academic: C1 -> B2' in text and 'ielts_academic: A2 -> BELOW_B1' in text
    target.update.assert_not_called()
    text, target = run(ROWS(), '--dry-run')
    assert text.startswith('DRY_RUN') and not target.update.called


def test_apply_writes_only_the_changed_fields_of_the_changed_attempts():
    text, target = run(ROWS(), '--apply')
    assert text.startswith('APPLY: scanned 3 finished attempts; changed 2 (written: 2)')
    assert target.update.call_count == 2
    assert sorted(call.kwargs['cefr_level'] for call in target.update.call_args_list) == ['B2', 'BELOW_B1']
    # only the changed field is written, plus the saved certificate values
    assert all(set(call.kwargs) == {'cefr_level', 'media_state'} for call in target.update.call_args_list)


def test_json_report_and_option_checks():
    text, _ = run(ROWS(), '--json')
    report = json.loads(text)
    assert (report['mode'], report['scanned'], report['wouldChange'], report['applied']) == ('DRY_RUN', 3, 2, 0)
    assert report['transitions'] == {'ielts_academic: A2 -> BELOW_B1': 1, 'ielts_academic: C1 -> B2': 1,
                                     'ielts_academic: certificate values kept as issued': 2}
    with pytest.raises(CommandError):
        call_command('rescore_cefr_levels', '--dry-run', '--apply', stdout=StringIO())
    with pytest.raises(CommandError):
        call_command('rescore_cefr_levels', '--batch', '0', stdout=StringIO())


# ---- certificates already issued do not change -------------------------------------------------

def test_the_old_values_are_saved_before_a_row_is_rewritten_and_only_once():
    from datetime import UTC, datetime
    now = datetime(2026, 11, 20, 9, 0, tzinfo=UTC)
    row = attempt('multilevel', overall_score=61.1, cefr_level='B2', media_state={'teacher_comment': 'well done'},
        standard_scores={k: dict(estimatedStandardScore=v, level='x') for k, v in dict(listening=75.0, reading=75.0, writing=63, speaking=61).items()},
        raw_scores=dict(writing=dict(score=13, max=16, practiceGrade=dict(score=47.2)), speaking=dict(score=17, max=21, practiceGrade=dict(score=47.1))))
    changes = command.plan(row, now)
    saved = changes['media_state']
    assert saved['teacher_comment'] == 'well done'                       # the rest of the state is kept
    assert saved['certificateAsIssued'] == dict(overallScore=61.1, overallBand=None, cefrLevel='B2',
        standardScores=dict(writing=47.2, speaking=47.1), rescoredAt=now.isoformat())
    assert row.media_state == {'teacher_comment': 'well done'}            # the input is not mutated
    # Run again on the rewritten row: nothing to do, and the first snapshot is never overwritten.
    for field, value in changes.items():
        setattr(row, field, value)
    assert command.plan(row, now) == {}
    row.cefr_level = 'B2'                                                # even if it changed again later
    assert 'media_state' not in command.plan(row, now) or command.plan(row, now)['media_state']['certificateAsIssued'] == saved['certificateAsIssued']


def test_section_level_only_changes_save_no_certificate_values():
    row = attempt('multilevel', overall_score=65.0, cefr_level='C1', standard_scores={'listening': dict(estimatedStandardScore=64, level='C1'),
        'reading': dict(estimatedStandardScore=66, level='C1')})
    changes = command.plan(row)          # Listening 64 is B2, not C1; the overall (65.0, C1) is right as stored
    assert changes['standard_scores']['listening']['level'] == 'B2' and 'media_state' not in changes and 'cefr_level' not in changes


def test_dry_run_report_says_the_certificate_values_are_kept():
    text, _ = run([attempt(id='a1', overall_band=6.5, cefr_level='C1')])
    assert 'certificate values kept as issued' in text and '"certificateKept": true' in text

