"""Record Mock 1, Listening Part 4 (Q19-23): the printed plan must carry the A-H letters."""
from __future__ import annotations

import struct
from pathlib import Path

from django.test import SimpleTestCase

from apps.core import mock_rules, mock_scoring

MEDIA = Path(__file__).resolve().parents[2] / "media" / "exams"
MAP_COPIES = (
    "record_mock_1/map.png",
    "record_mock_1/listening_part4_map.png",
    "record_mock_1/community_centre_plan.png",
    "mock1/listening_part4_map.png",
)
OPTIONS = list("ABCDEFGH")


def png_size(path: Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    assert header[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", header[16:24])


class RecordMockMapMediaTests(SimpleTestCase):
    def test_every_copy_is_the_same_readable_plan(self):
        blobs = {name: (MEDIA / name).read_bytes() for name in MAP_COPIES}
        self.assertEqual(len(set(blobs.values())), 1, "all map copies must be identical")
        width, height = png_size(MEDIA / MAP_COPIES[0])
        # Large enough that the letters stay legible when scaled to a 360 px phone.
        self.assertGreaterEqual(width, 1000)
        self.assertGreater(width, height)


class MapOptionScoringTests(SimpleTestCase):
    def test_bare_letters_score_by_index(self):
        for module in (mock_rules, mock_scoring):
            self.assertEqual(module.choice_index("D", OPTIONS), 3)
            self.assertEqual(module.choice_index("h", OPTIONS), 7)

    def test_attempts_saved_with_the_old_option_text_still_score(self):
        for module in (mock_rules, mock_scoring):
            self.assertEqual(module.choice_index("D  Room D", OPTIONS), 3)
            self.assertIsNone(module.choice_index("D  Room E", OPTIONS))
            self.assertIsNone(module.choice_index("D  Room D", ["Red", "Blue", "Green", "Yellow"]))
        self.assertTrue(
            mock_scoring.correct("map_labelling", "D  Room D", ["D"], options=OPTIONS)
        )
        self.assertFalse(
            mock_scoring.correct("map_labelling", "C  Room C", ["D"], options=OPTIONS)
        )
