"""Exam Builder 2.0 completion: lifecycle states, keyless templates and the question bank.

Real views, validator, commit and PostgreSQL (legacy tables created as in the round-trip tests).
"""
from __future__ import annotations

import json

from apps.core.mock_import_validate import validate_package
from apps.legacy_schema.models import MockExam, MockQuestion, MockQuestionGroup
from tests import test_exam_templates_and_export as base

ADMIN, OTHER_TEACHER, STUDENT, TEACHER, fixture = base.ADMIN, base.OTHER_TEACHER, base.STUDENT, base.TEACHER, base.fixture


def clean_reading(package_id='clean-reading'):
    """A small, original, publishable Reading package (no placeholders, no review issues)."""
    return dict(schemaVersion='1.0', packageId=package_id, revision=1, profile='practice',
        source=dict(kind='original_practice', label='Synthetic'),
        exam=dict(type='ielts_academic', title='Clean reading', description='', level='', isDemo=False, price=0, isFreeForApproved=True,
            sections=[dict(key='reading', skill='reading', title='Reading', instructions='', durationMinutes=20, groups=[dict(
                key='p1', title='Rooftop gardens', instructions='TRUE, FALSE or NOT GIVEN.', contentHtml='', contentLayout='document', audioScript='',
                passageText='Rooftop gardens cool the buildings below them. Forty roofs were planted in one year.',
                questions=[dict(key=f'q{n}', sourceRef='synthetic', number=n, type='true_false_notgiven', prompt=f'Statement {n}.',
                                options=['TRUE', 'FALSE', 'NOT GIVEN'], correctAnswers=[k], acceptedVariants=[], points=1)
                           for n, k in ((1, 'TRUE'), (2, 'FALSE'), (3, 'NOT_GIVEN'))])])]),
        media=[], reviewIssues=[])


class CompletionBase(base.ExportRoundTripTests):
    # Reuse the legacy-table setup and helpers, not the round-trip tests themselves.

    def post(self, path, data=None, user=TEACHER):
        self.client.force_authenticate(user)
        return self.client.post(f'/v1{path}', data or {}, format='json')

    def get(self, path, user=TEACHER):
        self.client.force_authenticate(user)
        return self.client.get(f'/v1{path}')


for _name in [n for n in dir(base.ExportRoundTripTests) if n.startswith('test_')]:
    setattr(CompletionBase, _name, None)


class LifecycleTests(CompletionBase):
    def test_draft_validated_published_archived_restored(self):
        exam_id = self.commit(clean_reading()).data['data']['examId']
        exam = lambda: MockExam.objects.get(id=exam_id)
        from apps.core.mock_lifecycle import lifecycle
        self.assertEqual(lifecycle(exam()), 'draft')
        validated = self.post(f'/mock/exams/{exam_id}/validate')
        self.assertEqual(validated.status_code, 200, validated.data)
        self.assertEqual(validated.data['data']['lifecycle'], 'validated')
        # Any content change makes the validation stale (no extra write needed).
        exam_row = exam(); exam_row.content_version += 1; exam_row.save(update_fields=['content_version'])
        self.assertEqual(lifecycle(exam()), 'draft')
        self.assertEqual(self.post(f'/mock/exams/{exam_id}/validate').data['data']['lifecycle'], 'validated')
        self.client.force_authenticate(TEACHER)
        self.assertEqual(self.client.patch(f'/v1/mock/exams/{exam_id}', {'isPublished': True}, format='json').status_code, 200)
        self.assertEqual(lifecycle(exam()), 'published')
        archived = self.post(f'/mock/exams/{exam_id}/archive')
        self.assertEqual(archived.data['data']['lifecycle'], 'archived')
        self.assertFalse(exam().is_published)
        self.assertEqual(self.post(f'/mock/exams/{exam_id}/archive').status_code, 200)  # idempotent
        # Archived: no publishing, no content edits.
        self.client.force_authenticate(TEACHER)
        refused = self.client.patch(f'/v1/mock/exams/{exam_id}', {'isPublished': True}, format='json')
        self.assertEqual((refused.status_code, refused.data['error']['code']), (409, 'MOCK_EXAM_ARCHIVED'))
        group = MockQuestionGroup.objects.get(section__exam_id=exam_id)
        edit = self.client.put(f'/v1/mock/groups/{group.id}/content', {'questions': [], 'deletedQuestionIds': []}, format='json')
        self.assertEqual(edit.status_code, 409)
        self.assertEqual(MockQuestion.objects.filter(group_id=group.id).count(), 3)
        restored = self.post(f'/mock/exams/{exam_id}/restore')
        self.assertIn(restored.data['data']['lifecycle'], ('draft', 'validated'))
        self.assertFalse(exam().is_published)  # restore never republishes

    def test_validate_reports_blockers_and_lifecycle_is_staff_only(self):
        exam_id = self.commit(fixture('reading-passage-1')).data['data']['examId']
        refused = self.post(f'/mock/exams/{exam_id}/validate')
        self.assertEqual((refused.status_code, refused.data['error']['code']), (400, 'MOCK_NOT_READY'))
        self.assertTrue(refused.data['error']['details']['items'])
        self.assertIsNone(MockExam.objects.get(id=exam_id).validated_version)
        for path in ('validate', 'archive', 'restore'):
            self.assertEqual(self.post(f'/mock/exams/{exam_id}/{path}', user=STUDENT).status_code, 403)
            self.assertEqual(self.post(f'/mock/exams/{exam_id}/{path}', user=OTHER_TEACHER).status_code, 403)
        self.assertEqual(self.post(f'/mock/exams/{exam_id}/archive', user=ADMIN).status_code, 200)

    def test_staff_list_reports_lifecycle(self):
        exam_id = self.commit(clean_reading()).data['data']['examId']
        self.post(f'/mock/exams/{exam_id}/archive')
        listed = {e['id']: e for e in self.get('/mock/exams').data['data']}
        self.assertEqual(listed[exam_id]['lifecycle'], 'archived')


