"""Paste-route contracts; database mutation cases live in the local PG runner."""
from types import SimpleNamespace

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from apps.core.mock_authoring import _resolve_points
from apps.core.mock_parse import build_correct_answers, parse_questions
from common.api.exceptions import ContractAPIException


class PasteContractTests(SimpleTestCase):
    def test_multiple_choice_and_continuation(self):
        self.assertEqual(parse_questions("Instructions\r\nQ1. Choose\rcontinued\n(A) First\nB. Second"), {
            "instructions": "Instructions", "questions": [{
                "number": 1, "prompt": "Choose continued", "type": "multiple_choice",
                "options": ["First", "Second"],
            }],
        })

    def test_text_types_omit_options(self):
        self.assertEqual(parse_questions("1) Fill ____\n2: Explain")['questions'], [
            {'number': 1, 'prompt': 'Fill ____', 'type': 'sentence_completion'},
            {'number': 2, 'prompt': 'Explain', 'type': 'short_answer'},
        ])

    def test_decision_hint_and_choice_priority(self):
        result = parse_questions("TRUE FALSE NOT GIVEN\n1. Fact\n2. Choice\nA) one\nB) two")
        self.assertEqual(result['questions'][0]['type'], 'true_false_notgiven')
        self.assertEqual(result['questions'][1]['type'], 'multiple_choice')

    def test_yes_no_hint(self):
        self.assertEqual(parse_questions("YES NO NOT GIVEN\n1. Statement")['questions'][0]['options'], ['YES', 'NO', 'NOT GIVEN'])

    def test_answer_order_and_expansion(self):
        self.assertEqual(build_correct_answers('multiple_choice', ['one', 'two'], 'B; B/one'), ['B', 'two', 'one'])
        self.assertEqual(build_correct_answers('true_false_notgiven', None, 'ng;t'), ['ng', 'NOT_GIVEN', 't', 'TRUE'])

    def test_reference_points_contract(self):
        self.assertEqual(_resolve_points('multilevel', True, 5), 5)
        self.assertEqual(_resolve_points('ielts_academic', True, 3), 3)
        self.assertEqual(_resolve_points('ielts_general', False, None), 9)
        with self.assertRaises(ContractAPIException):
            _resolve_points('ielts_general', False, 1)

    def test_parse_http_shape_and_status(self):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id='teacher', role='teacher', is_authenticated=True))
        response = client.post('/v1/mock/parse-questions', {'text': '1. Explain'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data, {'success': True, 'data': {
            'instructions': None, 'questions': [{'number': 1, 'prompt': 'Explain', 'type': 'short_answer'}], 'count': 1,
        }})

    def test_parse_student_and_anonymous_denied(self):
        client = APIClient()
        self.assertEqual(client.post('/v1/mock/parse-questions', {'text': '1. Explain'}, format='json').status_code, 401)
        client.force_authenticate(SimpleNamespace(id='student', role='student', is_authenticated=True))
        response = client.post('/v1/mock/parse-questions', {'text': '1. Explain'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['error']['code'], 'FORBIDDEN')

    def test_invalid_parse_payloads(self):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id='teacher', role='teacher', is_authenticated=True))
        for payload in ({}, {'text': 1}, {'text': ''}, {'text': 'a' * 20001}, {'text': '1. Explain', 'unknown': True}):
            with self.subTest(payload=str(payload)[:40]):
                response = client.post('/v1/mock/parse-questions', payload, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data['error']['code'], 'VALIDATION_ERROR')

    def test_text_length_counts_unicode_characters(self):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id='teacher', role='teacher', is_authenticated=True))
        response = client.post('/v1/mock/parse-questions', {'text': '\U0001f600' * 10001}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['data']['instructions'], '\U0001f600' * 10001)

    def test_import_dto_validation_precedes_database(self):
        client = APIClient()
        client.force_authenticate(SimpleNamespace(id='teacher', role='teacher', is_authenticated=True))
        for payload in ({'text': '1. Explain', 'answers': []}, {'text': '1. Explain', 'points': True}, {'text': '1. Explain', 'points': 21}):
            self.assertEqual(client.post('/v1/mock/groups/no-db/questions/import', payload, format='json').status_code, 400)
