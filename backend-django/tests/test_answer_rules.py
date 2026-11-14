"""Table-driven checks of the answer rules (``mock_scoring.correct``), both ways.

Case, spaces, accepted variants, articles, hyphens, punctuation, word limits ("NO MORE THAN TWO
WORDS AND/OR A NUMBER"; ielts.org: hyphenated words count as one word), numbers written as words
or digits, True/False/Not Given spellings, choice letters and multi-select order.
"""
import pytest

from apps.core.mock_scoring import correct

NBSP = ' '


@pytest.mark.parametrize('response,keys,expected', [
    # Letter case and spaces never matter.
    ('Blue', ['blue'], True),
    ('  BLUE  ', ['blue'], True),
    ('blue' + NBSP, ['blue'], True),
    ('car   park', ['car park'], True),
    ('car\tpark', ['car park'], True),
    # Punctuation around the answer does not matter; different words do.
    ('blue.', ['blue'], True),
    ('(blue)', ['blue'], True),
    ('blues', ['blue'], False),
    ('blue sky', ['blue'], False),
    # A leading article is optional.
    ('the library', ['library'], True),
    ('a library', ['library'], True),
    ('library', ['the library'], True),
    ('libraries', ['library'], False),
    # Hyphen or space between the parts of a word.
    ('check-in', ['check in'], True),
    ('check in', ['check-in'], True),
    ('well known', ['well-known'], True),
    # Typographic quotes and dashes are the same as plain ones.
    ('o’clock', ["o'clock"], True),
    ('long–term', ['long-term'], True),
    # Numbers as digits or as words.
    ('two', ['2'], True),
    ('2', ['two'], True),
    ('twelfth', ['12'], True),
    ('three', ['2'], False),
    # Empty answers are never correct.
    ('', ['blue'], False),
    ('   ', ['blue'], False),
])
def test_short_answer(response, keys, expected):
    assert correct('short_answer', response, keys) is expected


@pytest.mark.parametrize('response,expected', [
    ('station', True),
    ('railway station', True),
    ('the railway station', False),        # an article is a word: three words, over the limit (ielts.org)
    ('old railway station', False),        # three words: over the limit
    ('ticket-office', True),               # hyphenated words count as one word
])
def test_word_limit_two_words(response, expected):
    assert correct('sentence_completion', response, ['railway station', 'station', 'ticket-office'], word_limit=2) is expected


@pytest.mark.parametrize('response,keys,variants,expected', [
    ('colour', ['color'], ['colour'], True),
    ('color', ['color'], ['colour'], True),
    ('colours', ['color'], ['colour'], False),
])
def test_accepted_variants(response, keys, variants, expected):
    assert correct('short_answer', response, keys, accepted_variants=variants) is expected


@pytest.mark.parametrize('rule,response,expected', [
    ('ONE_WORD', 'energy', True),
    ('ONE_WORD', 'Energy', True),
    ('ONE_WORD', 'solar energy', False),
    ('ONE_WORD', '42', False),
    ('ONE_WORD_AND_OR_NUMBER', 'energy', True),
    ('ONE_WORD_AND_OR_NUMBER', '42', True),
    ('ONE_WORD_AND_OR_NUMBER', '42 energy', False),   # not the key
    ('ONE_WORD_AND_OR_NUMBER', 'solar energy', False),
])
def test_answer_rules(rule, response, expected):
    keys = ['energy', '42']
    assert correct('sentence_completion', response, keys, answer_rule=rule) is expected


@pytest.mark.parametrize('response,key,expected', [
    ('TRUE', 'TRUE', True),
    ('true', 'TRUE', True),
    ('Not Given', 'NOT_GIVEN', True),
    ('NOT-GIVEN', 'NOT_GIVEN', True),
    ('no information', 'NOT_GIVEN', True),
    ('FALSE', 'TRUE', False),
    ('NOT_GIVEN', 'FALSE', False),
])
def test_true_false_not_given(response, key, expected):
    assert correct('true_false_notgiven', response, [key]) is expected


OPTIONS = ['A', 'B', 'C', 'D']


@pytest.mark.parametrize('response,key,expected', [
    ('B', 'B', True),
    ('b', 'B', True),
    (' B ', 'B', True),
    ('C', 'B', False),
])
def test_multiple_choice_letters(response, key, expected):
    assert correct('multiple_choice', response, [key], options=OPTIONS) is expected


def test_multiple_choice_by_option_text():
    options = ['The museum', 'The library', 'The park']
    assert correct('multiple_choice', 'b', ['The library'], options=options) is True
    assert correct('multiple_choice', 'the library', ['B'], options=options) is True
    assert correct('multiple_choice', 'The park', ['The library'], options=options) is False


@pytest.mark.parametrize('response,expected', [
    ('["A","C"]', True),
    ('["C","A"]', True),       # order does not matter
    ('A, C', True),
    ('C;A', True),
    ('A C', True),
    ('["A"]', False),          # one of two is not enough
    ('["A","B","C"]', False),  # an extra choice is wrong
])
def test_multi_select(response, expected):
    assert correct('multi_select', response, ['A', 'C'], options=['A', 'B', 'C', 'D', 'E']) is expected
