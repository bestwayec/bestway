import io
from datetime import datetime, timezone

from django.test import SimpleTestCase
from PIL import Image

from apps.core import result_card as rc

NOW = datetime(2026, 11, 21, 10, 0, tzinfo=timezone.utc)
RESULT = dict(status='submitted', percent=77.5, title='Passive Voice', category='grammar', correct=31, total=40, durationSeconds=605, submittedAt=NOW)


class ResultCardTests(SimpleTestCase):
    def test_status_thresholds_match_the_bot_messages(self):
        self.assertEqual([rc.status_key(p) for p in (95, 90, 80, 75, 60, 50, 49.9, 0)],
                         ['excellent', 'excellent', 'good', 'good', 'fair', 'fair', 'practice', 'practice'])

    def test_png_in_both_languages_with_expected_size(self):
        for lang in ('uz', 'en'):
            png = rc.render_png(rc.quiz_card_data(RESULT, lang, 'Student Name'), lang)
            image = Image.open(io.BytesIO(png))
            self.assertEqual(image.size, (1080, 1350))
            self.assertEqual(image.format, 'PNG')

    def test_card_data_uses_only_saved_values_and_never_an_ielts_band(self):
        data = rc.quiz_card_data(RESULT, 'en')
        self.assertEqual(data['tiles'][0], ('Correct answers', '31/40'))
        self.assertEqual(data['tiles'][1][1], '10:05')
        self.assertNotIn('band', str(data).lower())
        self.assertEqual(data['date'], '21.11.2026 15:00')   # Asia/Tashkent

    def test_unsaved_results_are_refused(self):
        with self.assertRaises(ValueError):
            rc.quiz_card_data(dict(RESULT, status='in_progress'))
        with self.assertRaises(ValueError):
            rc.quiz_card_data(dict(RESULT, percent=None))
        with self.assertRaises(ValueError):
            rc.vocab_card_data({'kind': 'practice'})

    def test_group_summary_has_no_names_or_individual_scores(self):
        overview = dict(assignment=dict(title='T', questionCount=10), completionPercent=50.0, submitted=1, total=2,
                        participants=[dict(name='Secret Name', studentId='u1', bestPercent=88.0), dict(name='Other', studentId='u2', bestPercent=None)])
        data = rc.group_summary_data(overview, 'uz', NOW)
        text = str(data)
        self.assertNotIn('Secret Name', text)
        self.assertNotIn('u1', text)
        self.assertIsNone(data['student'])

    def test_long_titles_and_unicode_do_not_break_rendering(self):
        data = rc.quiz_card_data(dict(RESULT, title='Oʻzbekcha gʻoyalar ' * 12), 'uz', 'Oʻktam Gʻaniyev ' * 4)
        self.assertEqual(Image.open(io.BytesIO(rc.render_png(data, 'uz'))).size, (1080, 1350))
