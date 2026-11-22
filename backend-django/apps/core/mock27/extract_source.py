"""Turn the owner-supplied Listening/Reading PDFs into schema-1.0 import packages.

Rights: the PDFs carry third-party watermarks, so BESTWAY has NOT verified redistribution
rights. This module therefore contains no source wording; it only parses layout and writes
the result to a private directory the caller chooses (git-ignored). Nothing here publishes.

Requires ``pdfplumber`` (dev-time tool, deliberately not a runtime dependency).
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from . import EXAM_SLUG, EXAM_TITLE
from .common_parse import (
    BLANK,
    esc,
    gap_token,
    join_wrapped,
    nested_list_html,
    parse_key_rows,
    expand_alternatives,
    sentence_split,
    word_limit_from_instruction,
)

WATERMARK = re.compile(r'@\w{4,}')
RIGHT_COLUMN_X = 340.0  # options column of the Listening matching / flow-chart layouts


class ExtractionError(RuntimeError):
    pass


@dataclass
class Line:
    text: str
    x0: float
    x1: float
    top: float
    weight: str  # 'bold' | 'semibold' | 'italic' | 'regular'
    page: int


def _plumber():
    try:
        import pdfplumber
    except ImportError as error:  # pragma: no cover - dev-time dependency
        raise ExtractionError('pip install pdfplumber is required to read the source PDFs') from error
    return pdfplumber


def _upright(obj) -> bool:
    return obj.get('object_type') != 'char' or (
        bool(obj.get('upright')) and abs(obj['matrix'][1]) < 1e-3 and abs(obj['matrix'][2]) < 1e-3)


def _weight(chars) -> str:
    fonts = [c['fontname'].split('+')[-1].lower() for c in chars if c['text'].strip()]
    if not fonts:
        return 'regular'
    share = lambda test: sum(test(f) for f in fonts) / len(fonts)
    if share(lambda f: 'semibold' in f) > .5:
        return 'semibold'
    if share(lambda f: 'bold' in f and 'semibold' not in f) > .5:
        return 'bold'
    if share(lambda f: 'italic' in f or 'oblique' in f) > .5:
        return 'italic'
    return 'regular'


def _normalise_glyphs(text: str) -> str:
    """Private-use dash glyphs and modifier apostrophes the source font emits."""
    text = text.translate({0xE089: '–', 0xE081: '(', 0xE082: ')', 0x02BC: '’'})
    leftovers = re.findall('[\ue000-\uf8ff]', text)
    if leftovers:  # never guess: an unmapped glyph would silently corrupt a question
        raise ExtractionError(f'unmapped private-use glyph(s) {[hex(ord(c)) for c in leftovers]} in {text!r}')
    return text


def _restore_letter_range(text: str, letters: list[str]) -> str:
    """'Choose FIVE answers, AG, and ...' lost its dash: put back 'A–G' using the known option bank."""
    if len(letters) < 2:
        return text
    return text.replace(f'{letters[0]}{letters[-1]},', f'{letters[0]}–{letters[-1]},')


def page_lines(page, number: int, box=None) -> list[Line]:
    view = page.filter(_upright)
    if box:
        view = view.crop(box)
    lines = []
    for raw in view.extract_text_lines(return_chars=True, strip=True):
        text = _normalise_glyphs(raw['text'].strip())
        if not text or WATERMARK.search(text) or re.fullmatch(r'Page \d+( of \d+)?', text):
            continue
        lines.append(Line(text, raw['x0'], raw['x1'], raw['top'], _weight(raw['chars']), number))
    return lines


def sha256_file(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _bare_numbers(text: str, wanted: int, last: int):
    """Find bare integers wanted, wanted+1, ... inside the text; returns [(start, end, n)]."""
    spans, n = [], wanted
    for match in re.finditer(r'(?<![\w.£$/%-])(\d{1,2})(?![\w.%/-])', text):
        if n <= last and int(match.group(1)) == n:
            spans.append((match.start(), match.end(), n))
            n += 1
    return spans


def _prompt_with_blank(text: str, spans, own: int) -> str:
    out, cursor = [], 0
    for start, end, n in spans:
        out.append(text[cursor:start])
        out.append(BLANK if n == own else f'({n}) {BLANK}')
        cursor = end
    out.append(text[cursor:])
    return join_wrapped(out)


def _question(number, qtype, prompt, options, answers, variants, source, *, limit=None, rule=None):
    value = dict(key=f'q{number}', number=number, type=qtype, prompt=prompt, options=list(options),
                 correctAnswers=list(answers), acceptedVariants=list(variants), points=1, sourceRef=source)
    if limit is not None:
        value['wordLimit'] = limit
        if rule:
            value['answerRule'] = rule
    return value


def _package(package_id, label, notes, skill, section_title, minutes, instructions, groups, media):
    return dict(
        schemaVersion='1.0', packageId=package_id, revision=1, profile='full_mock',
        source=dict(kind='provided_material', label=label, notes=notes),
        exam=dict(type='ielts_academic', title=EXAM_TITLE, description=(
            'IELTS Academic practice mock prepared by BESTWAY. Unofficial: not affiliated with or endorsed by IELTS.'),
            level='IELTS Academic', isDemo=False, price=0, isFreeForApproved=True,
            sections=[dict(key=skill, skill=skill, title=section_title, instructions=instructions,
                           durationMinutes=minutes, groups=groups)]),
        media=media, reviewIssues=[])


# ----------------------------------------------------------------------------- Listening

def _range_after(text: str, start: int) -> int:
    """End of 'Questions 1<dash>10'. The PDF font maps the en dash to a private-use glyph (or drops it)."""
    separated = re.search(r'Questions\s+(\d+)[^\d\s]+(\d+)', text)
    if separated and int(separated.group(1)) == start:
        return int(separated.group(2))
    match = re.search(r'Questions\s+(\d+)', text)
    if not match or not match.group(1).startswith(str(start)) or len(match.group(1)) == len(str(start)):
        raise ExtractionError(f'heading {text!r} does not give a range starting at question {start}')
    return int(match.group(1)[len(str(start)):])


def _bullet_tops(page) -> list[tuple[float, float]]:
    return [(c['x0'], c['top']) for c in page.curves if c['width'] < 8 and c['height'] < 8]


def _has_bullet(line: Line, bullets) -> bool:
    return any(abs(x - (line.x0 - 12.0)) < 4 and 0.5 <= top - line.top <= 10 for x, top in bullets)


def _parse_notes(page, lines: list[Line], first: int, last: int, source: str, limit, rule):
    """Notes with bullet structure and gaps -> (contentHtml, questions, title)."""
    bullets = _bullet_tops(page)
    levels = sorted({round(line.x0, 0) for line in lines if line.weight != 'bold'})
    items: list[dict] = []
    for line in lines:
        if line.weight == 'bold':
            items.append(dict(kind='heading', text=line.text))
        elif _has_bullet(line, bullets) or not items or items[-1]['kind'] == 'heading':
            items.append(dict(kind='item', text=line.text, level=levels.index(round(line.x0, 0))))
        else:
            items[-1]['text'] += ('' if items[-1]['text'].endswith('-') else ' ') + line.text
    next_gap, questions, rendered = first, [], []
    for item in items:
        if item['kind'] == 'heading':
            rendered.append(('h', item['text']))
            continue
        text = join_wrapped([item['text']])
        spans = _bare_numbers(text, next_gap, last)
        html, cursor = [], 0
        for start, end, n in spans:
            html.append(esc(text[cursor:start]))
            html.append(gap_token(n))
            cursor = end
        html.append(esc(text[cursor:]))
        for start, end, n in spans:
            questions.append((n, _prompt_with_blank(text, spans, n)))
        next_gap += len(spans)
        rendered.append(('li', item['level'], ''.join(html)))
    html_parts, buffer, indents = [], [], []

    def flush():
        if buffer:
            html_parts.append(nested_list_html(buffer.copy()))
            buffer.clear()
            indents.clear()

    for entry in rendered:
        if entry[0] == 'h':
            flush()
            html_parts.append(f'<h4>{esc(entry[1])}</h4>')
        else:
            while indents and indents[-1] >= entry[1]:
                indents.pop()
            buffer.append((len(indents), entry[2]))
            indents.append(entry[1])
    flush()
    if next_gap != last + 1:
        raise ExtractionError(f'notes block expected gaps {first}-{last}, found up to {next_gap - 1}')
    return ''.join(html_parts), questions


def _answer_row_numbers(first_row: int, rows: int, step: int, columns: int) -> list[list[int]]:
    return [[first_row + r + step * c for c in range(columns)] for r in range(rows)]


def parse_listening(pdf_path: Path) -> dict:
    pdfplumber = _plumber()
    with pdfplumber.open(str(pdf_path)) as pdf:
        pages = list(pdf.pages)
        per_page = [page_lines(page, i + 1) for i, page in enumerate(pages)]
        key_page = next((i for i, lines in enumerate(per_page) if any(l.text.upper().startswith('ANSWER KEY') for l in lines)), None)
        if key_page is None:
            raise ExtractionError('Listening PDF has no ANSWER KEY page')
        key_lines = [l.text for l in per_page[key_page]]
        answers = parse_key_rows(key_lines, _answer_row_numbers(1, 10, 10, 4))
        variants: dict[int, list[str]] = {n: [] for n in range(1, 41)}
        for text in key_lines:
            match = re.search(r'Question\s+(\d+)\s+may be written as\s+(.+?)\s+or\s+(.+?)\.?$', text)
            if match:
                variants[int(match.group(1))].append(match.group(3).strip().rstrip('.'))

        sections: dict[int, list[dict]] = {}
        current = 0
        for index in range(key_page):
            page, lines = pages[index], per_page[index]
            headings = [l for l in lines if l.weight in ('bold', 'semibold') and re.match(r'^Questions\s+\d+', l.text)]
            for line in lines:
                match = re.match(r'^SECTION\s+(\d)\b', line.text)
                if match:
                    current = int(match.group(1))
            if not current:
                continue
            bounds = [h.top for h in headings] + [page.height]
            for i, heading in enumerate(headings):
                sections.setdefault(current, []).append(dict(page=page, page_no=index + 1, heading=heading,
                                                             top=heading.top - 1, bottom=bounds[i + 1] - 1))

        groups, all_questions = [], 0
        next_number = 1
        for section in range(1, 5):
            blocks = sections.get(section)
            if not blocks:
                raise ExtractionError(f'Listening Section {section} not found')
            instructions, html, questions, banks = [], '', [], []
            for block in blocks:
                page, top, bottom, heading = block['page'], block['top'], block['bottom'], block['heading']
                last = _range_after(heading.text, next_number)
                view_lines = [l for l in page_lines(page, block['page_no'], (0, top, page.width, bottom)) if l.top > heading.top + 1]
                head_instr = [l for l in view_lines if l.x0 <= 46 and l.weight in ('italic', 'regular') and l.top < heading.top + 60]
                intro = join_wrapped([l.text for l in head_instr])
                source = f'Owner PDF Listening Section {section}, page {block["page_no"]}'
                limit, rule = word_limit_from_instruction(intro)
                flow = re.search(r'flow\s*chart', intro, re.I)
                notes = re.search(r'Complete the (notes|table|summary|form)', intro, re.I) and not flow
                letters = re.search(r'correct letter', intro, re.I)
                if notes:
                    content = [l for l in view_lines if l not in head_instr]
                    block_html, block_questions = _parse_notes(page, content, next_number, last, source, limit, rule)
                    html += block_html
                    instructions.append(f'Questions {next_number}–{last}\n{intro}')
                    for n, prompt in block_questions:
                        questions.append(_question(n, 'note_completion', prompt, [], [answers[n]], variants[n], source,
                                                   limit=limit, rule=None if variants[n] else rule))
                elif flow:
                    left = page_lines(page, block['page_no'], (0, top, RIGHT_COLUMN_X, bottom))
                    right = page_lines(page, block['page_no'], (RIGHT_COLUMN_X, top, page.width, bottom))
                    options = []
                    for l in right:
                        m = re.match(r'^([A-Z])\s+(.+)$', l.text)
                        if m and len(m.group(1)) == 1:
                            options.append((m.group(1), m.group(2).strip()))
                    letters_found = [o[0] for o in options]
                    if letters_found != [chr(65 + i) for i in range(len(letters_found))] or len(options) < 2:
                        raise ExtractionError(f'flow-chart option bank is not A..: {letters_found}')
                    instr_bottom = max((l.top for l in head_instr), default=heading.top) + 2
                    body = [l for l in left if l.top > instr_bottom and l.text != '↓']
                    title = [l.text for l in body if l.weight == 'bold']
                    steps, buffer = [], []
                    for l in left:
                        if l.top <= instr_bottom or l.weight == 'bold':
                            continue
                        if l.text.strip() == '↓':
                            if buffer:
                                steps.append(buffer)
                            buffer = []
                        else:
                            buffer.append(l.text)
                    if buffer:
                        steps.append(buffer)
                    n = next_number
                    for step in steps:
                        # an option letter may share the text line in the left crop: strip nothing, the crop excludes the column
                        text = join_wrapped(step)
                        spans = _bare_numbers(text, n, last)
                        if not spans:
                            continue
                        prompt = _prompt_with_blank(text, spans, spans[0][2])
                        questions.append(_question(spans[0][2], 'matching', prompt, [o[1] for o in options],
                                                   [answers[spans[0][2]]], [], source))
                        n = spans[0][2] + 1
                    if n != last + 1:
                        raise ExtractionError(f'flow chart expected questions {next_number}-{last}')
                    chart = ('\n' + title[0]) if title else ''
                    instructions.append(f'Questions {next_number}–{last}\n'
                                        f'{_restore_letter_range(intro, [o[0] for o in options])}{chart}')
                elif letters:
                    left = page_lines(page, block['page_no'], (0, top, RIGHT_COLUMN_X, bottom))
                    right = page_lines(page, block['page_no'], (RIGHT_COLUMN_X, top, page.width, bottom))
                    options = [(m.group(1), m.group(2).strip()) for l in right
                               if (m := re.match(r'^([A-Z])\s+(.+)$', l.text))]
                    letters_found = [o[0] for o in options]
                    if letters_found != [chr(65 + i) for i in range(len(letters_found))] or len(options) < 2:
                        raise ExtractionError(f'matching option bank is not A..: {letters_found}')
                    found = 0
                    for l in left:
                        m = re.match(r'^(\d{1,2})\s+(.+?)\s+\1$', l.text)
                        if m and next_number <= int(m.group(1)) <= last:
                            n = int(m.group(1))
                            questions.append(_question(n, 'matching', m.group(2).strip(), [o[1] for o in options],
                                                       [answers[n]], [], source))
                            found += 1
                    if found != last - next_number + 1:
                        raise ExtractionError(f'matching block expected {last - next_number + 1} items, found {found}')
                    table = [l.text for l in left if l.weight == 'bold' and l.top > heading.top + 1]
                    instructions.append(f'Questions {next_number}–{last}\n'
                                        f'{_restore_letter_range(intro, [o[0] for o in options])}' + (f'\n{table[0]}' if table else ''))
                else:  # multiple choice
                    cur_q, cur_opts, tail = None, [], None
                    mcq: list[dict] = []
                    for l in view_lines:
                        if l in head_instr:
                            continue
                        qm = re.match(r'^(\d{1,2})\s+(.+)$', l.text)
                        om = re.match(r'^([A-Z])\s+(.+)$', l.text)
                        if qm and l.weight == 'semibold' and next_number <= int(qm.group(1)) <= last:
                            cur_q = dict(number=int(qm.group(1)), prompt=[qm.group(2)], options=[])
                            mcq.append(cur_q)
                            tail = cur_q['prompt']
                        elif om and cur_q is not None and l.weight == 'regular' and l.x0 > 50:
                            cur_q['options'].append([om.group(1), [om.group(2)]])
                            tail = cur_q['options'][-1][1]
                        elif tail is not None:
                            tail.append(l.text)
                    if [q['number'] for q in mcq] != list(range(next_number, last + 1)):
                        raise ExtractionError(f'multiple-choice block numbering {[q["number"] for q in mcq]}')
                    for q in mcq:
                        letters_q = [o[0] for o in q['options']]
                        if letters_q != [chr(65 + i) for i in range(len(letters_q))] or len(letters_q) < 2:
                            raise ExtractionError(f'question {q["number"]} options are not A..')
                        questions.append(_question(q['number'], 'multiple_choice', join_wrapped(q['prompt']),
                                                   [join_wrapped(o[1]) for o in q['options']], [answers[q['number']]], [], source))
                    instructions.append(f'Questions {next_number}–{last}\n{intro}')
                next_number = last + 1
            reusable = None
            matching = [q for q in questions if q['type'] == 'matching']
            if matching:
                reusable = len({q['correctAnswers'][0] for q in matching}) != len(matching)
                reusable = True if reusable else False
            group = dict(key=f'l{section}', title=f'Listening Part {section}', instructions='\n\n'.join(instructions),
                         passageText='', contentHtml=html, contentLayout='notes' if html else 'document',
                         audioScript='', partNumber=section, audioPlayLimit=1, audioRef=f'part{section}_audio',
                         questions=sorted(questions, key=lambda q: q['number']))
            if reusable is not None:
                group['optionsReusable'] = reusable
            groups.append(group)
            all_questions += len(questions)
    if all_questions != 40:
        raise ExtractionError(f'Listening has {all_questions} questions, expected 40')
    media = [dict(key=f'part{n}_audio', kind='audio', fileName=f'listening-part-{n}.mp3', requiredForPublish=True,
                  description=f'Recording for Listening Part {n} — awaiting owner upload') for n in range(1, 5)]
    return _package('bw-mock27-listening', 'Owner-supplied IELTS Listening Full Test 27 (rights unverified)',
                    'Source PDF carries a third-party watermark. Redistribution rights are NOT verified.',
                    'listening', 'Listening', 30,
                    'The Listening test has four parts and 40 questions. You hear each recording once.', groups, media)


# ----------------------------------------------------------------------------- Reading

def _paragraphs(lines: list[Line], labelled: bool) -> list[str]:
    body = [l for l in lines if l.weight != 'bold']
    if not body:
        return []
    gaps = sorted(b.top - a.top for a, b in zip(body, body[1:]) if a.page == b.page and b.top > a.top)
    spacing = gaps[len(gaps) // 2] if gaps else 15.0
    right_edge = max(l.x1 for l in body if l.weight == 'regular') if any(l.weight == 'regular' for l in body) else max(l.x1 for l in body)
    paragraphs, buffer, previous = [], [], None
    for line in body:
        new = False
        if previous is not None:
            if line.weight != previous.weight and 'italic' in (line.weight, previous.weight) and previous.weight == 'italic':
                new = True
            elif line.page == previous.page:
                new = (line.top - previous.top) > spacing * 1.3
            else:
                new = previous.x1 < right_edge - 28 and previous.text.rstrip().endswith(('.', '!', '?', '"', "'", '”'))
            if labelled and re.match(r'^[A-Z]\s+[A-Z“"\']', line.text) and line.x0 < 60:
                new = True
        if new and buffer:
            paragraphs.append(join_wrapped(buffer))
            buffer = []
        buffer.append(line.text)
        previous = line
    if buffer:
        paragraphs.append(join_wrapped(buffer))
    return paragraphs


def parse_reading(pdf_path: Path) -> dict:
    pdfplumber = _plumber()
    with pdfplumber.open(str(pdf_path)) as pdf:
        per_page = [page_lines(page, i + 1) for i, page in enumerate(pdf.pages)]
    mode, part = None, 0
    passage = {1: [], 2: [], 3: []}
    questions_text = {1: [], 2: [], 3: []}
    key_lines: list[str] = []
    ranges: dict[int, tuple[int, int]] = {}
    for lines in per_page:
        for index in range(len(lines) - 1, 0, -1):  # running title sits right above "PART n"
            if re.match(r'^PART\s+\d$', lines[index].text) and lines[index - 1].weight == 'bold':
                del lines[index - 1]
        for line in lines:
            text = line.text
            if re.match(r'^IELTS ACADEMIC READING', text):
                continue
            if re.match(r'^ANSWER SHEET', text):
                mode = 'sheet'
                continue
            if re.match(r'^ANSWER KEY', text):
                mode = 'key'
                continue
            match = re.match(r'^PART\s+(\d)$', text)
            if match and mode in (None, 'passage', 'questions'):
                part, mode = int(match.group(1)), 'head'
                continue
            match = re.match(r'^READING PASSAGE\s+(\d)\s*-\s*QUESTIONS', text)
            if match:
                part, mode = int(match.group(1)), 'questions'
                continue
            match = re.match(r'^You should spend about \d+ minutes on Questions\s+(\d+)\s*-\s*(\d+)', text)
            if match and mode == 'head':
                ranges[part] = (int(match.group(1)), int(match.group(2)))
                mode = 'passage-title'
                continue
            if mode in ('passage-title', 'passage'):
                passage[part].append(line)
                mode = 'passage'
            elif mode == 'questions':
                questions_text[part].append(line)
            elif mode == 'key':
                key_lines.append(text)
    if sorted(ranges) != [1, 2, 3]:
        raise ExtractionError(f'Reading passages found: {sorted(ranges)}')
    expected = {1: (1, 13), 2: (14, 26), 3: (27, 40)}
    if ranges != expected:
        raise ExtractionError(f'unexpected Reading question ranges {ranges}')

    rows = [[r, r + 13, r + 26] for r in range(1, 14)] + [[40]]
    answers = parse_key_rows(key_lines, rows)
    variants: dict[int, list[str]] = {n: [] for n in range(1, 41)}
    capture = []
    for text in key_lines:
        if text.lower().startswith('alternative accepted answers'):
            capture = [text.split(':', 1)[1]]
        elif capture and not text.upper().startswith('BAND SCORE') and not re.match(r'^\d', text):
            capture.append(text)
        elif capture:
            break
    for number, forms in expand_alternatives(join_wrapped(capture)).items():
        variants[number] = [f for f in forms if f.strip().lower() != answers[number].strip().lower()]

    groups = []
    for part in (1, 2, 3):
        title_line = next((l for l in passage[part] if l.weight == 'bold'), None)
        if title_line is None:
            raise ExtractionError(f'passage {part} has no title line')
        labelled = any(re.match(r'^[A-G]\s+[A-Z]', l.text) and l.x0 < 60 for l in passage[part][:12])
        text = '\n\n'.join(_paragraphs(passage[part], labelled))
        first, last = ranges[part]
        questions, instructions, reusable = _parse_reading_questions(questions_text[part], first, last, answers, variants,
                                                                     f'Owner PDF Reading Passage {part}')
        groups.append(dict(key=f'r{part}', title=f'Reading Passage {part} — {title_line.text}',
                           instructions='\n\n'.join(instructions), passageText=text, contentHtml='', contentLayout='document',
                           audioScript='', **({'optionsReusable': True} if reusable else {}), questions=questions))
    total = sum(len(g['questions']) for g in groups)
    if total != 40:
        raise ExtractionError(f'Reading has {total} questions, expected 40')
    return _package('bw-mock27-reading', 'Owner-supplied IELTS Academic Reading Full Practice Test (rights unverified)',
                    'Source PDF carries a third-party watermark. Redistribution rights are NOT verified.',
                    'reading', 'Reading', 60, 'The Reading test has three passages and 40 questions. You have 60 minutes.', groups, [])


def _tidy_instruction(text: str) -> str:
    text = re.sub(r'In boxes \d+\s*[-–]\s*\d+ on your answer sheet,\s*(write)?', lambda m: 'Write' if m.group(1) else '', text, flags=re.I)
    text = re.sub(r'\s+(?=(?:TRUE|FALSE|YES|NO|NOT GIVEN) if )', '\n', text)
    return text.strip()


def _parse_reading_questions(lines: list[Line], first: int, last: int, answers, variants, source):
    blocks, current = [], None
    for line in lines:
        match = re.match(r'^Questions?\s+(\d+)\s*[-–]\s*(\d+)$', line.text)
        if match:
            current = dict(first=int(match.group(1)), last=int(match.group(2)), lines=[])
            blocks.append(current)
        elif current is not None:
            current['lines'].append(line)
    questions, instructions, reusable = [], [], False
    nxt = first
    for block in blocks:
        if block['first'] != nxt:
            raise ExtractionError(f'{source}: block starts at {block["first"]}, expected {nxt}')
        lo, hi = block['first'], block['last']
        body = [l for l in block['lines'] if not re.match(r'^Answer:\s*_+', l.text) and not re.match(r'^Write your answers? in boxes', l.text)]
        probe = join_wrapped([l.text for l in body[:6]])
        instr_len = 0
        kind = None
        if re.search(r'Complete the sentences', probe, re.I):
            kind = 'sentence_completion'
        elif re.search(r'Complete the summary', probe, re.I):
            kind = 'summary_completion'
        elif re.search(r'agree with the (information|claims)', probe, re.I):
            kind = 'yes_no_notgiven' if re.search(r'\bYES if\b', join_wrapped([l.text for l in body[:12]])) else 'true_false_notgiven'
        elif re.search(r'Which section contains|Which paragraph', probe, re.I):
            kind = 'matching_info'
        elif re.search(r'list of people|following statements', probe, re.I):
            kind = 'matching_people'
        elif re.search(r'Choose the correct (answer|letter)', probe, re.I):
            kind = 'multiple_choice'
        if kind is None:
            raise ExtractionError(f'{source}: cannot classify block {lo}-{hi}: {probe[:60]!r}')
        texts = [l.text for l in body]
        if kind in ('sentence_completion', 'summary_completion'):
            start = 0
            while start < len(body) and not re.search(r'\d+\s*_{3,}', body[start].text) and (
                    body[start].weight != 'bold' or start < 2):
                start += 1
            head_lines = body[:start]
            instr = join_wrapped([l.text for l in head_lines if l.weight != 'bold'])
            title = [l.text for l in body[start:start + 1] if l.weight == 'bold' and not re.search(r'_{3,}', l.text)]
            content = body[start + len(title):]
            limit, rule = word_limit_from_instruction(instr)
            text = join_wrapped([l.text for l in content])
            marked = re.sub(r'(\d{1,2})\s*_{3,}', lambda m: f'⁣{m.group(1)}⁣', text)
            found = [int(x) for x in re.findall('⁣(\\d+)⁣', marked)]
            if found != list(range(lo, hi + 1)):
                raise ExtractionError(f'{source}: blanks {found}, expected {lo}-{hi}')
            for sentence in sentence_split(marked):
                inside = [int(x) for x in re.findall('⁣(\\d+)⁣', sentence)]
                for n in inside:
                    prompt = re.sub('⁣(\\d+)⁣', lambda m: BLANK if int(m.group(1)) == n else f'({m.group(1)}) {BLANK}', sentence)
                    rule_q = None if any(re.search(r'[^\w\s-]', a) for a in [answers[n], *variants[n]]) else rule
                    questions.append(_question(n, kind, join_wrapped([prompt]), [], [answers[n]], variants[n], source,
                                               limit=limit, rule=rule_q))
            instructions.append(f'Questions {lo}–{hi}\n{_tidy_instruction(instr)}' + (f'\n{title[0]}' if title else ''))
        elif kind in ('true_false_notgiven', 'yes_no_notgiven'):
            decision_start = next((i for i, l in enumerate(body) if re.match(r'^\d{1,2}\s+\S', l.text)), None)
            if decision_start is None:
                raise ExtractionError(f'{source}: no statements in block {lo}-{hi}')
            instr = join_wrapped(texts[:decision_start])
            statements, cur = [], None
            for l in body[decision_start:]:
                m = re.match(r'^(\d{1,2})\s+(.+)$', l.text)
                if m and lo <= int(m.group(1)) <= hi and (cur is None or int(m.group(1)) == cur['n'] + 1):
                    cur = dict(n=int(m.group(1)), text=[m.group(2)])
                    statements.append(cur)
                elif cur is not None:
                    cur['text'].append(l.text)
            if [s['n'] for s in statements] != list(range(lo, hi + 1)):
                raise ExtractionError(f'{source}: statement numbers {[s["n"] for s in statements]}')
            options = ['TRUE', 'FALSE', 'NOT GIVEN'] if kind == 'true_false_notgiven' else ['YES', 'NO', 'NOT GIVEN']
            for s in statements:
                questions.append(_question(s['n'], kind, join_wrapped(s['text']), options, [answers[s['n']]], [], source))
            instructions.append(f'Questions {lo}–{hi}\n{_tidy_instruction(instr)}')
        elif kind in ('matching_info', 'matching_people'):
            start = next((i for i, l in enumerate(body) if re.match(r'^\d{1,2}\s+\S', l.text)), None)
            option_lines = [l for l in body if re.match(r'^[A-Z]\.\s+\S', l.text)]
            head = [l.text for l in (body[:start] if start is not None else body) if not re.match(r'^[A-Z]\.\s', l.text)]
            if kind == 'matching_people':
                options = [re.sub(r'^[A-Z]\.\s+', '', l.text).strip() for l in option_lines]
                letters = [l.text[0] for l in option_lines]
            else:
                section = re.search(r'sections?,?\s+([A-Z])\s*[-–]\s*([A-Z])', join_wrapped(texts[:3]))
                if not section:
                    raise ExtractionError(f'{source}: paragraph letter range not stated')
                letters = [chr(c) for c in range(ord(section.group(1)), ord(section.group(2)) + 1)]
                noun = 'Paragraph' if re.search(r'paragraph', join_wrapped(texts[:3]), re.I) else 'Section'
                options = [f'{noun} {letter}' for letter in letters]
            if letters != [chr(65 + i) for i in range(len(letters))] or len(options) < 2:
                raise ExtractionError(f'{source}: option letters {letters}')
            statements, cur = [], None
            for l in body[start:]:
                if re.match(r'^[A-Z]\.\s', l.text):
                    continue
                m = re.match(r'^(\d{1,2})\s+(.+)$', l.text)
                if m and lo <= int(m.group(1)) <= hi and (cur is None or int(m.group(1)) == cur['n'] + 1):
                    cur = dict(n=int(m.group(1)), text=[m.group(2)])
                    statements.append(cur)
                elif cur is not None:
                    cur['text'].append(l.text)
            if [s['n'] for s in statements] != list(range(lo, hi + 1)):
                raise ExtractionError(f'{source}: matching numbers {[s["n"] for s in statements]}')
            for s in statements:
                questions.append(_question(s['n'], 'matching', join_wrapped(s['text']), options, [answers[s['n']]], [], source))
            reusable = reusable or bool(re.search(r'more than once|any letter', join_wrapped(texts), re.I))
            instructions.append(f'Questions {lo}–{hi}\n' + _tidy_instruction(join_wrapped(head)))
        else:  # multiple choice (single answer)
            start = next((i for i, l in enumerate(body) if re.match(r'^\d{1,2}\s+\S', l.text)), None)
            instr = join_wrapped(texts[:start] if start else texts[:2])
            cur_q, tail = None, None
            mcq = []
            for l in body[start:]:
                qm = re.match(r'^(\d{1,2})\s+(.+)$', l.text)
                om = re.match(r'^([A-Z])\s+(.+)$', l.text)
                if qm and lo <= int(qm.group(1)) <= hi and (cur_q is None or int(qm.group(1)) == cur_q['n'] + 1) and not (om and cur_q and not cur_q['opts']):
                    cur_q = dict(n=int(qm.group(1)), prompt=[qm.group(2)], opts=[])
                    mcq.append(cur_q)
                    tail = cur_q['prompt']
                elif om and cur_q is not None and om.group(1) == chr(65 + len(cur_q['opts'])):
                    cur_q['opts'].append([om.group(1), [om.group(2)]])
                    tail = cur_q['opts'][-1][1]
                elif tail is not None:
                    tail.append(l.text)
            if [q['n'] for q in mcq] != list(range(lo, hi + 1)):
                raise ExtractionError(f'{source}: multiple-choice numbering {[q["n"] for q in mcq]}')
            for q in mcq:
                questions.append(_question(q['n'], 'multiple_choice', join_wrapped(q['prompt']),
                                           [join_wrapped(o[1]) for o in q['opts']], [answers[q['n']]], [], source))
            instructions.append(f'Questions {lo}–{hi}\n{instr}')
        nxt = hi + 1
    if nxt != last + 1:
        raise ExtractionError(f'{source}: covered questions up to {nxt - 1}, expected {last}')
    return sorted(questions, key=lambda q: q['number']), instructions, reusable


# ----------------------------------------------------------------------------- CLI

def write_private_packages(listening_pdf: Path, reading_pdf: Path, out_dir: Path) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {'examSlug': EXAM_SLUG, 'sources': {}, 'packages': {}}
    for name, path, parser in (('listening', listening_pdf, parse_listening), ('reading', reading_pdf, parse_reading)):
        package = parser(Path(path))
        target = out_dir / f'{name}.package.json'
        target.write_text(json.dumps(package, ensure_ascii=False, indent=1), encoding='utf-8')
        questions = [q for s in package['exam']['sections'] for g in s['groups'] for q in g['questions']]
        report['sources'][name] = dict(sha256=sha256_file(path), bytes=Path(path).stat().st_size)
        report['packages'][name] = dict(file=target.name, groups=sum(len(s['groups']) for s in package['exam']['sections']),
                                        questions=len(questions), numbers=[q['number'] for q in questions],
                                        types=sorted({q['type'] for q in questions}))
    (out_dir / 'source_report.json').write_text(json.dumps(report, indent=1), encoding='utf-8')
    return report
