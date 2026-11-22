"""Pure, wording-agnostic helpers shared by the source extractor (unit-testable without PDFs)."""
from __future__ import annotations

import re
from html import escape

BLANK = '______'

WORD_LIMITS = (
    # (regex on the instruction text, wordLimit, answerRule)
    (re.compile(r'ONE\s+WORD\s+AND/OR\s+A\s+NUMBER', re.I), 2, 'ONE_WORD_AND_OR_NUMBER'),
    (re.compile(r'ONE\s+WORD\s+ONLY', re.I), 1, 'ONE_WORD'),
    (re.compile(r'NO\s+MORE\s+THAN\s+TWO\s+WORDS', re.I), 2, None),
    (re.compile(r'NO\s+MORE\s+THAN\s+THREE\s+WORDS', re.I), 3, None),
    (re.compile(r'ONE\s+WORD', re.I), 1, 'ONE_WORD'),
)


def word_limit_from_instruction(text: str):
    """(wordLimit, answerRule) stated by an instruction line, or (None, None)."""
    for pattern, limit, rule in WORD_LIMITS:
        if pattern.search(text or ''):
            return limit, rule
    return None, None


def join_wrapped(parts: list[str]) -> str:
    """Join wrapped lines; a line ending in a hyphen continues the word on the next line."""
    out = ''
    for part in (p.strip() for p in parts if p and p.strip()):
        out += part if (not out or out.endswith('-')) else ' ' + part
    return re.sub(r'\s+', ' ', out).strip()


def parse_key_rows(lines: list[str], row_numbers: list[list[int]]) -> dict[int, str]:
    """Answer-key rows such as ``1 truck 11 B 21 C 31 life``.

    ``row_numbers`` is the expected question-number sequence of each row; the tokens
    between two consecutive numbers form one (possibly multi-word, possibly numeric) answer.
    Returns {number: answer}. Raises ValueError when a row cannot be matched.
    """
    answers: dict[int, str] = {}
    rows = [line.split() for line in lines if line.strip()]
    cursor = 0
    for expected in row_numbers:
        while cursor < len(rows) and str(expected[0]) != rows[cursor][0]:
            cursor += 1
        if cursor >= len(rows):
            raise ValueError(f'answer-key row starting at {expected[0]} not found')
        tokens, positions, start = rows[cursor], [], 0
        for number in expected:
            try:
                index = tokens.index(str(number), start)
            except ValueError:
                raise ValueError(f'question {number} missing from key row {tokens}') from None
            positions.append(index)
            start = index + 1
        for i, number in enumerate(expected):
            end = positions[i + 1] if i + 1 < len(positions) else len(tokens)
            answer = ' '.join(tokens[positions[i] + 1:end]).strip()
            if not answer:
                raise ValueError(f'question {number} has an empty answer in the key')
            answers[number] = answer
        cursor += 1
    return answers


def expand_alternatives(text: str) -> dict[int, list[str]]:
    """``mine (4); bulldozer (20); chemical spray / sprays (36)`` -> {4:['mine'], ...}.

    ``a b / c`` means the final word alternates: ['a b', 'a c'].
    """
    result: dict[int, list[str]] = {}
    for chunk, number in re.findall(r'([^;()]+?)\s*\((\d{1,3})\)', text or ''):
        chunk = chunk.strip(' ;.')
        if not chunk:
            continue
        if ' / ' in chunk:
            first, *rest = [part.strip() for part in chunk.split(' / ')]
            words = first.split()
            forms = [first] + [' '.join(words[:-1] + [alt]) for alt in rest]
        else:
            forms = [chunk]
        result.setdefault(int(number), []).extend(forms)
    return result


def sentence_split(text: str) -> list[str]:
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z0-9\'"‘“(])', text.strip())
    return [p.strip() for p in parts if p.strip()]


def gap_token(number: int) -> str:
    return f'<span data-gap="{number}"></span>'


def find_gap_tokens(tokens: list[str], expected_next: int, last: int) -> list[tuple[int, int]]:
    """Positions of bare integers that are the next expected gap numbers, in order."""
    found, wanted = [], expected_next
    for index, token in enumerate(tokens):
        if wanted <= last and token == str(wanted):
            found.append((index, wanted))
            wanted += 1
    return found


def nested_list_html(items: list[tuple[int, str]]) -> str:
    """Nested <ul> from (depth, html) pairs; depth 0 is the outermost list."""
    out: list[str] = []
    depth = -1
    for level, html in items:
        level = max(0, min(level, depth + 1))
        if level > depth:
            out.append('<ul>')
        else:
            out.append('</li>')
            out.extend('</ul></li>' for _ in range(depth - level))
        depth = level
        out.append(f'<li>{html}')
    if depth >= 0:
        out.append('</li>')
        out.extend('</ul></li>' for _ in range(depth))
        out.append('</ul>')
    return ''.join(out)


def esc(text: str) -> str:
    return escape(text, quote=False)
