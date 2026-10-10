"""Paste parsing contract shared with the active NestJS authoring API."""
import re

from .mock_rules import canonical_decision

Q_START = re.compile(r"^\s*(?:Q|№|#)?\s*(\d{1,3})\s*[.)\]:-]?\s+(\S.*)$", re.I)
OPTION = re.compile(r"^\s*\(?([A-Ha-h])[.)]\s*(\S.*)$")
BLANK = re.compile(r"_{2,}|\.{3,}|…|\bgap\b", re.I)


def parse_questions(text):
    lower = text.lower()
    hint = None
    if 'not given' in lower:
        if 'true' in lower and 'false' in lower:
            hint = 'true_false_notgiven'
        elif re.search(r'\byes\b', lower) and re.search(r'\bno\b', lower):
            hint = 'yes_no_notgiven'
    preamble, raw, current = [], [], None
    for line in re.split(r'\r\n?|\n', text):
        if not line.strip():
            continue
        option = OPTION.match(line)
        if option and current:
            current['options'].append(option[2].strip())
            continue
        question = Q_START.match(line)
        if question:
            if current:
                raw.append(current)
            current = {'number': int(question[1]), 'lines': [question[2].strip()], 'options': []}
        elif current:
            current['lines'].append(line.strip())
        else:
            preamble.append(line.strip())
    if current:
        raw.append(current)
    questions = []
    for row in raw:
        prompt = re.sub(r'\s+', ' ', ' '.join(row['lines'])).strip()
        value = {'number': row['number'], 'prompt': prompt}
        if len(row['options']) >= 2:
            value.update(type='multiple_choice', options=row['options'])
        elif hint:
            value.update(type=hint, options=['TRUE', 'FALSE', 'NOT GIVEN'] if hint == 'true_false_notgiven' else ['YES', 'NO', 'NOT GIVEN'])
        else:
            value['type'] = 'sentence_completion' if BLANK.search(prompt) else 'short_answer'
        questions.append(value)
    return {'instructions': ' '.join(preamble).strip() or None, 'questions': questions}


def build_correct_answers(question_type, options, answer):
    decisions = {'t': 'TRUE', 'true': 'TRUE', 'f': 'FALSE', 'false': 'FALSE',
                 'ng': 'NOT GIVEN', 'n/g': 'NOT GIVEN', 'notgiven': 'NOT GIVEN',
                 'not given': 'NOT GIVEN', 'no_information': 'NOT_GIVEN',
                 'no information': 'NOT_GIVEN', 'not_given': 'NOT_GIVEN',
                 'y': 'YES', 'yes': 'YES', 'n': 'NO', 'no': 'NO'}
    result = []
    def add(value):
        if value not in result:
            result.append(value)
    for part in re.split(r'[/;]+', answer):
        part = part.strip()
        if not part:
            continue
        add(part)
        if question_type in {'true_false_notgiven', 'yes_no_notgiven'} and part.lower() in decisions:
            add(canonical_decision(decisions[part.lower()]))
        if question_type in {'multiple_choice', 'multi_select', 'matching', 'matching_headings', 'map_labelling'} and options and re.fullmatch(r'[a-z]', part, re.I):
            index = ord(part.upper()) - 65
            if index < len(options) and options[index]:
                add(options[index])
    return result
