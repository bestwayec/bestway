# -*- coding: utf-8 -*-
"""Unit and Contract Tests for Remaining 23 Grammar Lessons and 276 Error-Free Quizzes."""

import pytest
from apps.core.models import CardType
from apps.core.management.commands.seed_remaining_lessons_and_quizzes import (
    LESSONS_DATA,
    assemble_bamboozle_deck,
)
from apps.core.management.commands.attach_thumbnails import CANONICAL_MAPPINGS

EXPECTED_THUMBNAILS = {
    8: "thumbnails/grammar/futureperfectconteniues.jpg",
    9: "thumbnails/grammar/futureperfect.jpg",
    10: "thumbnails/grammar/futuresimple.jpg",
    11: "thumbnails/grammar/geroundvainfinitive.jpg",
    12: "thumbnails/grammar/if.jpg",
    13: "thumbnails/grammar/indirectspeech.jpg",
    14: "thumbnails/grammar/modalverbs.jpg",
    15: "thumbnails/grammar/numeralspart2.jpg",
    16: "thumbnails/grammar/passivevoice.jpg",
    17: "thumbnails/grammar/pastconteniues.jpg",
    18: "thumbnails/grammar/pastperfectconteniues.jpg",
    19: "thumbnails/grammar/pastperfect.jpg",
    20: "thumbnails/grammar/pastsimple.jpg",
    21: "thumbnails/grammar/personalpossesivepronouns.jpg",
    22: "thumbnails/grammar/prepositions.jpg",
}

PENDING_THUMBNAILS = [7, 23, 24, 25, 26, 27, 28, 29]


def test_lessons_count_and_ordering():
    """Verify exactly 23 lessons are defined with order indices from 7 to 29 sequentially."""
    assert len(LESSONS_DATA) == 23
    order_indices = [l["order_index"] for l in LESSONS_DATA]
    assert order_indices == list(range(7, 30))


def test_thumbnail_distribution():
    """Verify exactly 15 lessons have user-specified thumbnails and 8 lessons have None."""
    with_thumbs = [l for l in LESSONS_DATA if l.get("thumbnail_key") is not None]
    without_thumbs = [l for l in LESSONS_DATA if l.get("thumbnail_key") is None]

    assert len(with_thumbs) == 15
    assert len(without_thumbs) == 8

    # Verify each mapped thumbnail matches the required filename exactly
    for l in LESSONS_DATA:
        idx = l["order_index"]
        if idx in EXPECTED_THUMBNAILS:
            assert l["thumbnail_key"] == EXPECTED_THUMBNAILS[idx], (
                f"Lesson #{idx} thumbnail mismatch: expected {EXPECTED_THUMBNAILS[idx]}, got {l['thumbnail_key']}"
            )
        elif idx in PENDING_THUMBNAILS:
            assert l["thumbnail_key"] is None, (
                f"Lesson #{idx} should have None thumbnail until tomorrow's upload, got {l['thumbnail_key']}"
            )


def test_questions_rigorous_validation():
    """Verify all 276 questions have exactly 4 distinct options, valid correct answers, and valid points."""
    total_questions = 0

    for l in LESSONS_DATA:
        assert l["duration"] > 0, f"Lesson {l['title']} has invalid duration"
        assert l["video_file"].startswith("videos/grammar/"), f"Invalid video file path: {l['video_file']}"
        assert l["category"] == "Grammar"
        assert len(l["questions"]) == 12, f"Lesson {l['title']} must have exactly 12 questions"

        for q_idx, q in enumerate(l["questions"], start=1):
            total_questions += 1
            # 1. Text is non-empty
            assert len(q["text"].strip()) > 5, f"Question text too short in lesson {l['title']} #q{q_idx}"

            # 2. Exactly 4 distinct options
            options = q["options"]
            assert len(options) == 4, (
                f"Lesson {l['title']} q#{q_idx} must have exactly 4 options, found {len(options)}"
            )
            assert len(set(options)) == 4, (
                f"Duplicate option in lesson {l['title']} q#{q_idx}: {options}"
            )

            # 3. Correct answer must be in options
            correct = q["correct"]
            assert correct in options, (
                f"Correct answer '{correct}' not found in options {options} in {l['title']} q#{q_idx}"
            )

            # 4. Valid points
            assert q["points"] in [10, 15, 20], f"Invalid points {q['points']} in {l['title']} q#{q_idx}"

    assert total_questions == 23 * 12 == 276


def test_bamboozle_deck_assembly():
    """Verify deck assembly creates 16 cards with 4 surprise cards at indices 3, 7, 11, 15."""
    for l in LESSONS_DATA:
        assembled = assemble_bamboozle_deck(l["questions"])
        assert len(assembled) == 16, f"Deck for {l['title']} must have exactly 16 cards"

        # Check surprise card indices (1-based: 3, 7, 11, 15 -> 0-based: 2, 6, 10, 14)
        assert assembled[2]["type"] == CardType.SWAP
        assert assembled[6]["type"] == CardType.STEAL
        assert assembled[10]["type"] == CardType.DOUBLE
        assert assembled[14]["type"] == CardType.BOMB

        # The other 12 must be QUESTION cards
        question_cards = [c for c in assembled if c["type"] == CardType.QUESTION]
        assert len(question_cards) == 12


def test_canonical_mappings_defined():
    """Verify attach_thumbnails command has canonical mappings for all lessons."""
    assert len(CANONICAL_MAPPINGS) >= 23
    assert "Future Perfect Continuous" in CANONICAL_MAPPINGS
    assert "Past Simple" in CANONICAL_MAPPINGS
