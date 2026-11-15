"""S4 practice mode: options are practice-only and well formed; timers follow the section."""
from django.test import SimpleTestCase

from apps.core import practice_mode as pm
from common.api.exceptions import ContractAPIException


class OptionTests(SimpleTestCase):
    def test_no_options_is_the_old_contract(self):
        self.assertEqual(pm.parse_options({"mode": "timed", "skills": ["reading"]}, True), {})

    def test_options_belong_to_practice_of_one_section(self):
        self.assertEqual(pm.parse_options({"mode": "practice", "skills": ["reading"], "groupIds": ["g1"], "timer": "part"}, True),
                         {"groupIds": ["g1"], "timer": "part"})
        self.assertEqual(pm.parse_options({"mode": "practice", "skills": ["reading"], "timer": "section"}, True),
                         {"groupIds": None, "timer": "section"})
        for bad in ({"mode": "timed", "skills": ["reading"], "timer": "section"},
                    {"mode": "practice", "skills": ["reading", "listening"], "groupIds": ["g1"]},
                    {"mode": "practice", "skills": ["reading"], "timer": "part"},
                    {"mode": "practice", "skills": ["reading"], "timer": "hour"},
                    {"mode": "practice", "skills": ["reading"], "groupIds": ["g1", "g1"]},
                    {"mode": "practice", "skills": ["reading"], "groupIds": []}):
            with self.assertRaises(ContractAPIException, msg=bad):
                pm.parse_options(bad, True)


class TimerTests(SimpleTestCase):
    def test_section_and_part_timers(self):
        self.assertEqual(pm.timer_seconds("section", 3600, 13, 40), 3600)
        self.assertEqual(pm.timer_seconds("part", 3600, 13, 40), 20 * 60)       # 19.5 min → whole minutes, up
        self.assertEqual(pm.timer_seconds("part", 3600, 1, 400), 60)            # never under a minute
        self.assertIsNone(pm.timer_seconds("none", 3600, 13, 40))
