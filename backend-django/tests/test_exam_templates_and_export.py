"""Exam Builder 2.0: every advertised template imports, and exams round-trip as JSON.

IMPORT -> SAVE -> EXPORT -> REIMPORT runs through the real views, validator and
commit (PostgreSQL), not mocks. Template fixtures are generated from the frontend
(`template-packages.spec.ts` keeps them identical to what the Import dialog offers).
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from types import SimpleNamespace

from django.db import connection
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.core.mock_content import reading_passage_count
from apps.core.mock_import_validate import validate_package
from apps.core.multilevel import blueprint_issues
from apps.legacy_schema import models as legacy_models
from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup, MockSection

FIXTURES = Path(__file__).resolve().parent / 'fixtures' / 'exam_import_templates'
TABLES = ('MockExam', 'MockExamImport', 'MockImportSourceMap', 'MockImportReviewIssue', 'MockSection',
          'MockQuestionGroup', 'MockQuestion', 'MockStagedMedia', 'MockAttempt', 'AuditLog')
TEACHER = SimpleNamespace(id='teacher-1', role='teacher', is_authenticated=True)
OTHER_TEACHER = SimpleNamespace(id='teacher-2', role='teacher', is_authenticated=True)
ADMIN = SimpleNamespace(id='admin-1', role='admin', is_authenticated=True)
STUDENT = SimpleNamespace(id='student-1', role='student', is_authenticated=True)


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / f'{name}.json').read_text(encoding='utf-8'))


def all_fixtures():
    return sorted(p.stem for p in FIXTURES.glob('*.json'))


def content(package: dict) -> dict:
    """The meaningful exam content: everything except provenance and media bindings."""
    exam = copy.deepcopy(package['exam'])
    for section in exam['sections']:
        for group in section['groups']:
            group.pop('audioRef', None)
            group.pop('imageRef', None)
            for question in group['questions']:
                question.pop('sourceRef', None)
    return exam


class TemplateValidationTests(SimpleTestCase):
    def test_all_eighteen_templates_are_committed(self):
        self.assertEqual(len(all_fixtures()), 18)

    def test_every_template_is_importable_but_never_publishable(self):
        for name in all_fixtures():
            with self.subTest(template=name):
                package = fixture(name)
                raw = json.dumps(package)
                report = validate_package(package, {}, raw)
                blockers = [i for i in report['issues'] if 'import' in i['blocks']]
                self.assertTrue(report['canImport'], blockers[:5])
                # Placeholders must never be mistaken for a publication-ready exam.
                self.assertFalse(report['canPublish'])
                self.assertIn('REVIEW_OPEN', [i['code'] for i in report['issues']])

    def test_multilevel_full_mock_matches_the_configured_blueprint(self):
        package = fixture('multilevel-full')
        issues = blueprint_issues(package['exam']['sections'], imported=True)
        # Only the recordings (uploaded in the editor after import) are missing.
        self.assertTrue(issues)
        self.assertTrue(all('audio' in issue for issue in issues), issues)
        counts = {s['skill']: sum(len(g['questions']) for g in s['groups']) for s in package['exam']['sections']}
        self.assertEqual(counts, {'listening': 35, 'reading': 35, 'writing': 3, 'speaking': 8})

    def test_ielts_full_mock_meets_the_full_mock_profile(self):
        report = validate_package(fixture('ielts-academic-full'))
        self.assertNotIn('PROFILE_BLUEPRINT', [i['code'] for i in report['issues']])
        self.assertNotIn('NUMBER_COLLISION', [i['code'] for i in report['issues']])

    def test_numbers_restart_per_skill_but_collide_within_a_skill(self):
        package = fixture('academic-reading-full')
        questions = package['exam']['sections'][0]['groups'][0]['questions']
        questions[1]['number'] = questions[0]['number']
        self.assertIn('NUMBER_COLLISION', [i['code'] for i in validate_package(package)['issues']])

    def test_optional_metadata_is_validated(self):
        package = fixture('reading-passage-1')
        question = package['exam']['sections'][0]['groups'][0]['questions'][0]
        question.update(cefrLevel='Z9', skillTags=['Bad Tag!'], evidenceText='text that is not in the passage', audioStartSec=3)
        codes = {i['code'] for i in validate_package(package)['issues'] if 'import' in i['blocks']}
        self.assertTrue({'CEFR_LEVEL', 'SKILL_TAGS', 'EVIDENCE_TEXT', 'AUDIO_START'} <= codes, codes)

    def test_group_score_fields_are_validated(self):
        package = fixture('reading-passage-1')
        package['exam']['sections'][0]['groups'][0].update(maxScore=5, stimulusRef='INVALID REF')
        codes = {i['code'] for i in validate_package(package)['issues']}
        self.assertTrue({'MAX_SCORE', 'STIMULUS_REF'} <= codes)

    def test_three_distinct_reading_references_pass_even_with_identical_text(self):
        from tests.mock27_fixtures import listening_package, reading_package
        package = reading_package()
        for i, group in enumerate(package['exam']['sections'][0]['groups'], 1):
            group['stimulusRef'] = f'passage-{i}'
        package['exam']['sections'] += listening_package()['exam']['sections']
        issues = [i['message'] for i in validate_package(package)['issues'] if i['code'] == 'PROFILE_BLUEPRINT']
        self.assertFalse([m for m in issues if 'reading' in m], issues)

    def test_reading_passage_count_clusters_shared_text(self):
        self.assertEqual(reading_passage_count(['A', 'A', ' A ', 'B', 'C']), 3)
        self.assertEqual(reading_passage_count(['A', 'B', 'C']), 3)
        self.assertEqual(reading_passage_count(['', '', 'A']), 3)  # blank text never merges
        self.assertEqual(reading_passage_count(['A', 'B', 'A']), 3)  # only consecutive groups merge


class ExportRoundTripTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._created = []
        existing = set(connection.introspection.table_names())
        for name in TABLES:
            model = getattr(legacy_models, name)
            if model._meta.db_table not in existing:
                with connection.schema_editor() as editor:
                    editor.create_model(model)
                cls._created.append(model)

    @classmethod
    def tearDownClass(cls):
        for model in reversed(cls._created):
            with connection.schema_editor() as editor:
                editor.delete_model(model)
        super().tearDownClass()

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(TEACHER)

    def commit(self, package, target=None, user=TEACHER, replace=None):
        self.client.force_authenticate(user)
        report = self.client.post('/v1/mock/exam-imports/validate', {'package': package}, format='json')
        self.assertEqual(report.status_code, 200, report.data)
        body = {'package': package, 'validatedChecksum': report.data['data']['checksum']}
        if target:
            body['targetExamId'] = target
        if replace is not None:
            body['replaceExisting'] = replace
        return self.client.post('/v1/mock/exam-imports', body, format='json')

    def export(self, exam_id, skill=None, user=TEACHER):
        self.client.force_authenticate(user)
        return self.client.get(f'/v1/mock/exams/{exam_id}/export' + (f'?skill={skill}' if skill else ''))

    def test_every_template_survives_import_export_reimport(self):
        for name in all_fixtures():
            with self.subTest(template=name):
                original = fixture(name)
                created = self.commit(original)
                self.assertEqual(created.status_code, 201, created.data)
                exported = self.export(created.data['data']['examId'])
                self.assertEqual(exported.status_code, 200, exported.data)
                package = exported.data['data']
                self.assertTrue(validate_package(package)['canImport'], validate_package(package)['issues'][:5])
                self.assertEqual(content(package), content(original))
                # Second hop: the exported package re-imports into an identical exam.
                again = self.commit(package)
                self.assertEqual(again.status_code, 201, again.data)
                second = self.export(again.data['data']['examId']).data['data']
                self.assertEqual(content(second), content(package))

    def test_metadata_media_and_scores_round_trip(self):
        exam_id = self.commit(fixture('listening-part-1')).data['data']['examId']
        group = MockQuestionGroup.objects.get(section__exam_id=exam_id)
        group.audio_key = 'mock-audio/part1-recording.mp3'
        group.save(update_fields=['audio_key'])
        question = MockQuestion.objects.filter(group_id=group.id).order_by('number').first()
        question.cefr_level, question.skill_tags, question.audio_start_sec = 'B2', ['detail', 'numbers'], 12.5
        question.save(update_fields=['cefr_level', 'skill_tags', 'audio_start_sec'])
        package = self.export(exam_id).data['data']
        self.assertEqual(package['media'], [dict(key=package['media'][0]['key'], kind='audio', fileName='part1-recording.mp3',
                                                 requiredForPublish=True, description=package['media'][0]['description'])])
        self.assertEqual(package['exam']['sections'][0]['groups'][0]['audioRef'], package['media'][0]['key'])
        # Without the file re-attached the package imports as a draft but cannot publish.
        report = validate_package(package)
        self.assertTrue(report['canImport'])
        self.assertIn('MISSING_MEDIA', [i['code'] for i in report['issues']])
        copy_id = self.commit(package).data['data']['examId']
        copied = MockQuestion.objects.filter(group__section__exam_id=copy_id).order_by('number').first()
        self.assertEqual((copied.cefr_level, copied.skill_tags, copied.audio_start_sec), ('B2', ['detail', 'numbers'], 12.5))

    def test_reading_source_and_blank_continuation_round_trip(self):
        package = fixture('reading-passage-1')
        groups = package['exam']['sections'][0]['groups']
        first = groups[0]
        first['stimulusRef'] = 'shared-source'
        continuation = {**first, 'key': 'reading-continuation', 'title': 'Continuation',
                        'passageText': '', 'questions': first['questions'][5:]}
        first['questions'] = first['questions'][:5]
        groups.insert(1, continuation)
        exam_id = self.commit(package).data['data']['examId']
        exported = self.export(exam_id).data['data']
        imported_id = self.commit(exported).data['data']['examId']
        self.assertEqual(content(exported), content(self.export(imported_id).data['data']))
        persisted = list(MockQuestionGroup.objects.filter(section__exam_id=imported_id).order_by('sort_order'))
        self.assertEqual([group.stimulus_ref for group in persisted[:2]], ['shared-source'] * 2)
        self.assertTrue(persisted[0].passage_text)
        self.assertIsNone(persisted[1].passage_text)

    def test_teacher_can_move_a_task_without_changing_question_ids(self):
        exam_id = self.commit(fixture('reading-passage-1')).data['data']['examId']
        section = MockSection.objects.get(exam_id=exam_id)
        original = MockQuestionGroup.objects.get(section=section)
        route = f'/v1/mock/sections/{section.id}/groups'
        child = self.client.post(route, {'title': 'New task', 'parentGroupId': original.id}, format='json')
        self.assertEqual(child.status_code, 201, child.data)
        task_id = child.data['data']['id']
        source = self.client.post(route, {'title': 'Another passage', 'passageText': 'A new source.'}, format='json')
        self.assertEqual(source.status_code, 201, source.data)
        question = MockQuestion.objects.filter(group=original).first()
        MockQuestion.objects.filter(id=question.id).update(group_id=task_id)
        target = {'parentGroupId': source.data['data']['id']}
        self.client.force_authenticate(OTHER_TEACHER)
        self.assertEqual(self.client.patch(f'/v1/mock/groups/{task_id}', target, format='json').status_code, 403)
        self.client.force_authenticate(TEACHER)
        moved = self.client.patch(f'/v1/mock/groups/{task_id}', target, format='json')
        self.assertEqual(moved.status_code, 200, moved.data)
        self.assertEqual(moved.data['data']['stimulusRef'], source.data['data']['stimulusRef'])
        question.refresh_from_db()
        self.assertEqual(question.group_id, task_id)

    def test_reading_evidence_offset_is_recomputed(self):
        package = fixture('reading-passage-1')
        group = package['exam']['sections'][0]['groups'][0]
        group['questions'][0]['evidenceText'] = group['passageText'].split('\n\n')[1][:40]
        exam_id = self.commit(package).data['data']['examId']
        row = MockQuestion.objects.get(group__section__exam_id=exam_id, number=group['questions'][0]['number'])
        self.assertEqual(row.evidence_text, group['questions'][0]['evidenceText'])
        self.assertEqual(row.evidence_offset, group['passageText'].index(row.evidence_text))
        exported = self.export(exam_id).data['data']
        self.assertEqual(exported['exam']['sections'][0]['groups'][0]['questions'][0]['evidenceText'], row.evidence_text)

    def test_multilevel_writing_scores_and_shared_stimulus_are_stored(self):
        exam_id = self.commit(fixture('multilevel-writing')).data['data']['examId']
        groups = list(MockQuestionGroup.objects.filter(section__exam_id=exam_id).order_by('sort_order'))
        self.assertEqual([g.max_score for g in groups], [5, 5, 6])
        self.assertEqual([g.stimulus_ref for g in groups], ['writing-task-1', 'writing-task-1', None])

    def test_single_skill_export(self):
        exam_id = self.commit(fixture('ielts-academic-full')).data['data']['examId']
        full = self.export(exam_id).data['data']
        self.assertEqual(full['profile'], 'full_mock')
        reading = self.export(exam_id, 'reading').data['data']
        self.assertEqual([s['skill'] for s in reading['exam']['sections']], ['reading'])
        self.assertEqual(reading['profile'], 'practice')
        self.assertTrue(validate_package(reading)['canImport'])
        self.assertEqual(self.export(exam_id, 'bogus').status_code, 400)

    def test_export_requires_ownership_and_staff(self):
        exam_id = self.commit(fixture('reading-passage-1')).data['data']['examId']
        self.assertEqual(self.export(exam_id, user=STUDENT).status_code, 403)
        self.assertEqual(self.export(exam_id, user=OTHER_TEACHER).status_code, 403)
        self.assertEqual(self.export(exam_id, user=ADMIN).status_code, 200)
        self.assertEqual(self.export('00000000-0000-0000-0000-000000000000').status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/v1/mock/exams/{exam_id}/export').status_code, 401)

    def test_student_cannot_validate_commit_or_read_keys(self):
        self.client.force_authenticate(STUDENT)
        package = fixture('reading-passage-1')
        self.assertEqual(self.client.post('/v1/mock/exam-imports/validate', {'package': package}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/v1/mock/exam-imports', {'package': package, 'validatedChecksum': '0' * 64}, format='json').status_code, 403)
        self.assertEqual(MockExam.objects.count(), 0)

    def test_invalid_package_creates_nothing(self):
        package = fixture('reading-passage-1')
        package['exam']['sections'][0]['groups'][0]['questions'][0]['correctAnswers'] = ['Z']
        response = self.commit(package)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data['error']['code'], 'MOCK_IMPORT_INVALID')
        self.assertEqual(MockExam.objects.count(), 0)
        self.assertEqual(MockQuestion.objects.count(), 0)

    def test_merge_into_draft_keeps_existing_sections(self):
        exam_id = self.commit(fixture('listening-full')).data['data']['examId']
        before = {q.id: (q.number, q.correct_answers) for q in MockQuestion.objects.filter(group__section__exam_id=exam_id)}
        added = self.commit(fixture('academic-reading-full'), target=exam_id)
        self.assertEqual(added.status_code, 201, added.data)
        self.assertTrue(added.data['data']['addedToExisting'])
        after = {q.id: (q.number, q.correct_answers) for q in MockQuestion.objects.filter(group__section__skill='listening', group__section__exam_id=exam_id)}
        self.assertEqual(after, before)
        self.assertEqual(sorted(MockSection.objects.filter(exam_id=exam_id).values_list('skill', flat=True)), ['listening', 'reading'])
        self.assertEqual(MockQuestion.objects.filter(group__section__exam_id=exam_id).count(), 80)

    def test_rejected_merge_rolls_back_completely(self):
        exam_id = self.commit(fixture('reading-passage-1')).data['data']['examId']
        groups_before = MockQuestionGroup.objects.filter(section__exam_id=exam_id).count()
        version_before = MockExam.objects.get(id=exam_id).content_version
        # Same Reading numbers again -> collision raised after the lock and version bump.
        clash = fixture('reading-passage-1')
        clash['packageId'] = 'reading-passage-1-again'
        response = self.commit(clash, target=exam_id)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['error']['code'], 'MOCK_IMPORT_NUMBER_COLLISION')
        self.assertEqual(MockQuestionGroup.objects.filter(section__exam_id=exam_id).count(), groups_before)
        self.assertEqual(MockExam.objects.get(id=exam_id).content_version, version_before)
        # A Multilevel package cannot be merged into an IELTS exam.
        mismatch = self.commit(fixture('multilevel-reading'), target=exam_id)
        self.assertEqual(mismatch.status_code, 409)
        self.assertEqual(mismatch.data['error']['code'], 'MOCK_IMPORT_TYPE_MISMATCH')
        self.assertEqual(MockExam.objects.count(), 1)

    def test_other_teachers_draft_is_not_a_valid_target(self):
        exam_id = self.commit(fixture('listening-part-1')).data['data']['examId']
        response = self.commit(fixture('reading-passage-1'), target=exam_id, user=OTHER_TEACHER)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(MockSection.objects.filter(exam_id=exam_id).count(), 1)

    def test_ielts_full_mock_reading_counts_passages_for_readiness(self):
        from apps.core.mock_authoring import readiness
        exam_id = self.commit(fixture('ielts-academic-full')).data['data']['examId']
        items = {i['key']: i for i in readiness(TEACHER, exam_id)['items']}
        self.assertTrue(items['reading_groups']['ok'], items['reading_groups'])
        self.assertTrue(items['reading_questions']['ok'])
        self.assertTrue(items['listening_questions']['ok'])

    def test_export_uses_a_fixed_number_of_queries(self):
        from django.test.utils import CaptureQueriesContext

        from apps.core.mock_export import export_package
        small = self.commit(fixture('listening-part-1')).data['data']['examId']
        large = self.commit(fixture('ielts-academic-full')).data['data']['examId']
        counts = []
        for exam_id in (small, large):
            with CaptureQueriesContext(connection) as queries:
                export_package(TEACHER, exam_id)
            counts.append(len(queries))
        self.assertEqual(counts[0], counts[1], 'export must not issue a query per group or question')
        self.assertLessEqual(counts[1], 7)

    def test_controlled_replacement_of_one_skill(self):
        exam_id = self.commit(fixture('listening-part-1')).data['data']['examId']
        self.commit(fixture('reading-passage-1'), target=exam_id)
        reading_before = set(MockQuestion.objects.filter(group__section__exam_id=exam_id, group__section__skill='reading').values_list('id', flat=True))
        listening_ids = set(MockQuestion.objects.filter(group__section__exam_id=exam_id, group__section__skill='listening').values_list('id', flat=True))
        full = fixture('academic-reading-full')
        # Appending collides with the existing Reading 1-13 ...
        self.assertEqual(self.commit(full, target=exam_id).status_code, 409)
        # ... replacing swaps the Reading section in one transaction.
        response = self.commit(full, target=exam_id, replace=True)
        self.assertEqual(response.status_code, 201, response.data)
        reading_after = set(MockQuestion.objects.filter(group__section__exam_id=exam_id, group__section__skill='reading').values_list('id', flat=True))
        self.assertEqual(len(reading_after), 40)
        self.assertFalse(reading_before & reading_after)
        self.assertEqual(set(MockQuestion.objects.filter(group__section__exam_id=exam_id, group__section__skill='listening').values_list('id', flat=True)), listening_ids)
        self.assertEqual(MockSection.objects.filter(exam_id=exam_id, skill='reading').count(), 1)

    def test_replacement_needs_a_target_and_an_unused_draft(self):
        package = fixture('reading-passage-1')
        report = self.client.post('/v1/mock/exam-imports/validate', {'package': package}, format='json').data['data']
        response = self.client.post('/v1/mock/exam-imports', {'package': package, 'validatedChecksum': report['checksum'], 'replaceExisting': True}, format='json')
        self.assertEqual(response.status_code, 400)
        response = self.client.post('/v1/mock/exam-imports', {'package': package, 'validatedChecksum': report['checksum'], 'replaceExisting': 'yes'}, format='json')
        self.assertEqual(response.status_code, 400)
        exam_id = self.commit(package).data['data']['examId']
        MockExam.objects.filter(id=exam_id).update(is_published=True)
        again = fixture('reading-passage-1'); again['packageId'] = 'replace-published'
        locked = self.commit(again, target=exam_id, replace=True)
        self.assertEqual(locked.status_code, 409)
        self.assertEqual(locked.data['error']['code'], 'MOCK_CONTENT_LOCKED')
        self.assertEqual(MockQuestion.objects.filter(group__section__exam_id=exam_id).count(), 13)
