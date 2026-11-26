"""Actual worker subprocesses and loopback HTTP provider in a disposable schema.

No live provider credentials, reference backend, or production requests are used.
"""
import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from types import SimpleNamespace
from urllib.parse import parse_qsl, unquote, urlencode, urlparse, urlunparse
from uuid import uuid4

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
parsed = urlparse(os.environ['DATABASE_URL'])
if parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Local PostgreSQL required')
query = dict(parse_qsl(parsed.query)); query.pop('schema', None)
base = urlunparse(parsed._replace(query=urlencode(query)))
schema = 'release_worker_' + uuid4().hex[:12]
db = psycopg.connect(base, autocommit=True)
report = dict(gates=[], provider='loopback fixture ONLY', liveProviders='UNVERIFIED')
fixture = dict(status=200, result=None, calls=0)
provider_entered = Event()
provider_release = Event()


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        assert self.path == '/chat/completions'
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert payload['model'] == 'deepseek/deepseek-v4.1-flash-1017:free'
        fixture['calls'] += 1
        if fixture.get('block'):
            provider_entered.set()
            assert provider_release.wait(20)
        body = json.dumps(dict(choices=[dict(finish_reason='stop', message=dict(role='assistant',
            content=json.dumps(fixture['result'])))], usage=dict(prompt_tokens=10, completion_tokens=20))).encode()
        self.send_response(fixture['status'])
        if fixture['status'] == 429:
            self.send_header('Retry-After', '67')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


server = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
thread = Thread(target=server.serve_forever, daemon=True); thread.start()
created = False
try:
    dump = subprocess.run(['pg_dump', '--schema-only', '--no-owner', '--no-privileges', '--schema=public',
        '--host', parsed.hostname, '--port', str(parsed.port or 5432), '--username', unquote(parsed.username or ''),
        '--dbname', unquote(parsed.path.lstrip('/'))], env=dict(os.environ, PGPASSWORD=unquote(parsed.password or '')),
        capture_output=True, text=True, encoding='utf-8', timeout=30)
    if dump.returncode: raise RuntimeError('Local schema dump failed')
    ddl = '\n'.join(line for line in dump.stdout.splitlines() if not line.startswith('\\') and line.strip() != 'CREATE SCHEMA public;')
    db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema))); created = True
    db.execute(ddl.replace('public.', schema+'.').replace('SCHEMA public', 'SCHEMA '+schema), prepare=False)
    db.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
    env = dict(os.environ, DATABASE_URL=urlunparse(parsed._replace(query=urlencode(dict(query, schema=schema)))),
        DJANGO_SETTINGS_MODULE='config.settings.local', JWT_SECRET='local-worker-verification-only',
        ASSESSMENT_PROVIDER='openrouter', OPENROUTER_API_KEY='local-fixture-only',
        OPENROUTER_EVAL_MODEL='deepseek/deepseek-v4.1-flash-1017:free',
        OPENROUTER_BASE_URL=f'http://127.0.0.1:{server.server_port}',
        ASSESSMENT_ADJUDICATION_ENABLED='false', ASSESSMENT_WORKER_ENABLED='true', REFERENCE_DB_TIMEZONE='UTC',
        STT_BASE_URL=f'http://127.0.0.1:{server.server_port}', STT_API_KEY='', STT_MODEL='')
    os.environ.update(env)
    import django
    django.setup()
    from concurrent.futures import ThreadPoolExecutor
    from django.db import connections
    from apps.core import assessment, assessment_results as rubric
    from apps.legacy_schema.models import AssessmentJob, AuditLog
    from common.api.exceptions import ContractAPIException
    from apps.core.mock_import_validate import canonical_checksum
    student, exam, section, group, question, attempt = [str(uuid4()) for _ in range(6)]
    db.execute('INSERT INTO "User" (id,name,phone,"passwordHash",role,"updatedAt") VALUES (%s,\'Local worker\',\'+worker-fixture\',\'unused\',\'student\',NOW())', (student,))
    db.execute('INSERT INTO "StudentProfile" ("userId","linkCode") VALUES (%s,\'worker-fixture\')', (student,))
    db.execute('INSERT INTO "MockExam" (id,type,title,"updatedAt") VALUES (%s,\'ielts_academic\',\'Worker fixture\',NOW())', (exam,))
    db.execute('INSERT INTO "MockSection" (id,"examId",skill) VALUES (%s,%s,\'writing\')', (section,exam))
    db.execute('INSERT INTO "MockQuestionGroup" (id,"sectionId",title) VALUES (%s,%s,\'Task 1\')', (group,section))
    db.execute('INSERT INTO "MockQuestion" (id,"groupId",number,type,prompt,points) VALUES (%s,%s,1,\'essay_task1\',\'Describe\',9)', (question,group))
    db.execute('INSERT INTO "MockAttempt" (id,"examId","studentId",status,"submittedAt") VALUES (%s,%s,%s,\'grading\',NOW())', (attempt,exam,student))
    db.execute('INSERT INTO "MockAnswer" (id,"attemptId","questionId",response,"updatedAt") VALUES (%s,%s,%s,\'Original essay\',NOW())', (str(uuid4()),attempt,question))
    snapshot = dict(program='IELTS_ACADEMIC', skill='writing', specificationVersion=None, speakingProfileVersion=None,
        rubricVersion='IELTS_WRITING_RUBRIC_V1', promptVersion='BESTWAY_ASSESSMENT_PROMPT_2026_V1', pronunciationEvidence='UNAVAILABLE',
        parts=[dict(id='task1:'+question, max=9, weight=1, task='Describe', context='', responses=[dict(questionId=question,
            prompt='Describe', originalResponse='Original essay', partNumber=1)])])
    result = rubric.empty(snapshot); result['confidence'] = .95
    result['parts'][0].update(rawScore=6, criteria={k:6 for k in rubric.keys(snapshot)}, evidence={k:'Local fixture evidence' for k in rubric.keys(snapshot)})
    fixture['result'] = result

    def seed(generation, status='PENDING', **extra):
        identifier = str(uuid4())
        values = dict(id=identifier, attemptId=attempt, studentId=student, program=snapshot['program'], skill='writing',
            inputHash=canonical_checksum(snapshot), inputSnapshot=json.dumps(snapshot), rubricVersion=snapshot['rubricVersion'],
            promptVersion=snapshot['promptVersion'], policyMode='PRACTICE_AUTO_AI', status=status, generation=generation, **extra)
        db.execute(sql.SQL('INSERT INTO "AssessmentJob" ({},"updatedAt") VALUES ({},NOW())').format(
            sql.SQL(',').join(map(sql.Identifier,values)), sql.SQL(',').join(sql.Placeholder() for _ in values)), list(values.values()))
        return identifier

    def worker(command='run_assessment_worker'):
        process = subprocess.run([sys.executable, 'manage.py', command, '--once'], cwd=ROOT, env=env,
            capture_output=True, text=True, timeout=60, creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if process.returncode: raise RuntimeError(command+' failed: '+process.stderr[-1500:])

    def state(identifier):
        return db.execute('SELECT status,"attemptCount","failureCode","finalScore" FROM "AssessmentJob" WHERE id=%s', (identifier,)).fetchone()

    first = seed(1); worker()
    assert state(first) == ('NEEDS_REVIEW',1,'TEACHER_CONFIRMATION_REQUIRED',None), state(first)
    assert db.execute('SELECT status FROM "MockAttempt" WHERE id=%s',(attempt,)).fetchone() == ('grading',)
    assert fixture['calls'] == 1
    report['gates'].append('PASS actual worker + loopback OpenRouter HTTP persists an advisory result without a final grade')
    worker(); assert fixture['calls'] == 1 and state(first)[1] == 1
    report['gates'].append('PASS new process/restart does not redeliver completed job')
    fixture['status'] = 429
    retry = seed(2); worker(); assert state(retry)[:3] == ('RETRY',1,'PROVIDER_RATE_LIMITED'),state(retry)
    assert db.execute('SELECT status FROM "AssessmentEvaluation" WHERE "jobId"=%s',(retry,)).fetchall() == [('FAILED',)]
    assert db.execute('SELECT "retryAt" - "updatedAt" FROM "AssessmentJob" WHERE id=%s',(retry,)).fetchone()[0].total_seconds() >= 67
    fixture['status'] = 200
    db.execute('UPDATE "AssessmentJob" SET "retryAt"=\'2000-01-01\' WHERE id=%s',(retry,))
    worker(); assert state(retry) == ('NEEDS_REVIEW',2,'TEACHER_CONFIRMATION_REQUIRED',None),state(retry)
    report['gates'].append('PASS 429 failure ledger, durable retry and recovery in a fresh worker process')
    expired = seed(3,'PROCESSING',attemptCount=1,leaseToken='expired',leaseExpiresAt='2000-01-01')
    db.execute('INSERT INTO "AssessmentEvaluation" (id,"jobId",role,"attemptNumber","inputHash",provider,model) VALUES (%s,%s,\'PRIMARY\',1,%s,\'fixture\',\'fixture\')',(str(uuid4()),expired,canonical_checksum(snapshot)))
    before = fixture['calls']; worker()
    assert state(expired)[:3] == ('NEEDS_REVIEW',1,'PROVIDER_OUTCOME_UNCERTAIN') and fixture['calls'] == before
    report['gates'].append('PASS crashed STARTED provider ledger is not automatically billed again after restart')
    # The provider is in flight while a teacher commits. Worker and review
    # use separate real connections and both check the lease/version.
    staff = str(uuid4())
    db.execute("""INSERT INTO "User" (id,name,phone,"passwordHash",role,"updatedAt")
        VALUES (%s,'Synthetic grade reviewer','+worker-reviewer','unused','admin',NOW())""", (staff,))
    reviewer = SimpleNamespace(id=staff, role='admin')
    race = seed(4)
    fixture['block'] = True
    with ThreadPoolExecutor(max_workers=2) as pool:
        running = pool.submit(worker)
        assert provider_entered.wait(20), 'Provider was not entered'
        try:
            current = AssessmentJob.objects.get(id=race)
            assert current.status == 'PROCESSING'
            review = dict(action='OVERRIDE', expectedVersion=current.version, reason='Reviewed the original',
                parts=[dict(id=snapshot['parts'][0]['id'], criteria={k:7 for k in rubric.keys(snapshot)})])
            draft = assessment.review(reviewer, race, dict(review, action='SAVE_DRAFT', parts=[
                dict(id=snapshot['parts'][0]['id'], criteria={'ta':7}),
            ]))
            assert state(race)[0] == 'PROCESSING' and state(race)[3] is None
            assert AuditLog.objects.filter(entity_id=race, action='assessment.save_draft').exists()
            final = assessment.review(reviewer, race, dict(review, expectedVersion=draft['version']))
        finally:
            provider_release.set()
        running.result(timeout=30)
        assert state(race) == ('SUCCEEDED',1,None,7), state(race)
        assert db.execute('SELECT response,score FROM "MockAnswer" WHERE "attemptId"=%s',(attempt,)).fetchone() == ('Original essay',7)
        assert not db.execute("SELECT 1 FROM \"AssessmentEvaluation\" WHERE \"jobId\"=%s AND status='SUCCEEDED'",(race,)).fetchone()
        report['gates'].append('PASS teacher saves draft and finalizes during real provider request; late completion preserves student response and teacher grade')

        def revise():
            try:
                assessment.review(reviewer, race, dict(review, expectedVersion=final['version']))
                return 'ok'
            except ContractAPIException as error:
                return error.contract_code
            finally:
                connections.close_all()

        revisions = [pool.submit(revise), pool.submit(revise)]
        assert sorted(f.result(timeout=20) for f in revisions) == ['ASSESSMENT_STALE_VERSION', 'ok']
        report['gates'].append('PASS two teacher revisions on the same version produce one commit and one stale conflict')
    fixture['block'] = False
    recovery = seed(5, 'PROCESSING', attemptCount=1, leaseToken='expired-after-output', leaseExpiresAt='2000-01-01')
    db.execute("""INSERT INTO "AssessmentEvaluation"
        (id,"jobId",role,"attemptNumber","inputHash",provider,model,status,result,"completedAt")
        VALUES (%s,%s,'PRIMARY',1,%s,'openrouter','previous-model','SUCCEEDED',%s,NOW())""",
        (str(uuid4()), recovery, canonical_checksum(snapshot), json.dumps(fixture['result'])))
    before = fixture['calls']
    worker()
    if state(recovery)[0] == 'RETRY':
        worker()
    assert state(recovery)[:3] == ('NEEDS_REVIEW',2,'ASSESSMENT_PROVIDER_CHANGED'), state(recovery)
    assert fixture['calls'] == before, fixture['calls']
    report['gates'].append('PASS a saved evaluation for a different model is sent to review without a second provider request')

    from unittest.mock import patch

    from apps.core import assessment_provider_policy as policy
    from apps.core.assessment_results import ProviderError

    def rejected(code, request):
        try:
            request()
        except ProviderError as error:
            assert error.code == code
        else:
            raise AssertionError(f'Expected {code}')

    with patch.dict(os.environ, dict(ASSESSMENT_DAILY_BUDGET='4', ASSESSMENT_PAID_DAILY_REQUESTS='2',
            ASSESSMENT_PAID_DAILY_BUDGET_MICROUSD='100')):
        policy.reserve_request('openrouter', policy.FREE_MODEL)
        policy.reserve_request('openrouter', 'approved-fixture', paid_microusd=60)
        rejected('ASSESSMENT_PAID_BUDGET_EXHAUSTED',
            lambda: policy.reserve_request('openrouter', 'approved-fixture', paid_microusd=41))
        policy.reserve_request('groq', 'fixture')
        policy.reserve_request('groq', 'fixture')
        rejected('ASSESSMENT_DAILY_BUDGET_EXHAUSTED', lambda: policy.reserve_request('groq', 'fixture'))
        assert AuditLog.objects.filter(entity=policy.USAGE_ENTITY).count() == 4
    report['gates'].append('PASS PostgreSQL daily request and paid amount reservations reject exhausted budgets')
    worker('run_game_scheduler'); worker('run_game_scheduler')
    report['gates'].append('PASS actual game scheduler startup/restart commands (monthly rollover covered separately by PostgreSQL contracts)')
except Exception as error:
    report['error'] = type(error).__name__+': '+str(error)
finally:
    server.shutdown(); server.server_close(); thread.join(timeout=5)
    if created:
        if not re.fullmatch(r'release_worker_[a-f0-9]{12}',schema): raise RuntimeError('Unsafe schema cleanup')
        db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
    db.close()
    report['cleanup'] = 'only generated schema and owned loopback provider removed'
    evidence = Path(os.environ.get('VERIFY_REPORT_DIR', str(ROOT/'evidence'/'release-20261009'))); evidence.mkdir(parents=True,exist_ok=True)
    (evidence/'WORKER_REPORT.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))
sys.exit(1 if report.get('error') else 0)
