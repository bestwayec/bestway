"""Actual worker subprocesses and loopback HTTP provider in a disposable schema.

No live provider credentials, reference backend, or production requests are used.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, unquote
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


class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        assert self.path == '/responses'
        payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert payload['model'] == 'local-fixture'
        fixture['calls'] += 1
        body = json.dumps(dict(status='completed', output=[dict(type='message', status='completed', role='assistant',
            content=[dict(type='output_text', text=json.dumps(fixture['result']))])], usage=dict(input_tokens=10, output_tokens=20))).encode()
        self.send_response(fixture['status']); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)


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
        DEEPSEEK_API_KEY='local-fixture-not-a-live-key', DEEPSEEK_MODEL='local-fixture',
        DEEPSEEK_ADJUDICATOR_MODEL='local-fixture', DEEPSEEK_BASE_URL=f'http://127.0.0.1:{server.server_port}',
        ASSESSMENT_ADJUDICATION_ENABLED='false', ASSESSMENT_WORKER_ENABLED='true', REFERENCE_DB_TIMEZONE='UTC',
        STT_BASE_URL=f'http://127.0.0.1:{server.server_port}', STT_API_KEY='', STT_MODEL='')
    os.environ.update(env)
    import django
    django.setup()
    from apps.core import assessment_results as rubric
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
    assert state(first) == ('SUCCEEDED',1,None,6), state(first)
    assert db.execute('SELECT status FROM "MockAttempt" WHERE id=%s',(attempt,)).fetchone() == ('completed',)
    assert fixture['calls'] == 1
    report['gates'].append('PASS actual management worker + real loopback provider HTTP + persisted final score/attempt')
    worker(); assert fixture['calls'] == 1 and state(first)[1] == 1
    report['gates'].append('PASS new process/restart does not redeliver completed job')
    fixture['status'] = 429
    retry = seed(2); worker(); assert state(retry)[:3] == ('RETRY',1,'PROVIDER_RATE_LIMITED'),state(retry)
    assert db.execute('SELECT status FROM "AssessmentEvaluation" WHERE "jobId"=%s',(retry,)).fetchall() == [('FAILED',)]
    fixture['status'] = 200
    db.execute('UPDATE "AssessmentJob" SET "retryAt"=\'2000-01-01\' WHERE id=%s',(retry,))
    worker(); assert state(retry) == ('SUCCEEDED',2,None,6),state(retry)
    report['gates'].append('PASS 429 failure ledger, durable retry and recovery in a fresh worker process')
    expired = seed(3,'PROCESSING',attemptCount=1,leaseToken='expired',leaseExpiresAt='2000-01-01')
    db.execute('INSERT INTO "AssessmentEvaluation" (id,"jobId",role,"attemptNumber","inputHash",provider,model) VALUES (%s,%s,\'PRIMARY\',1,%s,\'fixture\',\'fixture\')',(str(uuid4()),expired,canonical_checksum(snapshot)))
    before = fixture['calls']; worker()
    assert state(expired)[:3] == ('NEEDS_REVIEW',1,'PROVIDER_OUTCOME_UNCERTAIN') and fixture['calls'] == before
    report['gates'].append('PASS crashed STARTED provider ledger is not automatically billed again after restart')
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
    evidence = ROOT/'evidence'/'release-20261009'; evidence.mkdir(parents=True,exist_ok=True)
    (evidence/'WORKER_REPORT.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))
sys.exit(1 if report.get('error') else 0)
