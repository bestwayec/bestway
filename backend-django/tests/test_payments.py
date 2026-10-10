from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from rest_framework.test import APIClient
from apps.core import payments
from common.api.exceptions import ContractAPIException


class PaymentTests(SimpleTestCase):
    def test_students_cannot_set_payments_or_send_reminders(self):
        client=APIClient();client.force_authenticate(SimpleNamespace(id='student',role='student',is_authenticated=True))
        for method,path in [('put','/v1/payments/bulk'),('post','/v1/payments/remind'),('get','/v1/payments/debtors')]:
            with self.subTest(path=path):
                self.assertEqual(getattr(client,method)(path,{},format='json').status_code,403)

    def test_unknown_student_prevents_all_writes(self):
        with patch.object(payments.StudentProfile.objects,'filter') as query,patch.object(payments.Payment.objects,'update_or_create') as writes:
            query.return_value.select_related.return_value=[]
            with self.assertRaises(ContractAPIException) as raised:
                payments.bulk(SimpleNamespace(id='admin',role='admin'),dict(year=2026,records=[dict(studentId='missing',month=10,state='paid')]))
            self.assertEqual(raised.exception.contract_code,'STUDENT_NOT_FOUND')
            writes.assert_not_called()

    def test_foreign_teacher_student_prevents_all_writes(self):
        with patch.object(payments.StudentProfile.objects,'filter') as query, \
             patch.object(payments,'teacher_students',return_value=[]), \
             patch.object(payments.Payment.objects,'update_or_create') as writes:
            query.return_value.select_related.return_value=[SimpleNamespace(user_id='student',user=SimpleNamespace(is_active=True))]
            with self.assertRaises(ContractAPIException) as raised:
                payments.bulk(SimpleNamespace(id='teacher',role='teacher'),dict(year=2026,records=[dict(studentId='student',month=10,state='paid')]))
            self.assertEqual(raised.exception.status_code,403)
            writes.assert_not_called()
