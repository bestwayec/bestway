"""Build candidate-facing positions while preserving stored numbers, IDs and gap tokens."""
from .mock_content import exam_content_units

IELTS_TYPES = {'ielts_academic', 'ielts_general'}


def apply_display_numbers(exam_type, sections):
    for section in sections or []:
        position = 1
        groups = section.get('groups') or []
        skill = section.get('skill')
        objective = exam_type in IELTS_TYPES and skill in ('reading', 'listening')
        if objective:
            units = exam_content_units(groups, skill)
            if skill == 'listening' and all(unit[0].get('partNumber') for unit in units):
                units.sort(key=lambda unit: unit[0]['partNumber'])
            groups = [group for unit in units for group in unit]
        for group in groups:
            for question in group.get('questions') or []:
                question['displayNumber'] = position if exam_type in IELTS_TYPES else question.get('number')
                points = question.get('points')
                slots = points if objective and question.get('type') == 'multi_select' and type(points) is int and points > 1 else 1
                if slots > 1:
                    question['displayNumberEnd'] = position + slots - 1
                position += slots
    return sections
