from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import system_settings, groups


class FoundationContractTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_all_new_mutations_deny_students_before_writes(self):
        self.client.force_authenticate(SimpleNamespace(id='student',role='student',is_authenticated=True))
        for method, url in [('patch','/v1/settings'),('put','/v1/settings/exam-program-policy'),
            ('put','/v1/settings/ielts-bands'),('delete','/v1/settings/ielts-bands'),
            ('post','/v1/groups'),('patch','/v1/groups/id'),('post','/v1/groups/id/students'),
            ('delete','/v1/groups/id/students/student')]:
            with self.subTest(url=url,method=method):
                response = getattr(self.client, method)(url, {}, format='json')
                self.assertEqual(response.status_code,403)
                self.assertEqual(response.data['error']['code'],'FORBIDDEN')

    def test_missing_auth_cannot_read_rosters_settings_or_audit(self):
        for url in ('/v1/groups','/v1/groups/id','/v1/settings','/v1/audit-logs'):
            with self.subTest(url=url):
                response=self.client.get(url)
                self.assertEqual(response.status_code,401)

    def test_teacher_cannot_read_audit(self):
        self.client.force_authenticate(SimpleNamespace(id='teacher',role='teacher',is_authenticated=True))
        self.assertEqual(self.client.get('/v1/audit-logs').status_code,403)

    def test_student_and_parent_rosters_omit_peer_phone_numbers(self):
        group=SimpleNamespace(id='group',name='English',teacher_id=None,schedule=[],created_at=None)
        roster=[SimpleNamespace(user_id='student',user=SimpleNamespace(name='Student',phone='private',is_active=True),is_approved=True,current_points=100)]
        with patch.object(groups,'get_group',return_value=group), patch.object(groups.StudentProfile.objects,'filter') as query, patch.object(groups,'child_ids',return_value=['student']):
            query.return_value.select_related.return_value.order_by.return_value=roster
            for role in ('student','parent'):
                result=groups.detail(SimpleNamespace(role=role,id='student'),'group')
                self.assertNotIn('phone',result['students'][0])
            result=groups.detail(SimpleNamespace(role='admin',id='admin'),'group')
            self.assertEqual(result['students'][0]['phone'],'private')

    def test_corrupt_band_setting_falls_back_without_hiding_customization(self):
        with patch.object(system_settings,'get_json',return_value=[[1,9]]):
            self.assertEqual(system_settings.band_tables()['listening'],system_settings.LISTENING)

    def test_invalid_band_table_prevents_any_settings_write(self):
        self.client.force_authenticate(SimpleNamespace(id='super',role='super_admin',is_authenticated=True))
        with patch.object(system_settings,'band_tables',return_value={}), patch.object(system_settings,'set_value') as write, patch('apps.core.system_settings.transaction.atomic'):
            # Service transaction behavior itself is exercised against real PostgreSQL.
            response=self.client.put('/v1/settings/ielts-bands',{'listening':'not-array'},format='json')
            self.assertEqual(response.status_code,400)
            write.assert_not_called()
