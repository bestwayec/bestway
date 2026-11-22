from django.test import SimpleTestCase
from types import SimpleNamespace

from apps.core import telegram_vocab as tv
from apps.core import vocabulary_answers as va


def word(english='big', uzbek='katta, ulkan; buyuk', synonyms=None):
    return SimpleNamespace(english=english, uzbek=uzbek, synonyms=synonyms or ['large', 'huge'])


class AnswerMatcherTests(SimpleTestCase):
    def test_canonicalisation_ignores_case_punctuation_apostrophes_and_spaces(self):
        self.assertEqual(va.canon("  Don’t  Stop! "), va.canon("don't stop"))
        self.assertEqual(va.canon('well–known'), va.canon('well-known'))
        self.assertEqual(va.canon('Katta.'), 'katta')

    def test_every_listed_translation_is_accepted_in_eng_uzb(self):
        forms = va.accepted_forms(word(), 'eng_uzb')
        self.assertEqual(forms, ['katta', 'ulkan', 'buyuk'])
        for text in ('Katta', 'ULKAN!', 'buyuk '):
            self.assertTrue(va.matches(text, 'katta, ulkan; buyuk', forms))

    def test_synonyms_accepted_only_for_typed_translation_into_english(self):
        self.assertTrue(va.matches('huge', 'big', va.accepted_forms(word(), 'uzb_eng')))
        self.assertFalse(va.matches('huge', 'big', va.accepted_forms(word(), 'spelling')))

    def test_matching_is_not_fuzzy(self):
        forms = va.accepted_forms(word(), 'uzb_eng')
        self.assertFalse(va.matches('bigg', 'big', forms))
        self.assertFalse(va.matches('', 'big', forms))
        self.assertFalse(va.matches('   ', 'big', forms))

    def test_teacher_variants_extend_the_accepted_forms(self):
        forms = va.accepted_forms(word(), 'eng_uzb', ['yirik'])
        self.assertTrue(va.matches('Yirik', 'katta, ulkan; buyuk', forms))


class VocabTextTests(SimpleTestCase):
    def test_uzbek_and_english_strings_have_the_same_keys(self):
        self.assertEqual(set(tv.TEXT['uz']), set(tv.TEXT['en']))

    def test_callback_grammar_fits_telegram_limit(self):
        run = 'a' * 36
        for data in (f'vm:{run}:A', f'vo:{run}:49:3', f'vn:{run}:49', f'vc:{run}', f'vx:{run}:49', 'vr:go'):
            self.assertLessEqual(len(data.encode()), 64)
            self.assertTrue(tv.is_vocab_callback(data))
        self.assertFalse(tv.is_vocab_callback('qt'))
        self.assertFalse(tv.is_vocab_callback(None))

    def test_commands_are_recognised_with_bot_suffix(self):
        self.assertEqual(set(tv.COMMANDS), {'/lugat', '/mashq', '/takror', '/natija', '/yordam'})


class PinnedWordTests(SimpleTestCase):
    def test_revision_snapshots_without_synonyms_still_work(self):
        pinned = SimpleNamespace(english='big', uzbek='katta, ulkan')       # assignment revisions carry no synonyms field
        self.assertEqual(va.accepted_forms(pinned, 'uzb_eng'), ['big'])
        self.assertEqual(va.accepted_forms(pinned, 'eng_uzb'), ['katta', 'ulkan'])
