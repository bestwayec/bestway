"""Pure-logic coverage for Mock 27 (no supplied content; synthetic fixtures only)."""
from __future__ import annotations

import io
import json
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase

from apps.core.mock27 import audio_upload, common_parse, maps, original_content, package_checks
from apps.core.mock_import_validate import validate_package
from common.api.exceptions import ContractAPIException
from tests.audio_fixtures import make_m4a, make_mp3
from tests.mock27_fixtures import listening_package, reading_package


class ParseHelpers(SimpleTestCase):
    def test_key_rows_multiword_and_numeric_answers(self):
        rows = ['1 truck 11 B', '4 8.99 14 NOT GIVEN']
        self.assertEqual(common_parse.parse_key_rows(rows, [[1, 11], [4, 14]]), {1: 'truck', 11: 'B', 4: '8.99', 14: 'NOT GIVEN'})

    def test_key_row_missing_number_raises(self):
        with self.assertRaises(ValueError):
            common_parse.parse_key_rows(['1 a 11 b'], [[1, 12]])

    def test_alternatives_expand_final_word(self):
        self.assertEqual(common_parse.expand_alternatives('mine (4); chemical spray / sprays (36)'),
                         {4: ['mine'], 36: ['chemical spray', 'chemical sprays']})

    def test_word_limits(self):
        self.assertEqual(common_parse.word_limit_from_instruction('ONE WORD ONLY'), (1, 'ONE_WORD'))
        self.assertEqual(common_parse.word_limit_from_instruction('ONE WORD AND/OR A NUMBER'), (2, 'ONE_WORD_AND_OR_NUMBER'))
        self.assertEqual(common_parse.word_limit_from_instruction('NO MORE THAN TWO WORDS'), (2, None))

    def test_hyphen_wrap_joins_without_space(self):
        self.assertEqual(common_parse.join_wrapped(['non-', 'traditional ideas']), 'non-traditional ideas')

    def test_nested_list_siblings_and_children(self):
        self.assertEqual(common_parse.nested_list_html([(0, 'a'), (1, 'b'), (1, 'c'), (0, 'd')]),
                         '<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>')


class PackageChecks(SimpleTestCase):
    def test_synthetic_packages_are_sound_and_importable(self):
        for package, groups in ((listening_package(), 4), (reading_package(), 3)):
            self.assertEqual(package_checks.objective_issues(package, expected_groups=groups), [])
            self.assertTrue(validate_package(package, {}, json.dumps(package))['canImport'])
        self.assertEqual(package_checks.evidence_issues(reading_package()), [])

    def test_detects_missing_key_duplicate_and_bad_option(self):
        package = listening_package()
        questions = package['exam']['sections'][0]['groups'][0]['questions']
        questions[0]['correctAnswers'] = []
        questions[1]['number'] = 1
        questions[2]['correctAnswers'] = ['Z']
        issues = ' | '.join(package_checks.objective_issues(package, expected_groups=4))
        self.assertIn('missing answer key', issues)
        self.assertIn('duplicate question numbers', issues)
        self.assertIn('does not resolve', issues)

    def test_detects_wrong_question_count(self):
        package = reading_package()
        package['exam']['sections'][0]['groups'][2]['questions'].pop()
        self.assertIn('39 questions, expected 40', ' '.join(package_checks.objective_issues(package, expected_groups=3)))

    def test_reading_answer_must_appear_in_passage(self):
        package = reading_package()
        package['exam']['sections'][0]['groups'][0]['questions'][0]['correctAnswers'] = ['zzz']
        self.assertEqual(len(package_checks.evidence_issues(package)), 1)


class OriginalContent(SimpleTestCase):
    def test_writing_and_speaking_packages_validate(self):
        for package, media in ((original_content.writing_package(), {'task1_maps': 'staged'}), (original_content.speaking_package(), {})):
            report = validate_package(package, media, json.dumps(package))
            self.assertTrue(report['canImport'], report['issues'][:3])

    def test_task_and_part_content(self):
        writing = original_content.writing_package()['exam']['sections'][0]['groups']
        self.assertEqual([g['questions'][0]['type'] for g in writing], ['essay_task1', 'essay_task2'])
        self.assertIn('Write at least 150 words', writing[0]['instructions'])
        self.assertIn('Write at least 250 words', writing[1]['instructions'])
        self.assertIn('online learning resources are more effective than traditional homework', writing[1]['questions'][0]['prompt'])
        self.assertEqual(len(original_content.SPEAKING_PART1), 8)
        self.assertEqual(len(original_content.SPEAKING_PART3), 6)
        parts = original_content.speaking_package()['exam']['sections'][0]['groups']
        self.assertEqual(len(parts), 3)
        self.assertIn('CUE CARD', parts[1]['questions'][0]['prompt'])


