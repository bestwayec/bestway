"""Synthetic original content only; no production exams or copyrighted sources."""
from apps.core.multilevel import CURRENT_SPEC, SPECS


def multilevel_questions(skill, part_index, start_number):
    _key, count, allowed, option_count = SPECS[CURRENT_SPEC][skill]['parts'][part_index]
    rows = []
    for index in range(count):
        kind = allowed[0]
        if skill == 'reading' and part_index == 3:
            kind = 'multiple_choice' if index < 4 else 'true_false_notgiven'
        elif skill == 'reading' and part_index == 4:
            kind = 'short_answer' if index < 4 else 'multiple_choice'
        row = dict(number=start_number + index, type=kind,
            prompt=f'Original {skill} response {start_number + index}',
            points=option_count if skill in ('writing', 'speaking') else 1,
            options=[], correctAnswers=[], acceptedVariants=[])
        if kind == 'true_false_notgiven':
            row['correctAnswers'] = ['TRUE']
        elif kind in ('short_answer', 'note_completion', 'sentence_completion', 'summary_completion'):
            row.update(correctAnswers=['word'], wordLimit=1, answerRule='ONE_WORD')
        elif kind not in ('essay_task1', 'essay_task2', 'speaking_task'):
            options = [f'Choice {n + 1}' for n in range(4 if skill == 'reading' and kind == 'multiple_choice' else option_count or 2)]
            row.update(options=options, correctAnswers=[options[0]])
        rows.append(row)
    return rows
