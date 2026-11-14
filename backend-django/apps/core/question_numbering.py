"""Question numbers as the student sees them.

IELTS papers number each section from 1 (Listening 1–40, Reading 1–40) — owner decision
2026-11-14. Stored `number` values (exam-wide in older IELTS exams, e.g. Reading 41–80), question
ids, answer mapping, gap markers and scoring are untouched: this only adds `displayNumber`.
Multilevel keeps its stored numbers.
"""
IELTS_TYPES = {'ielts_academic', 'ielts_general'}


def apply_display_numbers(exam_type, sections):
    """Set `displayNumber` on every question dict in shaped sections (in their display order)."""
    for section in sections or []:
        position = 0
        for group in section.get('groups') or []:
            for question in group.get('questions') or []:
                position += 1
                question['displayNumber'] = position if exam_type in IELTS_TYPES else question.get('number')
    return sections
