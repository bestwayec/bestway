from datetime import date
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import attendance, attendance_views
from common.api.exceptions import ContractAPIException


class AttendanceTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    def test_all_routes_require_authentication(self):
        for method, path in [('get','/v1/attendance'),('get','/v1/attendance/stats'),
                             ('put','/v1/attendance/bulk'),('get','/v1/stats/export/attendance')]:
            with self.subTest(path=path):
                self.assertEqual(getattr(self.client,method)(path,{},format='json').status_code,401)

    def test_no_student_parent_or_invented_receptionist_mutation_permissions(self):
        for role in ('student','parent','receptionist'):
            self.client.force_authenticate(SimpleNamespace(id='user',role=role,is_authenticated=True))
            for method,path in [('put','/v1/attendance/bulk'),('get','/v1/attendance/stats'),('get','/v1/stats/export/attendance')]:
                with self.subTest(role=role,path=path):
                    self.assertEqual(getattr(self.client,method)(path,{},format='json').status_code,403)

    def test_teacher_cannot_export_even_own_group(self):
        self.client.force_authenticate(SimpleNamespace(id='teacher',role='teacher',is_authenticated=True))
        self.assertEqual(self.client.get('/v1/stats/export/attendance?groupId=own').status_code,403)

    def test_foreign_teacher_cannot_write_before_membership_queries(self):
        with patch.object(attendance,'get_group',return_value=SimpleNamespace(teacher_id='other')), \
             patch.object(attendance.StudentProfile.objects,'filter') as query:
            with self.assertRaises(ContractAPIException) as raised:
                attendance.bulk(SimpleNamespace(id='teacher',role='teacher'),dict(groupId='foreign',date='2026-10-01',records=[]))
            self.assertEqual(raised.exception.status_code,403)
            query.assert_not_called()

    def test_calendar_date_uses_slice_not_timezone_and_preserves_overflow(self):
        self.assertEqual(attendance.reference_date('2026-10-01T00:30:00+05:00'),date(2026,10,1))
        self.assertEqual(attendance.reference_date('2026-02-31'),date(2026,3,3))
        self.assertEqual(attendance.reference_date('2026-10'),date(2026,10,1))
        self.assertEqual(attendance.reference_date('-0001-10-01'),date(2000,1,9))

    def test_valid_iso_week_can_fail_reference_date_parsing(self):
        self.assertIsNotNone(attendance_views.ISO8601.fullmatch('2026-W41-1'))
        with self.assertRaises(ContractAPIException) as raised:
            attendance.reference_date('2026-W41-1')
        self.assertEqual(raised.exception.status_code,500)

    def test_mass_assignment_and_invalid_state_do_not_reach_service(self):
        self.client.force_authenticate(SimpleNamespace(id='admin',role='admin',is_authenticated=True))
        with patch.object(attendance,'bulk') as write:
            for record in [dict(studentId='student',state='present',markedById='foreign'),dict(studentId='student',state='bad')]:
                response=self.client.put('/v1/attendance/bulk',dict(groupId='group',date='2026-10-01',records=[record]),format='json')
                self.assertEqual(response.status_code,400)
            write.assert_not_called()

    def test_csv_formula_protection_and_escaping_match_reference(self):
        self.assertEqual(attendance.csv_cell('=SUM(A1);"x"'), '"\'=SUM(A1);""x"""')
        self.assertEqual(attendance.csv_cell('plain'), 'plain')

    def test_student_id_query_cannot_override_student_identity(self):
        with patch.object(attendance,'month_rows') as query:
            query.return_value.filter.return_value.order_by.return_value=[]
            attendance.listing(SimpleNamespace(id='self',role='student'),dict(studentId='foreign'))
            query.return_value.filter.assert_called_once_with(student_id='self')

    def test_parent_foreign_student_is_rejected_without_attendance_read(self):
        with patch.object(attendance,'month_rows') as query,patch.object(attendance,'child_ids',return_value=['child']):
            with self.assertRaises(ContractAPIException) as raised:
                attendance.listing(SimpleNamespace(id='parent',role='parent'),dict(studentId='foreign'))
            self.assertEqual(raised.exception.contract_message,"Bu o'quvchi sizga bog'lanmagan")
            query.return_value.filter.assert_not_called()

    def test_native_upsert_never_overwrites_creation_timestamp(self):
        with patch('apps.core.attendance.connection') as connection:
            attendance.upsert('student','group',date(2026,10,1),'present','staff',None)
            statement=connection.cursor.return_value.__enter__.return_value.execute.call_args.args[0]
            self.assertNotIn('createdAt',statement.split('DO UPDATE SET')[1])
            self.assertIn('ON CONFLICT',statement)