class TemplateExportTests(CompletionBase):
    def test_template_has_no_keys_and_reimports_as_unpublishable_draft(self):
        exam_id = self.commit(fixture('academic-reading-full')).data['data']['examId']
        response = self.get(f'/mock/exams/{exam_id}/template')
        self.assertEqual(response.status_code, 200)
        package = response.data['data']
        self.assertTrue(package['template'])
        raw = json.dumps(package)
        questions = [q for s in package['exam']['sections'] for g in s['groups'] for q in g['questions']]
        self.assertEqual(len(questions), 40)
        self.assertTrue(all(q['correctAnswers'] == [] and q['acceptedVariants'] == [] for q in questions))
        self.assertNotIn('evidenceText', raw)
        report = validate_package(package, {}, raw)
        self.assertTrue(report['canImport'], [i for i in report['issues'] if 'import' in i['blocks']][:3])
        self.assertFalse(report['canPublish'])
        self.assertIn('MISSING_ANSWER', [i['code'] for i in report['issues']])
        copy_id = self.commit(package).data['data']['examId']
        self.assertFalse(MockQuestion.objects.filter(group__section__exam_id=copy_id).exclude(correct_answers=[]).exists())
        self.client.force_authenticate(TEACHER)
        publish = self.client.patch(f'/v1/mock/exams/{copy_id}', {'isPublished': True}, format='json')
        self.assertEqual(publish.status_code, 400)

    def test_keyless_package_without_template_flag_is_still_rejected(self):
        exam_id = self.commit(clean_reading()).data['data']['examId']
        package = self.get(f'/mock/exams/{exam_id}/template').data['data']
        package.pop('template')
        self.assertFalse(validate_package(package)['canImport'])

    def test_skill_and_group_templates_and_permissions(self):
        exam_id = self.commit(fixture('ielts-academic-full')).data['data']['examId']
        reading = self.get(f'/mock/exams/{exam_id}/template?skill=reading').data['data']
        self.assertEqual([s['skill'] for s in reading['exam']['sections']], ['reading'])
        group = MockQuestionGroup.objects.filter(section__exam_id=exam_id, section__skill='listening').order_by('sort_order').first()
        one = self.get(f'/mock/exams/{exam_id}/template?groupId={group.id}').data['data']
        self.assertEqual(len(one['exam']['sections'][0]['groups']), 1)
        self.assertTrue(validate_package(one)['canImport'])
        self.assertEqual(self.get(f'/mock/exams/{exam_id}/template', user=STUDENT).status_code, 403)
        self.assertEqual(self.get(f'/mock/exams/{exam_id}/template', user=OTHER_TEACHER).status_code, 403)
        self.assertEqual(self.get(f'/mock/exams/{exam_id}/template?groupId=nope').status_code, 404)


