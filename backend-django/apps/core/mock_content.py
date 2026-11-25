"""Canonical allow-listed authored HTML and one-to-one gap semantics."""
import html
import re
from html.parser import HTMLParser

from common.api.exceptions import ContractAPIException

LAYOUTS = ('document', 'table', 'notes', 'summary', 'sentences', 'headings',
           'speakers', 'short_texts', 'paragraphs', 'map', 'multi_extract')
TAGS = {'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'table', 'thead',
        'tbody', 'tr', 'th', 'td', 'h3', 'h4', 'span'}
VOID = {'br', 'img', 'hr', 'input', 'meta', 'link', 'wbr', 'source', 'area', 'embed', 'col', 'param', 'track', 'base'}
NON_TEXT = {'script', 'style', 'textarea', 'option'}


class _Sanitizer(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.output, self.stack = [], []

    def handle_starttag(self, tag, attrs):
        if tag in {'p', 'li', 'td', 'th', 'tr'} and self.stack and self.stack[-1][0] == tag:
            self.handle_endtag(tag)
        if tag in {'div', 'table', 'ul', 'ol', 'h3', 'h4'} and self.stack and self.stack[-1][0] == 'p':
            self.handle_endtag('p')
        suppressed = any(frame[2] for frame in self.stack)
        allowed = tag in TAGS
        attributes = ''
        if tag == 'span':
            raw = dict(attrs).get('data-gap', '') or ''
            number = int(raw) if re.fullmatch(r'[0-9]{1,3}', raw) else 0
            if 1 <= number <= 200:
                attributes = f' data-gap="{number}"'
            else:
                suppressed = True
        suppressed = suppressed or tag in NON_TEXT
        if allowed and not suppressed:
            self.output.append(f'<{tag}{attributes}' + (' />' if tag == 'br' else '>'))
        if tag not in VOID:
            self.stack.append((tag, allowed and not suppressed, suppressed))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack) - 1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            return
        for name, rendered, _suppressed in reversed(self.stack[index:]):
            if rendered:
                self.output.append(f'</{name}>')
        del self.stack[index:]

    def handle_data(self, value):
        if not any(frame[2] for frame in self.stack):
            self.output.append(html.escape(value, quote=False))

    def finish(self):
        while self.stack:
            self.handle_endtag(self.stack[-1][0])
        value = ''.join(self.output)
        value = re.sub(r'<span data-gap="([0-9]{1,3})">[\s\S]*?</span>', r'<span data-gap="\1"></span>', value).strip()
        return value or None


def sanitize_content(value):
    if value is None:
        return None
    parser = _Sanitizer()
    parser.feed(value)
    parser.close()
    return parser.finish()


_GAP_SPAN = re.compile(r'<span\s+data-gap="([0-9]{1,3})"\s*>\s*</span>')


def gap_numbers(value):
    return [int(n) for n in _GAP_SPAN.findall(value or '')]


def renumber_gaps(value, numbers):
    if value is None:
        return None
    return _GAP_SPAN.sub(
        lambda match: f'<span data-gap="{numbers[int(match[1])]}"></span>'
        if int(match[1]) in numbers else match[0],
        value,
    )


def _numbers(numbers):
    return ', '.join(str(n) for n in dict.fromkeys(numbers))


def assert_draft_gaps(value):
    gaps = gap_numbers(value)
    if len(set(gaps)) != len(gaps):
        raise ContractAPIException('GAP_TOKEN_DUPLICATE', 'Kontentdagi gap raqami takrorlangan', 400)


def assert_gapped_questions(value, numbers):
    if not value:
        return
    gaps = gap_numbers(value)
    duplicates = [n for i, n in enumerate(gaps) if n in gaps[:i]]
    if duplicates:
        raise ContractAPIException('GAP_TOKEN_DUPLICATE', f'Kontentdagi gap raqami takrorlangan: {_numbers(duplicates)}', 400)
    missing_questions = [n for n in gaps if n not in numbers]
    missing_tokens = [n for n in numbers if n not in gaps]
    details = []
    if missing_questions:
        details.append(f'savolsiz gaplar: {_numbers(missing_questions)}')
    if missing_tokens:
        details.append(f'gapsiz savollar: {_numbers(missing_tokens)}')
    if len(set(numbers)) != len(numbers):
        details.append('savol raqamlari takrorlangan')
    if details:
        raise ContractAPIException('GAP_QUESTION_MISMATCH', f"Kontent va savollar mos emas ({'; '.join(details)})", 400)


def reading_passage_count(passage_texts) -> int:
    """Compatibility helper for callers with a legacy sequence of passage text."""
    return len(exam_content_units(({'passageText': value} for value in passage_texts), 'reading'))


def exam_content_units(groups, skill):
    """Resolve ordered Reading sources and numbered Listening parts without altering group IDs."""
    units, references = [], {}
    previous_text, previous_passage = '', None
    for group in groups:
        ref = group.get('stimulusRef') if skill == 'reading' else group.get('partNumber')
        if type(ref) not in (str, int):
            ref = None
        value = group.get('passageText')
        text = ' '.join(value.split()) if skill == 'reading' and not ref and isinstance(value, str) else ''
        title = group.get('title')
        heading = re.search(r'\bpassage\s+([1-9][0-9]*)\b', title, re.IGNORECASE) if text and isinstance(title, str) else None
        passage = heading[1] if heading else None
        # Two explicitly numbered legacy passages can contain identical text.
        # Retain the text fallback for continuation groups without a heading.
        same_passage = not passage or not previous_passage or passage == previous_passage
        unit = references.get(ref) if ref else units[-1] if text and text == previous_text and same_passage else None
        if unit is None:
            unit = []
            units.append(unit)
            previous_passage = None
            if ref:
                references[ref] = unit
        unit.append(group)
        previous_passage = passage or previous_passage
        previous_text = text
    return units


def source_only_groups(groups, skill):
    """Find source records needed by a populated unit even if they contain no questions."""
    if skill not in ('reading', 'listening'):
        return set()
    field = 'passageText' if skill == 'reading' else 'audioRef'
    reference = 'stimulusRef' if skill == 'reading' else 'partNumber'
    return {
        id(group)
        for unit in exam_content_units(groups, skill)
        if any(isinstance(member.get('questions'), list) and member['questions'] for member in unit)
        for group in unit
        if group.get(reference) and group.get('questions') == []
        and isinstance(group.get(field), str) and group[field].strip()
    }
