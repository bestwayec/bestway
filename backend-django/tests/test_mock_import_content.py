"""Schema-1.0 import and safe authored-content regression contracts."""
import copy
from pathlib import Path
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient
from types import SimpleNamespace

from apps.core.mock_import_validate import validate_package, canonical_checksum
from apps.core.mock_content import sanitize_content, assert_draft_gaps, assert_gapped_questions
from apps.core.mock_media import resolve_key, validate_upload
from django.core.files.uploadedfile import SimpleUploadedFile
from common.api.exceptions import ContractAPIException


def package_fixture():
    return dict(schemaVersion='1.0', packageId='fixture-package', revision=1, profile='practice',
        source=dict(kind='original_practice', label='Fixture'),
        exam=dict(type='ielts_academic', title='Imported fixture', description='', level='',
            isDemo=False, price=0, isFreeForApproved=False,
            sections=[dict(key='reading', skill='reading', title='Reading', instructions='', durationMinutes=60,
                groups=[dict(key='group', title='Group', instructions='', passageText='Passage', contentHtml='',
                    audioScript='', contentLayout='document', questions=[dict(key='q1', sourceRef='Original fixture',
                        number=1, type='multiple_choice', prompt='Choose', options=['First choice', 'Second choice'],
                        correctAnswers=['A'], acceptedVariants=[], points=1)])])]), media=[], reviewIssues=[])


class ImportValidationTests(SimpleTestCase):
    def test_valid_package_is_importable_and_publishable(self):
        report = validate_package(package_fixture())
        self.assertEqual(report['issues'], [])
        self.assertTrue(report['canImport'])
        self.assertTrue(report['canPublish'])
        self.assertEqual(report['counts']['questions'], 1)

    def test_checksum_ignores_object_property_order_not_semantics(self):
        self.assertEqual(canonical_checksum({'b': 2, 'a': 1}), canonical_checksum({'a': 1, 'b': 2}))
        self.assertNotEqual(canonical_checksum({'a': 1}), canonical_checksum({'a': 2}))

    def test_raw_duplicate_key_blocks_import(self):
        report = validate_package(package_fixture(), raw_text='{"package":{"revision":1,"revision":2}}')
        self.assertFalse(report['canImport'])
        self.assertIn('DUPLICATE_KEY', [i['code'] for i in report['issues']])

    def test_publication_mass_assignment_is_rejected(self):
        package = package_fixture(); package['exam']['isPublished'] = True
        self.assertFalse(validate_package(package)['canImport'])

    def test_duplicate_question_keys_and_numbers_are_rejected(self):
        package = package_fixture()
        questions = package['exam']['sections'][0]['groups'][0]['questions']
        questions.append(copy.deepcopy(questions[0]))
        self.assertFalse(validate_package(package)['canImport'])

    def test_review_issue_blocks_publish_not_import(self):
        package = package_fixture()
        package['reviewIssues'] = [dict(key='review', code='OTHER', path='/exam/sections/0', message='Verify source', sourceRef='Source')]
        report = validate_package(package)
        self.assertTrue(report['canImport'])
        self.assertFalse(report['canPublish'])

    def test_media_traversal_filename_rejected(self):
        package = package_fixture()
        package['media'] = [dict(key='image', kind='image', fileName='../secret.png', requiredForPublish=True)]
        self.assertIn('MEDIA_FILENAME', [i['code'] for i in validate_package(package)['issues']])

    def test_import_validation_routes_are_staff_only(self):
        client = APIClient()
        response = client.post('/v1/mock/exam-imports/validate', {'package': package_fixture()}, format='json')
        self.assertEqual(response.status_code, 401)
        client.force_authenticate(SimpleNamespace(id='student', role='student', is_authenticated=True))
        self.assertEqual(client.post('/v1/mock/exam-imports/validate', {'package': package_fixture()}, format='json').status_code, 403)
        for role in ('teacher', 'admin', 'super_admin'):
            client.force_authenticate(SimpleNamespace(id='staff', role=role, is_authenticated=True))
            response = client.post('/v1/mock/exam-imports/validate', {'package': package_fixture()}, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['data']['canImport'])


class SafeContentTests(SimpleTestCase):
    def test_formatting_is_preserved_and_scripts_attributes_removed(self):
        self.assertEqual(sanitize_content('<p onclick="bad()"><strong>Bold</strong><script>secret</script><br>Text</p>'), '<p><strong>Bold</strong><br />Text</p>')

    def test_gap_marker_never_leaks_embedded_answer(self):
        self.assertEqual(sanitize_content('<span data-gap="001">ANSWER</span>'), '<span data-gap="1"></span>')

    def test_invalid_spans_remove_their_content(self):
        self.assertIsNone(sanitize_content('<span data-gap="201">SECRET</span>'))

    def test_duplicate_gap_numbers_are_rejected(self):
        with self.assertRaises(ContractAPIException) as error:
            assert_draft_gaps('<span data-gap="1"></span><span data-gap="1"></span>')
        self.assertEqual(error.exception.contract_code, 'GAP_TOKEN_DUPLICATE')

    def test_gap_mapping_is_one_to_one(self):
        html = '<p>Text <span data-gap="1"></span></p>'
        assert_gapped_questions(html, [1])
        with self.assertRaises(ContractAPIException) as error:
            assert_gapped_questions(html, [2])
        self.assertEqual(error.exception.contract_code, 'GAP_QUESTION_MISMATCH')

    @override_settings(MEDIA_ROOT=str(Path(__file__).resolve().parent / 'fixture-storage'))
    def test_storage_keys_cannot_escape_root(self):
        for key in ('../secret', 'C:\\secret', '/secret', '..\\secret'):
            with self.subTest(key=key), self.assertRaises(ContractAPIException):
                resolve_key(key)

    def test_upload_rejects_extension_and_mime_spoofing(self):
        for filename, mime in [('bad.exe', 'audio/mpeg'), ('file.mp3', 'text/html')]:
            with self.subTest(filename=filename), self.assertRaises(ContractAPIException):
                validate_upload(SimpleUploadedFile(filename, b'test', content_type=mime), 'audio')
