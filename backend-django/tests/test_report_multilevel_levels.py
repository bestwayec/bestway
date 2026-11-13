from types import SimpleNamespace

from apps.core.management.commands.report_multilevel_levels import stored_level_differences


def attempt(**kw):
    base = dict(id='a', overall_score=None, cefr_level=None, standard_scores=None, submitted_at=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_lists_levels_stored_with_the_old_floors_and_nothing_else():
    rows = stored_level_differences([
        attempt(id='old-c1', overall_score=62.0, cefr_level='C1'),            # old floor 60 -> now B2
        attempt(id='ok', overall_score=66.0, cefr_level='C1'),
        attempt(id='writing', standard_scores={'writing': {'estimatedStandardScore': 47, 'level': 'B2'}}),  # 47 -> B1
        attempt(id='below', overall_score=36.0, cefr_level='B1'),             # old floor 34 -> now none
        attempt(id='no-level', overall_score=40.0, cefr_level=None),
    ])
    assert [row['attemptId'] for row in rows] == ['old-c1', 'writing', 'below']
    assert rows[0]['changes']['overall'] == {'score': 62.0, 'stored': 'C1', 'blueprint': 'B2'}
    assert rows[1]['changes']['writing']['blueprint'] == 'B1'
    assert rows[2]['changes']['overall']['blueprint'] == 'BELOW_B1'