class Maps(SimpleTestCase):
    def test_geographic_consistency(self):
        report = maps.consistency_report()
        self.assertEqual([k for k, v in report.items() if not v], [])

    def test_svgs_are_well_formed_labelled_and_script_free(self):
        import xml.etree.ElementTree as ET
        for svg in (maps.svg_2005(), maps.svg_2025(), maps.combined_svg()):
            ET.fromstring(svg)
            self.assertNotIn('<script', svg)
        self.assertIn('Picnic area', maps.svg_2005())
        for label in ('Café', 'Circular path', 'Boardwalk', 'Bicycle parking', 'Playground (larger)'):
            self.assertIn(label, maps.svg_2025())
        self.assertNotIn('Café', maps.svg_2005())
        self.assertEqual(maps.svg_2005().count('Entrance'), maps.svg_2025().count('Entrance'))

    def test_committed_svgs_match_generator(self):
        folder = Path(__file__).parents[1] / 'apps/core/mock27/assets'
        self.assertEqual((folder / 'riverside-park-2005.svg').read_text(encoding='utf-8'), maps.svg_2005())
        self.assertEqual((folder / 'riverside-park-2025.svg').read_text(encoding='utf-8'), maps.svg_2025())
        self.assertTrue((folder / 'riverside-park-maps.png').read_bytes().startswith(b'\x89PNG'))


class AudioValidation(SimpleTestCase):
    def _upload(self, data, name, ctype):
        return SimpleUploadedFile(name, data, content_type=ctype)

    def _code(self, upload):
        with self.assertRaises(ContractAPIException) as caught:
            audio_upload.inspect_upload(upload)
        return caught.exception.contract_code

    def test_sniffing(self):
        self.assertTrue(audio_upload.sniff_format(b'ID3\x04' + b'\0' * 12, '.mp3'))
        self.assertTrue(audio_upload.sniff_format(b'\xff\xfb\x90\x00' + b'\0' * 12, '.mp3'))
        self.assertTrue(audio_upload.sniff_format(b'\0\0\0\x1cftypM4A ', '.m4a'))
        self.assertFalse(audio_upload.sniff_format(b'RIFF....WAVE', '.mp3'))
        self.assertFalse(audio_upload.sniff_format(b'ID3\x04' + b'\0' * 12, '.m4a'))

    def test_accepts_real_mp3_and_m4a(self):
        mp3 = audio_upload.inspect_upload(self._upload(make_mp3(70), 'a.mp3', 'audio/mpeg'))
        self.assertEqual((mp3['container'], mp3['codec']), ('mp3', 'mp3'))
        self.assertAlmostEqual(mp3['duration_ms'] / 1000, 70, delta=1.5)
        m4a = audio_upload.inspect_upload(self._upload(make_m4a(70), 'a.m4a', 'audio/mp4'))
        self.assertEqual((m4a['container'], m4a['codec']), ('m4a', 'aac'))
        self.assertTrue(any('Unusual length' in w for w in mp3['warnings']))  # 70 s is far below a normal part
        normal = audio_upload.inspect_upload(self._upload(make_mp3(5 * 60), 'b.mp3', 'audio/mpeg'))
        self.assertEqual(normal['warnings'], [])

    def test_rejections(self):
        self.assertEqual(self._code(self._upload(make_mp3(70), 'a.wav', 'audio/wav')), 'INVALID_FILE_TYPE')
        self.assertEqual(self._code(self._upload(make_mp3(70), 'a.mp3', 'image/png')), 'INVALID_FILE_TYPE')
        self.assertEqual(self._code(self._upload(b'x' * 40000, 'a.mp3', 'audio/mpeg')), 'INVALID_FILE_CONTENT')
        self.assertEqual(self._code(self._upload(make_mp3(70), 'a.m4a', 'audio/mp4')), 'INVALID_FILE_CONTENT')
        self.assertEqual(self._code(self._upload(b'ID3', 'a.mp3', 'audio/mpeg')), 'FILE_TOO_SMALL')
        self.assertEqual(self._code(self._upload(make_mp3(20), 'a.mp3', 'audio/mpeg')), 'AUDIO_TOO_SHORT')
        self.assertIn(self._code(self._upload(make_mp3(70)[:60000], 'a.mp3', 'audio/mpeg')), ('AUDIO_TOO_SHORT', 'AUDIO_UNREADABLE'))
