"""Owner decision 2026-11-14: with internal Writing/Speaking grades the overall uses those grades."""
from django.test import SimpleTestCase

from apps.core.mock_grading import internal_overall


def result(practice=True):
    grade = lambda score: dict(policyId='BESTWAY_MULTILEVEL_PRACTICE_75_CAP55_V1', score=score, isOfficial=False)
    raw = dict(listening=dict(score=35, max=35), reading=dict(score=35, max=35),
               writing=dict(score=13, max=16), speaking=dict(score=17, max=21))
    if practice:
        raw['writing']['practiceGrade'] = grade(47.2); raw['speaking']['practiceGrade'] = grade(47.1)
    standards = {skill: dict(estimatedStandardScore=value) for skill, value in
                 dict(listening=75.0, reading=75.0, writing=63, speaking=61).items()}
    return dict(rawScores=raw, standardScores=standards, overallScore=68.5, cefrLevel='C1')


class InternalOverallTests(SimpleTestCase):
    def test_overall_and_level_follow_the_internal_grades(self):
        value = internal_overall(result())
        self.assertEqual((value['overallScore'], value['cefrLevel']), (61.1, 'B2'))
        # The native estimates stay available, unchanged.
        self.assertEqual(value['standardScores']['writing']['estimatedStandardScore'], 63)

    def test_attempts_without_internal_grades_or_without_an_overall_are_untouched(self):
        self.assertEqual(internal_overall(result(False))['overallScore'], 68.5)
        pending = result(); pending['overallScore'] = None
        self.assertIsNone(internal_overall(pending)['overallScore'])
