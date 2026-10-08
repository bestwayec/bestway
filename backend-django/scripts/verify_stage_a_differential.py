"""Real JWT/API comparison in two disposable local PostgreSQL schemas.

The reference never loads application jobs or external-service configuration.
Only UUIDs and ISO timestamps are normalized. Each mismatch remains a failure.
"""
import copy
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import shutil
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
STAGE_B = os.environ.get('VERIFY_STAGE_B') == '1'
REPORT_PATH = ROOT / ('STAGE_B_PARITY_REPORT.json' if STAGE_B else 'STAGE_A_PARITY_REPORT.json')
sys.path.insert(0, str(ROOT))
raw_url = os.environ.get('DATABASE_URL', '')
parsed = urlparse(raw_url)
if parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
    raise SystemExit('Refusing non-local database')
query = dict(parse_qsl(parsed.query)); query.pop('schema', None)
connection_url = urlunparse(parsed._replace(query=urlencode(query)))
prefix = 'stage_a_diff_' + uuid4().hex
schemas = [prefix + '_django', prefix + '_nest']
created = []
server = None
storage = None
results = []
ids = [{}, {}]
db = psycopg.connect(connection_url, autocommit=True)

def schema_url(schema):
    return urlunparse(parsed._replace(query=urlencode(dict(query, schema=schema))))

uuid_keys = {}


def normalize(value):
    if isinstance(value, dict):
        return {uuid_keys.get(k, normalize(k)): normalize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, str):
        value = re.sub(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '<UUID>', value)
        return re.sub(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)?', '<TIMESTAMP>', value)
    return value

