"""Canonical allow-listed authored HTML and one-to-one gap semantics."""
import html
from html.parser import HTMLParser
import re

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


def gap_numbers(value):
    return [int(n) for n in re.findall(r'<span\s+data-gap="([0-9]{1,3})"\s*>\s*</span>', value or '')]


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
