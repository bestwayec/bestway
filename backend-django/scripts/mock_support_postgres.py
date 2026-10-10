"""Real local PostgreSQL locks, fault injection and persisted support results."""
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch
from urllib.request import Request,urlopen
from django.db import close_old_connections,connections
from psycopg import sql


def run(call,ids,db,schemas,results,clone,attempt):
    from apps.core import mock_support as service
    from apps.core.mock_submissions import submit
    from apps.legacy_schema.models import MockAttempt,MockPurchase,MockAnswer,Notification,AssessmentJob,AuditLog
    from common.api.exceptions import ContractAPIException
    actor=SimpleNamespace(id=ids[0]['admin'],role='admin')
    student=SimpleNamespace(id=ids[0]['other_student'],role='student')
    def parallel(functions):
        barrier=Barrier(len(functions))
        def run_one(function):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                try: return function()
                except ContractAPIException as error: return dict(error=error.contract_code)
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=len(functions)) as pool: return list(pool.map(run_one,functions))
    aid=attempt('support_pg_force')
    before=Notification.objects.count(); audit_before=AuditLog.objects.count()
    with patch('apps.core.mock_submission_snapshots.notify',side_effect=RuntimeError('synthetic crash')):
        try: submit(actor,aid,force=True)
        except RuntimeError: pass
        else: raise AssertionError('Missing rollback fault')
    row=MockAttempt.objects.get(id=aid)
    assert row.status=='in_progress' and row.raw_scores is None and row.submitted_at is None
    assert Notification.objects.count()==before and AuditLog.objects.count()==audit_before and not AssessmentJob.objects.filter(attempt_id=aid).exists()
    values=parallel([lambda:submit(actor,aid,force=True)]*2)
    assert sum(v.get('status')=='completed' for v in values)==1 and sum(v.get('error')=='MOCK_ATTEMPT_FINISHED' for v in values)==1
    assert Notification.objects.count()==before+2 and AuditLog.objects.count()==audit_before+1
    def nest_post(path,payload,role='admin'):
        request=Request(call.reference_base+path,data=json.dumps(payload).encode(),method='POST',headers={'Authorization':'Bearer '+call.tokenmaps[1][role],'Content-Type':'application/json'})
        with urlopen(request,timeout=20) as response: assert response.status==201
    nest_post('/v1/mock/attempts/'+aid+'/force-submit',{})
    call('GET','/v1/mock/attempts/{support_pg_force}',role='student',label='C:PG:force-concurrent-persisted')
    aid=attempt('support_pg_manual_force')
    owner=SimpleNamespace(id=ids[0]['student'],role='student')
    before=Notification.objects.count()
    values=parallel([lambda:submit(owner,aid),lambda:submit(actor,aid,force=True)])
    assert any(v.get('status')=='completed' for v in values)
    assert Notification.objects.count()==before+2
    assert MockAttempt.objects.get(id=aid).status=='completed'
    # Reproduce the winning claim, not the race's transient response, in Nest.
    if values[1].get('error'):
        nest_post('/v1/mock/attempts/'+aid+'/submit',{},'student')
    else:
        nest_post('/v1/mock/attempts/'+aid+'/force-submit',{})
    call('GET','/v1/mock/attempts/{support_pg_manual_force}',role='student',label='C:PG:manual-force-single-finalization')
    # Timed clock extensions accumulate, never overwrite a competing extension.
    aid=attempt('support_pg_extend',deadlineAt='2026-01-01T10:00:00',overallDeadlineAt=None,sectionDeadlines=None)
    values=parallel([lambda:service.extend(actor,aid,5)]*2)
    assert all(v.get('saved') for v in values) and MockAttempt.objects.get(id=aid).deadline_at.minute==10
    nest_post('/v1/mock/attempts/'+aid+'/extend',dict(minutes=5)); nest_post('/v1/mock/attempts/'+aid+'/extend',dict(minutes=5))
    call('GET','/v1/mock/attempts/{support_pg_extend}',role='admin',label='C:PG:extension-accumulation')
    exam=ids[0]['support_paid']; before=Notification.objects.count(); audit_before=AuditLog.objects.count()
    with patch('apps.core.mock_support.notify',side_effect=RuntimeError('synthetic crash')):
        try: service.confirm(actor,exam,student.id)
        except RuntimeError: pass
        else: raise AssertionError('Missing purchase rollback')
    assert not MockPurchase.objects.filter(exam_id=exam,user_id=student.id).exists()
    assert Notification.objects.count()==before and AuditLog.objects.count()==audit_before
    values=parallel([lambda:service.purchase(student,exam)]*2)
    assert values==[dict(status='pending_confirmation',amount=120)]*2 and MockPurchase.objects.filter(exam_id=exam,user_id=student.id).count()==1
    nest_post('/v1/mock/exams/'+exam+'/purchase',{},'other_student'); nest_post('/v1/mock/exams/'+exam+'/purchase',{},'other_student')
    call('GET','/v1/mock/purchases',label='C:PG:purchase-uniqueness')
    # Ledger content remains unchanged when a grading attempt is reopened.
    aid=attempt('support_pg_reopen','support_pending_force')
    snapshots=list(AssessmentJob.objects.filter(attempt_id=ids[0]['support_pending_force']).values_list('input_hash','input_snapshot'))
    service.reopen(actor,aid)
    assert MockAttempt.objects.get(id=aid).raw_scores==MockAttempt.objects.get(id=ids[0]['support_pending_force']).raw_scores
    assert list(AssessmentJob.objects.filter(attempt_id=ids[0]['support_pending_force']).values_list('input_hash','input_snapshot'))==snapshots
    nest_post('/v1/mock/attempts/'+aid+'/reopen',{})
    call('GET','/v1/mock/attempts/{support_pg_reopen}',role='student',label='C:PG:reopen-retains-history')
    results.append(dict(method='PG',path='mock-support-locks-rollback',label='C:PG:concurrency-rollback',status='PASS',database='PASS',checks=18))