class QuestionBankTests(CompletionBase):
    def test_search_is_scoped_to_own_exams_and_has_no_keys(self):
        mine = self.commit(fixture('reading-passage-1')).data['data']['examId']
        other_pkg = fixture('reading-passage-2')
        theirs = self.commit(other_pkg, user=OTHER_TEACHER).data['data']['examId']
        listed = self.get('/mock/question-bank/groups?section=reading').data['data']['items']
        self.assertTrue(listed)
        self.assertEqual({g['examId'] for g in listed}, {mine})
        self.assertNotIn('correctAnswers', json.dumps(listed))
        admin = self.get('/mock/question-bank/groups?section=reading&limit=100', user=ADMIN).data['data']['items']
        self.assertEqual({g['examId'] for g in admin}, {mine, theirs})
        self.assertEqual(self.get('/mock/question-bank/groups', user=STUDENT).status_code, 403)
        found = self.get('/mock/question-bank/groups?search=REPLACE').data['data']['items']
        self.assertTrue(found)

    def test_insert_copies_group_renumbers_and_stays_independent(self):
        source_id = self.commit(fixture('reading-passage-1')).data['data']['examId']
        target_id = self.commit(fixture('reading-passage-2')).data['data']['examId']  # questions 14-26
        gap_group = next(g for g in MockQuestionGroup.objects.filter(section__exam_id=source_id) if g.content_html and 'data-gap' in g.content_html)
        src_qs = list(MockQuestion.objects.filter(group_id=gap_group.id).order_by('number'))
        response = self.post(f'/mock/exams/{target_id}/bank-insert', {'groupIds': [gap_group.id]})
        self.assertEqual(response.status_code, 201, response.data)
        inserted = response.data['data']['inserted'][0]
        self.assertEqual(inserted['numbers'], list(range(27, 27 + len(src_qs))))
        copy = MockQuestionGroup.objects.get(id=inserted['groupId'])
        for n in inserted['numbers']:
            self.assertIn(f'data-gap="{n}"', copy.content_html)
        copies = list(MockQuestion.objects.filter(group_id=copy.id).order_by('number'))
        self.assertEqual([q.correct_answers for q in copies], [q.correct_answers for q in src_qs])
        copies[0].prompt = 'edited in the target only'; copies[0].save(update_fields=['prompt'])
        self.assertNotEqual(MockQuestion.objects.get(id=src_qs[0].id).prompt, 'edited in the target only')
        # The copy passes the same import-style checks (gap mapping intact).
        from apps.core.mock_authoring import readiness
        items = {i['key']: i for i in readiness(TEACHER, target_id)['items']}
        self.assertTrue(all(i['ok'] for k, i in items.items() if 'gap' in k.lower()), items)

    def test_insert_refuses_others_content_wrong_family_and_locked_targets(self):
        theirs = self.commit(fixture('reading-passage-2'), user=OTHER_TEACHER).data['data']['examId']
        their_group = MockQuestionGroup.objects.filter(section__exam_id=theirs).first()
        target = self.commit(fixture('reading-passage-1')).data['data']['examId']
        before = MockQuestion.objects.filter(group__section__exam_id=target).count()
        self.assertEqual(self.post(f'/mock/exams/{target}/bank-insert', {'groupIds': [their_group.id]}).status_code, 404)
        ml = self.commit(fixture('multilevel-reading')).data['data']['examId']
        ml_group = MockQuestionGroup.objects.filter(section__exam_id=ml).first()
        mismatch = self.post(f'/mock/exams/{target}/bank-insert', {'groupIds': [ml_group.id]})
        self.assertEqual((mismatch.status_code, mismatch.data['error']['code']), (409, 'MOCK_BANK_TYPE_MISMATCH'))
        own_group = MockQuestionGroup.objects.filter(section__exam_id=target).first()
        MockExam.objects.filter(id=target).update(is_published=True)
        self.assertEqual(self.post(f'/mock/exams/{target}/bank-insert', {'groupIds': [own_group.id]}).status_code, 409)
        self.assertEqual(MockQuestion.objects.filter(group__section__exam_id=target).count(), before)
        self.assertEqual(self.post(f'/mock/exams/{target}/bank-insert', {'groupIds': []}).status_code, 400)
        self.assertEqual(self.post(f'/mock/exams/{target}/bank-insert', {'groupIds': [own_group.id]}, user=STUDENT).status_code, 403)