try:
    from urllib.parse import unquote
    dump_env = dict(os.environ, PGPASSWORD=unquote(parsed.password or ''))
    dump = subprocess.run(['pg_dump', '--schema-only', '--no-owner', '--no-privileges', '--schema=public',
        '--host', parsed.hostname, '--port', str(parsed.port or 5432), '--username', unquote(parsed.username or ''),
        '--dbname', unquote(parsed.path.lstrip('/'))], env=dump_env, capture_output=True, text=True, encoding='utf-8', timeout=30)
    if dump.returncode: raise RuntimeError('Local schema dump failed: ' + dump.stderr)
    ddl = '\n'.join(line for line in dump.stdout.splitlines() if not line.startswith('\\') and line.strip() != 'CREATE SCHEMA public;')
    for schema in schemas:
        db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        created.append(schema)
        db.execute(ddl.replace('public.', schema + '.').replace('SCHEMA public', 'SCHEMA ' + schema), prepare=False)
        db.execute(sql.SQL('SET search_path TO {}, public').format(sql.Identifier(schema)))
        for index, role in enumerate(('student', 'teacher', 'admin', 'super_admin')):
            user_id = str(uuid4())
            ids[schemas.index(schema)][role] = user_id
            db.execute(sql.SQL('INSERT INTO {}."User" (id,name,phone,"passwordHash",role,"isActive","createdAt","updatedAt") VALUES (%s,%s,%s,%s,%s,true,NOW(),NOW())').format(sql.Identifier(schema)),
                (user_id, role, '+fixture' + str(index), 'unused', role))
            if role == 'student':
                db.execute(sql.SQL('INSERT INTO {}."StudentProfile" ("userId","linkCode","availablePrograms","activeProgram") VALUES (%s,%s,ARRAY[\'IELTS\',\'MULTILEVEL\']::"ExamProgram"[],\'IELTS\')').format(sql.Identifier(schema)), (user_id, 'fixture-link'))
    os.environ['DATABASE_URL'] = schema_url(schemas[0])
    os.environ['JWT_SECRET'] = 'local-stage-a-differential-secret-no-production'
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings.local'
    os.environ['ALLOWED_HOSTS'] = 'testserver,localhost,127.0.0.1'
    import django
    django.setup()
    from django.conf import settings
    from rest_framework.test import APIClient
    from django.core.files.uploadedfile import SimpleUploadedFile
    from common.auth.jwt import issue_access
    tokens = [{role: issue_access(uid, role) for role, uid in side.items()} for side in ids]
    with tempfile.TemporaryDirectory(prefix='bestway-stage-a-diff-', dir=ROOT, delete=False) as storage:
        settings.MEDIA_ROOT = str(Path(storage) / 'django')
        env = {k: v for k, v in os.environ.items() if k not in ('DEEPGRAM_API_KEY', 'DEEPSEEK_API_KEY', 'REDIS_URL')}
        env.update(DATABASE_URL=schema_url(schemas[1]), STORAGE_DIR=str(Path(storage) / 'nest'))
        server = subprocess.Popen(['node', str(ROOT / 'scripts/nest_stage_a_server.cjs')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', env=env)
        line = server.stdout.readline()
        if not line:
            raise RuntimeError('Nest startup failed: ' + server.stderr.read())
        port = json.loads(line)['port']
        client = APIClient()
        from apps.core import mock_media
        upload_sequence = 0
        def fixture_upload_uuid():
            global upload_sequence
            upload_sequence += 1
            return f'00000000-0000-4000-8000-{upload_sequence:012d}'
        mock_media.uuid4 = fixture_upload_uuid

        def database_state(side):
            state = {}
            tables = ('MockExam', 'MockSection', 'MockQuestionGroup', 'MockQuestion', 'MockExamImport', 'MockImportSourceMap', 'MockImportReviewIssue', 'MockStagedMedia', 'MockAttempt')
            if STAGE_B:
                tables += ('MockAnswer', 'MockCheatEvent', 'AssessmentJob')
            for table in tables:
                rows = db.execute(sql.SQL('SELECT row_to_json(t) FROM {}.{} t').format(sql.Identifier(schemas[side]), sql.Identifier(table))).fetchall()
                state[table] = sorted((normalize(row[0]) for row in rows), key=lambda value: json.dumps(value, sort_keys=True))
            return state

        def call(method, path, body=None, *, role='admin', files=None, label=None):
            responses = []
            for side in (0, 1):
                target = path.format(**ids[side])
                def expand(value):
                    if isinstance(value, dict): return {k: expand(v) for k, v in value.items()}
                    if isinstance(value, list): return [expand(v) for v in value]
                    if isinstance(value, str) and re.fullmatch(r'\{\w+\}', value): return value.format(**ids[side])
                    return value
                payload = expand(body)
                headers = {'Authorization': 'Bearer ' + tokens[side][role]} if role else {}
                if side == 0:
                    client.credentials(**({'HTTP_AUTHORIZATION': headers['Authorization']} if role else {}))
                    if files:
                        data = {name: SimpleUploadedFile(filename, content, content_type=mime) for name, (filename, content, mime) in files.items()}
                        response = getattr(client, method.lower())(target, data, format='multipart')
                    else:
                        response = getattr(client, method.lower())(target, payload or {}, format='json')
                    result = dict(status=response.status_code, body=json.loads(response.content) if hasattr(response, 'data') else dict(bytes=list(b''.join(response.streaming_content))))
                else:
                    if files:
                        boundary = 'stage-a-fixture-boundary'
                        chunks = []
                        for name, (filename, content, mime) in files.items():
                            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + content + b'\r\n')
                        data = b''.join(chunks) + f'--{boundary}--\r\n'.encode()
                        headers['Content-Type'] = 'multipart/form-data; boundary=' + boundary
                    else:
                        data = json.dumps(payload).encode() if payload is not None else None
                        headers['Content-Type'] = 'application/json'
                    request = Request(f'http://127.0.0.1:{port}' + target, data=data, headers=headers, method=method)
                    try:
                        response = urlopen(request, timeout=20)
                    except HTTPError as exc:
                        response = exc
                    raw = response.read()
                    result = dict(status=response.status, body=json.loads(raw) if 'json' in response.headers.get('Content-Type', '') else dict(bytes=list(raw)))
                responses.append(result)
            if STAGE_B:
                # UUID-keyed savedAnswers/mediaState must retain distinct keys.
                # Collapsing them all to <UUID> hides losses and causes false
                # mismatches when the two ORMs return answers in different order.
                def pair_keys(left, right):
                    if isinstance(left, dict) and isinstance(right, dict):
                        for key in ('id', 'attemptId'):
                            if isinstance(left.get(key), str) and isinstance(right.get(key), str):
                                a, b = left[key], right[key]
                                if re.fullmatch(r'[0-9a-f-]{36}', a) and re.fullmatch(r'[0-9a-f-]{36}', b):
                                    alias = uuid_keys.get(a) or uuid_keys.get(b) or '<UUID_KEY_' + str(len(uuid_keys)//2) + '>'
                                    uuid_keys[a] = uuid_keys[b] = alias
                        for key in left.keys() & right.keys(): pair_keys(left[key], right[key])
                    elif isinstance(left, list) and isinstance(right, list):
                        for a, b in zip(left, right): pair_keys(a, b)
                pair_keys(responses[0], responses[1])
            passed = normalize(responses[0]) == normalize(responses[1])
            states = [database_state(side) for side in (0, 1)]
            db_passed = states[0] == states[1]
            results.append(dict(method=method, path=path, label=label or role or 'anonymous', status='PASS' if passed and db_passed else 'FAIL', database='PASS' if db_passed else 'FAIL', **({} if passed else dict(django=normalize(responses[0]), nest=normalize(responses[1]))), **({} if db_passed else dict(databaseDifferences={table: dict(django=states[0][table], nest=states[1][table]) for table in states[0] if states[0][table] != states[1][table]}))))
            print(json.dumps({key: results[-1][key] for key in ('method', 'path', 'label', 'status', 'database')}, ensure_ascii=True), flush=True)
            return [r.get('body', {}).get('data') for r in responses]

        def capture(name, values):
            if all(isinstance(v, dict) and 'id' in v for v in values):
                for side, value in enumerate(values): ids[side][name] = value['id']
            else: raise RuntimeError(f'Cannot capture {name}: {values}')

        capture('exam', call('POST', '/v1/mock/exams', dict(type='multilevel', title='Differential fixture', profile='practice')))
        capture('section', call('POST', '/v1/mock/exams/{exam}/sections', dict(skill='reading', title='Reading', sortOrder=0)))
        capture('group', call('POST', '/v1/mock/sections/{section}/groups', dict(title='Group', passageText='Original passage', sortOrder=0)))
        questions = [dict(number=1, type='multiple_choice', prompt='Choose', options=['A', 'B'], correctAnswers=['A'], points=1)]
        added = call('POST', '/v1/mock/groups/{group}/questions', dict(questions=questions))
        for side, value in enumerate(added):
            ids[side]['question'] = value['questions'][0]['id']
        call('PATCH', '/v1/mock/questions/{question}', dict(prompt='Updated prompt'))
        call('PATCH', '/v1/mock/groups/{group}', dict(contentHtml='<p>Safe<strong>format</strong><script>bad()</script></p>'))
        call('PATCH', '/v1/mock/sections/{section}', dict(title='Updated reading'))
        current = call('GET', '/v1/mock/exams/{exam}', label='pre-save-version')
        call('PUT', '/v1/mock/groups/{group}/content', dict(questions=[dict(id='{question}', number=1, type='short_answer', prompt='Fill blank', correctAnswers=['word'], wordLimit=1, answerRule='ONE_WORD', points=1)], deletedQuestionIds=[], expectedContentVersion=current[0]['contentVersion']))
        call('POST', '/v1/mock/parse-questions', dict(text='3. Choose\nA. One\nB. Two'))
        call('POST', '/v1/mock/groups/{group}/questions/import', dict(text='3. Choose\nA. One\nB. Two', answers={'3': 'A'}))
        call('GET', '/v1/mock/exams/{exam}')
        call('GET', '/v1/mock/exams')
        call('GET', '/v1/mock/exams/{exam}/preview')
        call('GET', '/v1/mock/exams/{exam}/readiness')
        call('PATCH', '/v1/mock/exams/{exam}', dict(isPublished=True))
        capture('clone', call('POST', '/v1/mock/exams/{exam}/clone', {}))
        call('PATCH', '/v1/mock/exams/{clone}', dict(title='Unauthorized teacher edit'), role='teacher', label='non-owner')
        call('PUT', '/v1/mock/groups/{group}/content', dict(questions=[], deletedQuestionIds=[]), role='teacher', label='non-owner-save')
        call('PATCH', '/v1/mock/exams/{exam}', dict(title='Changed fixture'), label='successful-metadata-mutation')
        call('POST', '/v1/mock/exams', dict(type='multilevel', title='Mass assignment fixture', createdById='attacker'), label='mass-assignment-denied')
        call('POST', '/v1/mock/groups/{group}/media', files={'audio': ('fixture.mp3', b'ID3fixture', 'audio/mpeg'), 'image': ('fixture.png', b'PNGfixture', 'image/png')})
        call('GET', '/v1/mock/groups/{group}/audio')
        call('GET', '/v1/mock/groups/{group}/image')
        # Repair routes are exercised against the same current-version draft.
        call('GET', '/v1/mock/exams/{clone}/multilevel-repair-inspection')
        call('POST', '/v1/mock/exams/{clone}/apply-multilevel-safe-repair', dict(confirm=True))
        call('POST', '/v1/mock/exams/{clone}/clone-corrected-multilevel', {})
        call('POST', '/v1/mock/exams/{clone}/repair-multilevel', {})
        package = dict(schemaVersion='1.0', packageId='fixture-package', revision=1, profile='practice',
            source=dict(kind='original_practice', label='Fixture'),
            exam=dict(type='ielts_academic', title='Imported fixture', description='', level='', isDemo=False, price=0, isFreeForApproved=False,
                sections=[dict(key='reading', skill='reading', title='Reading', instructions='', durationMinutes=60,
                    groups=[dict(key='group', title='Group', instructions='', passageText='Passage', contentHtml='', audioScript='', contentLayout='document', questions=[dict(key='q1', sourceRef='Original fixture', **dict(questions[0], options=['First choice', 'Second choice'], acceptedVariants=[]))])])]), media=[],
            reviewIssues=[dict(key='review', code='OTHER', path='/exam/sections/0/groups/0', message='Review fixture', sourceRef='Original fixture')])
        validation = call('POST', '/v1/mock/exam-imports/validate', dict(package=package))
        if not validation[0]['canImport']:
            raise RuntimeError('Fixture import invalid: ' + json.dumps(validation[0]['issues']))
        from apps.core.mock_import_validate import canonical_checksum
        commit_body = dict(package=package, validatedChecksum=canonical_checksum(package))
        imported = call('POST', '/v1/mock/exam-imports', commit_body)
        for side, value in enumerate(imported): ids[side]['imported'] = value['examId']
        call('POST', '/v1/mock/exam-imports', commit_body, label='replay')
        call('GET', '/v1/mock/exam-imports/by-package/fixture-package/revisions/1')
        provenance = call('GET', '/v1/mock/exam-imports/by-exam/{imported}')
        for side, value in enumerate(provenance): ids[side]['issue'] = value['issues'][0]['id']
        call('POST', '/v1/mock/exam-imports/issues/{issue}/resolve', {})
        call('POST', '/v1/mock/exam-imports/media', files={'file': ('fixture.mp3', b'ID3fixture', 'audio/mpeg')})
        # Complete equivalent authored Multilevel definitions, not just errors.
        capture('full', call('POST', '/v1/mock/exams', dict(type='multilevel', title='Original full fixture', profile='full_mock', starterStructure=True)))
        definitions = call('GET', '/v1/mock/exams/{full}')
        from stage_a_fixtures import multilevel_questions
        for section_index, section in enumerate(definitions[0]['sections']):
            skill = section['skill']; number = 1
            for part_index, group in enumerate(section['groups']):
                for side in (0, 1): ids[side]['full_group'] = definitions[side]['sections'][section_index]['groups'][part_index]['id']
                if skill == 'reading':
                    call('PATCH', '/v1/mock/groups/{full_group}', dict(passageText='Original synthetic reading passage'))
                if skill == 'listening':
                    call('PATCH', '/v1/mock/groups/{full_group}', dict(audioDurationSec=30 + part_index, passageText='PRIVATE LISTENING TRANSCRIPT'))
                    call('POST', '/v1/mock/groups/{full_group}/media', files={'audio': ('fixture.mp3', b'ID3fixture', 'audio/mpeg')})
                if skill == 'speaking' and part_index == 1:
                    call('POST', '/v1/mock/groups/{full_group}/media', files={'image': ('fixture.png', b'PNGfixture', 'image/png')})
                revision = call('GET', '/v1/mock/exams/{full}', label='full-pre-save-version')[0]['contentVersion']
                rows = multilevel_questions(skill, part_index, number); number += len(rows)
                call('PUT', '/v1/mock/groups/{full_group}/content', dict(questions=rows, deletedQuestionIds=[], expectedContentVersion=revision))
        call('GET', '/v1/mock/exams/{full}/readiness', label='full-ready')
        call('PATCH', '/v1/mock/exams/{full}', dict(isPublished=True), label='full-publish')
        call('GET', '/v1/mock/exams/{full}', label='full-published-detail')
        call('GET', '/v1/mock/exams/{full}/preview', label='full-keyless-preview')
        call('PUT', '/v1/mock/groups/{full_group}/content', dict(questions=[], deletedQuestionIds=[]), label='published-content-denied')
        # Legacy history fixture is inserted only in these disposable schemas.
        for side in (0, 1):
            db.execute(sql.SQL('UPDATE {}."MockExam" SET "specificationVersion"=%s,"speakingProfileVersion"=%s WHERE id=%s').format(sql.Identifier(schemas[side])), ('LEGACY_FIXTURE', 'LEGACY_FIXTURE', ids[side]['clone']))
            db.execute(sql.SQL('INSERT INTO {}."MockAttempt" (id,"examId","studentId",status,mode,"startedAt") VALUES (%s,%s,%s,\'completed\',\'practice\',NOW())').format(sql.Identifier(schemas[side])), (str(uuid4()), ids[side]['clone'], ids[side]['student']))
        call('GET', '/v1/mock/exams/{clone}/multilevel-repair-inspection', label='legacy-history')
        call('POST', '/v1/mock/exams/{clone}/apply-multilevel-safe-repair', dict(confirm=True), label='legacy-history-denied')
        call('POST', '/v1/mock/exams/{clone}/clone-corrected-multilevel', {}, label='legacy-history-corrected-copy')
        call('DELETE', '/v1/mock/questions/{question}')
        call('DELETE', '/v1/mock/groups/{group}')
        call('DELETE', '/v1/mock/sections/{section}')
        call('DELETE', '/v1/mock/exams/{exam}', role='super_admin')
        # Every active contract: real JWT guard matrix, intentionally missing
        # resources/invalid mutation bodies to avoid extra student attempts.
        inventory = json.loads(subprocess.run(['node', str(ROOT / 'scripts/stage_a_inventory.cjs')], capture_output=True, text=True, check=True).stdout)
        missing_id = str(uuid4())
        for endpoint in inventory['endpoints']:
            path = re.sub(r':(?:packageId)', 'missing-package', endpoint['path'])
            path = re.sub(r':revision', '1', path)
            path = re.sub(r':[^/]+', missing_id, path)
            payload = {} if endpoint['method'] != 'GET' else None
            handler = endpoint['handler']
            if handler == 'createExam': payload = dict(type='multilevel', title='Role fixture')
            if handler == 'parseQuestions': payload = dict(text='1. Explain')
            if handler == 'createSection': payload = dict(skill='reading', title='Role fixture')
            if handler == 'createGroup': payload = dict(title='Role fixture')
            if handler == 'addQuestions': payload = dict(questions=questions)
            if handler == 'saveGroupContent': payload = dict(questions=[], deletedQuestionIds=[])
            if handler == 'importQuestions': payload = dict(text='1. Explain', answers={'1': 'word'})
            if handler == 'applyMultilevelSafeRepair': payload = dict(confirm=True)
            if handler == 'validate': payload = dict(package=package)
            if handler == 'commit': payload = dict(package=package, validatedChecksum=canonical_checksum(package), targetExamId=missing_id)
            for role in (None, 'student', 'teacher', 'admin', 'super_admin'):
                call(endpoint['method'], path, payload,
                    role=role, label='security:' + str(role))
        stage_a_count = len(results)
        if STAGE_B:
            from stage_b_cases import run as run_stage_b
            run_stage_b(call, ids, db, schemas, results)
        summary = dict(activeContracts=inventory['count'], comparisons=len(results),
            passed=sum(r['status'] == 'PASS' for r in results),
            failed=sum(r['status'] == 'FAIL' for r in results),
            normalization=['UUID', 'ISO timestamp'],
            isolation='two disposable localhost PostgreSQL schemas with real JWT authentication',
            results=results)
        if STAGE_B:
            stage_b_inventory = json.loads(subprocess.run(['node', str(ROOT / 'scripts/stage_b_inventory.cjs')], capture_output=True, text=True, check=True).stdout)
            from django.urls import resolve, Resolver404
            missing_contracts = []
            for endpoint in stage_b_inventory['endpoints']:
                target = re.sub(r':[^/]+', 'fixture', endpoint['path'])
                try:
                    found = resolve(target).func
                    implemented = endpoint['method'].lower() in getattr(found, 'cls').http_method_names
                except (Resolver404, AttributeError):
                    implemented = False
                if not implemented:
                    missing_contracts.append(endpoint)
            summary.update(activeContracts=stage_b_inventory['count'],
                registeredContracts=stage_b_inventory['count']-len(missing_contracts),
                missingContracts=missing_contracts)
            summary.update(stageAComparisons=stage_a_count, stageBComparisons=len(results)-stage_a_count,
                verdict='STAGE_B_BLOCKED', coverage='Partial lifecycle; submission and full security/concurrency gates remain outstanding')
            summary['approvedSecurityDifferences'] = [r for r in results if r.get('approvedSecurityDifference')]
            summary['unapprovedFailures'] = sum(r['status'] == 'FAIL' and not r.get('approvedSecurityDifference') for r in results)
        REPORT_PATH.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        print('SUMMARY ' + json.dumps({key: summary[key] for key in ('activeContracts', 'comparisons', 'passed', 'failed')}))
finally:
    if server and server.poll() is None:
        try:
            server.stdin.write('shutdown\n'); server.stdin.flush()
            server.communicate(timeout=15)
        except (subprocess.TimeoutExpired, OSError):
            server.kill(); server.communicate()
    for schema in reversed(created):
        if schema not in schemas or not re.fullmatch(r'stage_a_diff_[a-f0-9]+_(django|nest)', schema):
            raise RuntimeError('Unsafe cleanup schema')
        db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
    db.close()
    if storage:
        target = Path(storage).resolve()
        if target.parent != ROOT.resolve() or not target.name.startswith('bestway-stage-a-diff-'):
            raise RuntimeError('Unsafe media cleanup path')
        shutil.rmtree(target)
    print('CLEANUP isolated_schemas_removed=' + str(len(created)))
raise SystemExit(0 if results and all(r['status']=='PASS' for r in results) else 1)
