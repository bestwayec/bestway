"""Settings/audit/group differential tests in isolated localhost schemas."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode, unquote
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4
from unittest.mock import patch
import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
parsed = urlparse(os.environ.get('DATABASE_URL', ''))
if parsed.hostname not in ('localhost', '127.0.0.1', '::1'): raise SystemExit('Local PostgreSQL required')
query = dict(parse_qsl(parsed.query)); query.pop('schema', None)
base = urlunparse(parsed._replace(query=urlencode(query)))
prefix = 'stage_a_diff_' + uuid4().hex
schemas = [prefix + '_django', prefix + '_nest']
created = []; server = None; results = []
db = psycopg.connect(base, autocommit=True)
ids = [{}, {}]


def normalize(value):
    if isinstance(value, dict): return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, list): return [normalize(v) for v in value]
    if isinstance(value, str):
        value = re.sub(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', '<UUID>', value)
        return re.sub(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+00:00)?', '<TIME>', value)
    return value


def schema_url(schema):
    return urlunparse(parsed._replace(query=urlencode(dict(query, schema=schema))))


try:
    dump = subprocess.run(['pg_dump', '--schema-only', '--no-owner', '--no-privileges', '--schema=public',
        '--host', parsed.hostname, '--port', str(parsed.port or 5432), '--username', unquote(parsed.username or ''), '--dbname', unquote(parsed.path.lstrip('/'))],
        env=dict(os.environ, PGPASSWORD=unquote(parsed.password or '')), capture_output=True, text=True, encoding='utf-8', timeout=30)
    if dump.returncode: raise RuntimeError('Local schema dump failed')
    ddl = '\n'.join(line for line in dump.stdout.splitlines() if not line.startswith('\\') and line.strip() != 'CREATE SCHEMA public;')
    for side, schema in enumerate(schemas):
        db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema))); created.append(schema)
        db.execute(ddl.replace('public.', schema+'.').replace('SCHEMA public', 'SCHEMA '+schema), prepare=False)
        db.execute(sql.SQL('SET search_path TO {}').format(sql.Identifier(schema)))
        for index, role in enumerate(('student', 'teacher', 'admin', 'super_admin', 'parent', 'other_teacher', 'other_student', 'other_parent')):
            user_id = str(uuid4()); ids[side][role] = user_id
            actual = role.removeprefix('other_')
            db.execute('INSERT INTO "User" (id,name,phone,"passwordHash",role,"isActive","createdAt","updatedAt") VALUES (%s,%s,%s,%s,%s,true,NOW(),NOW())',
                (user_id, role, '+fixture'+str(index), 'unused', actual), prepare=False)
            if actual == 'student':
                db.execute('INSERT INTO "StudentProfile" ("userId","linkCode","availablePrograms","activeProgram") VALUES (%s,%s,ARRAY[\'IELTS\']::"ExamProgram"[],\'IELTS\')', (user_id, 'link'+str(index)))
        db.execute('INSERT INTO "ParentStudent" ("parentUserId","studentId") VALUES (%s,%s)', (ids[side]['parent'], ids[side]['student']))
    os.environ.update(DATABASE_URL=schema_url(schemas[0]), JWT_SECRET='full-foundation-local-secret-no-production-2026', DJANGO_SETTINGS_MODULE='config.settings.local', ALLOWED_HOSTS='testserver,localhost,127.0.0.1')
    import django
    django.setup()
    from rest_framework.test import APIClient
    from common.auth.jwt import issue_access
    client = APIClient()
    tokens = [{role: issue_access(uid, role.removeprefix('other_')) for role, uid in side.items()} for side in ids]
    env = {k: v for k, v in os.environ.items() if not k.startswith(('TELEGRAM_', 'DEEPSEEK_', 'DEEPGRAM_'))}
    env.update(DATABASE_URL=schema_url(schemas[1]), VERIFY_FULL_FOUNDATION='1')
    env.pop('VERIFY_STAGE_B', None)
    server = subprocess.Popen(['node', str(ROOT/'scripts/nest_stage_a_server.cjs')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', env=env)
    line = server.stdout.readline()
    if not line: raise RuntimeError('Reference failed: '+server.stderr.read())
    port = json.loads(line)['port']

    def state(side):
        result = {}
        for table in ('Setting', 'AuditLog', 'Group', 'StudentProfile', 'Article', 'Notification'):
            rows = db.execute(sql.SQL('SELECT row_to_json(t) FROM {}.{} t').format(sql.Identifier(schemas[side]), sql.Identifier(table))).fetchall()
            result[table] = sorted([normalize(row[0]) for row in rows], key=lambda v: json.dumps(v, sort_keys=True))
        return result

    def call(method, path, payload=None, role='super_admin', label=None, capture=None):
        responses = []
        for side in (0, 1):
            def expand(value):
                if isinstance(value, str) and re.fullmatch(r'\{\w+\}', value): return value.format(**ids[side])
                if isinstance(value, list): return [expand(v) for v in value]
                if isinstance(value, dict): return {k: expand(v) for k, v in value.items()}
                return value
            target = path.format(**ids[side]); body = expand(payload)
            headers = {'Authorization': 'Bearer '+tokens[side][role]} if role else {}
            if side == 0:
                client.credentials(**{'HTTP_AUTHORIZATION': headers['Authorization']} if role else {})
                response = getattr(client, method.lower())(target, body or {}, format='json')
                result = dict(status=response.status_code, body=json.loads(response.content))
            else:
                headers['Content-Type'] = 'application/json'
                request = Request(f'http://127.0.0.1:{port}'+target, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
                try: response = urlopen(request, timeout=20)
                except HTTPError as error: response = error
                result = dict(status=response.status, body=json.loads(response.read()))
            responses.append(result)
            if capture and result['status'] < 300: ids[side][capture] = result['body']['data']['id']
        states = [state(0), state(1)]
        equal = normalize(responses[0]) == normalize(responses[1]) and states[0] == states[1]
        row = dict(method=method, path=path, label=label or role or 'anonymous', status='PASS' if equal else 'FAIL')
        if not equal: row.update(django=normalize(responses[0]), nest=normalize(responses[1]), databaseDifferences={k:dict(django=states[0][k], nest=states[1][k]) for k in states[0] if states[0][k] != states[1][k]})
        results.append(row)
        print(json.dumps({k:row[k] for k in ('method','path','label','status')}), flush=True)
        if not equal:
            print('DIFFERENCE '+json.dumps(dict(django=normalize(responses[0]),nest=normalize(responses[1]),tables=list(row['databaseDifferences']))),flush=True)
        return responses

    routes = [('GET','/v1/settings'),('PATCH','/v1/settings',{}),('GET','/v1/settings/exam-program-policy'),('PUT','/v1/settings/exam-program-policy',{'accessPolicy':'SELF_SELECT'}),('GET','/v1/settings/ielts-bands'),('PUT','/v1/settings/ielts-bands',{}),('DELETE','/v1/settings/ielts-bands'),('GET','/v1/audit-logs')]
    for route in routes:
        for role in (None, 'student','parent','teacher','admin','super_admin'):
            call(*route,role=role,label='roles:'+str(role))
    for key, maximum in [('teacherPointLimit',1000),('initialPoints',100000),('monthlyFee',100000000),('gameThreshold',100000)]:
        for value in (maximum,maximum+1,-1,1.5,'12',True,None): call('PATCH','/v1/settings',{key:value},label=key+':'+str(value))
    call('PATCH','/v1/settings',{'initialPoints':321,'teacherPointLimit':11,'monthlyFee':450000,'gameThreshold':200})
    call('PATCH','/v1/settings',{'unknown':1})
    for data in ({},{'accessPolicy':'STAFF_ASSIGNED'},{'accessPolicy':'bad'},{'accessPolicy':None},{'accessPolicy':'SELF_SELECT'}): call('PUT','/v1/settings/exam-program-policy',data)
    for table in ([[0,2],[40,9],[20,6],[20,5]],[],[[1,2]],[[0,9.1]],[[0,True]],'bad',None):
        call('PUT','/v1/settings/ielts-bands',{'listening':table})
        call('GET','/v1/settings/ielts-bands')
    call('PUT','/v1/settings/ielts-bands',{'listening':[[0,4]],'readingAcademic':[[1,9]]},label='all-table-validation-before-write')
    call('DELETE','/v1/settings/ielts-bands')
    for query in ('?page=0','?limit=101','?page=1.5','?limit=bad','?extra=x','?entity=setting&action=ielts&page=2&limit=2'):
        call('GET','/v1/audit-logs'+query)
    call('POST','/v1/groups',{'name':'A','teacherId':'{teacher}'})
    call('POST','/v1/groups',{'name':'Group','teacherId':'{student}'})
    call('POST','/v1/groups',{'name':'Group','teacherId':''},label='foreign-key-contract')
    call('POST','/v1/groups',{'name':'Group','schedule':[{'day':'mon','startTime':'25:00','endTime':'18:00'}]})
    call('POST','/v1/groups',{'name':'Group','schedule':[{'day':'bad','startTime':'12:00','endTime':'18:00'}]})
    call('POST','/v1/groups',{'name':'Group','schedule':[{'day':'mon','startTime':'12:00','endTime':'18:00','extra':True}]})
    call('POST','/v1/groups',{'name':'English','teacherId':'{teacher}','schedule':[{'day':'mon','startTime':'09:00','endTime':'10:30'}]},capture='group')
    call('POST','/v1/groups/{group}/students',{'studentId':'{student}'})
    call('POST','/v1/groups/{group}/students',{'studentId':'{other_student}'})
    creation_times = [db.execute(sql.SQL('SELECT "createdAt" FROM {}."Group" WHERE id=%s').format(sql.Identifier(schemas[side])),(ids[side]['group'],)).fetchone()[0] for side in (0,1)]
    for role in ('student','other_teacher','teacher','parent','other_parent','admin','super_admin',None):
        call('GET','/v1/groups',role=role)
        call('GET','/v1/groups/{group}',role=role)
        call('PATCH','/v1/groups/{group}',{'name':'Changed'},role=role)
        call('POST','/v1/groups/{group}/students',{'studentId':'{student}'},role=role)
        call('DELETE','/v1/groups/{group}/students/{student}',role=role)
    call('POST','/v1/groups/{group}/students',{'studentId':'{student}'})
    call('POST','/v1/groups',{'name':'Second'},capture='second')
    call('POST','/v1/groups/{second}/students',{'studentId':'{student}'},label='membership-moves-between-groups')
    call('GET','/v1/groups/{group}',role='student')
    call('GET','/v1/groups/{second}',role='parent')
    call('PATCH','/v1/groups/{group}',{'teacherId':None,'schedule':[]})
    call('GET','/v1/groups/{group}',role='teacher')
    for role in ('student','teacher','parent','admin','super_admin'):
        call('GET','/v1/groups/missing',role=role)
    call('GET','/v1/audit-logs?entity=group')
    local_checks=[]
    for side in (0,1):
        stored=db.execute(sql.SQL('SELECT "createdAt" FROM {}."Group" WHERE id=%s').format(sql.Identifier(schemas[side])),(ids[side]['group'],)).fetchone()[0]
        assert stored==creation_times[side], 'Group update changed its original creation timestamp'
    local_checks.append('both APIs preserve exact original group creation time')
    from apps.core import system_settings
    before=state(0); cache_before=system_settings.numeric_settings()
    actual_set=system_settings.set_value
    def fail_second(key,value):
        if key=='monthlyFee': raise RuntimeError('injected settings failure')
        actual_set(key,value)
    with patch.object(system_settings,'set_value',side_effect=fail_second):
        try: system_settings.update_numbers(type('Actor',(),{'id':ids[0]['super_admin']})(),{'initialPoints':999,'monthlyFee':999})
        except RuntimeError: pass
        else: raise AssertionError('Rollback injection did not run')
    assert state(0)==before and system_settings.numeric_settings()==cache_before
    local_checks.append('failed multi-setting transaction rolls back database, audit and numeric cache')
    for role in (None,'student','teacher','parent','admin','super_admin'):
        call('GET','/v1/articles',role=role)
        call('POST','/v1/articles',{'title':'Reference article','body':'At least ten characters','category':'news','tags':['English','tips']},role=role,capture='article' if role in ('admin','super_admin') else None)
        call('POST','/v1/notifications/broadcast',{'audience':'all','text':'Welcome message'},role=role)
        call('GET','/v1/notifications?unreadOnly=true',role=role)
    call('GET','/v1/articles/{article}',role=None)
    for query in ('?category=news&tag=English','?page=2&limit=1','?tag=missing','?unknown=true','?limit=0'):
        call('GET','/v1/articles'+query,role=None)
    for body in ({'title':'x'},{'body':'short'},{'category':'x'},{'tags':['good',3]},{'tags':'wrong'},{'unknown':True},{'title':None},{'tags':None},{}):
        call('PATCH','/v1/articles/{article}',body)
    for role in ('student','teacher','parent',None):
        call('PATCH','/v1/articles/{article}',{'title':'Forbidden change'},role=role)
        call('DELETE','/v1/articles/{article}',role=role)
    call('PATCH','/v1/articles/{article}',{'title':'Revised article','tags':[]})
    call('DELETE','/v1/articles/{article}')
    call('GET','/v1/articles/{article}',role=None)
    call('GET','/v1/articles/missing',role=None)
    for body in ({'audience':'role','text':'Role required'},{'audience':'group','text':'Group required'},
                 {'audience':'role','role':'student','text':'Student announcement'},
                 {'audience':'group','groupId':'{second}','includeParents':True,'text':'Family announcement'},
                 {'audience':'group','groupId':'missing','text':'Empty audience'},
                 {'audience':'debtors','includeParents':True,'text':'Payment reminder'},
                 {'audience':'all','text':'xx'},{'audience':'bad','text':'Unknown audience'},
                 {'audience':'all','includeParents':'true','text':'Invalid boolean'},
                 {'audience':'role','role':'bad','text':'Invalid role'}):
        call('POST','/v1/notifications/broadcast',body)
    for query in ('?unreadOnly=1','?unreadOnly=false','?unreadOnly=anything','?type=announcement','?type=bad','?page=2&limit=1'):
        call('GET','/v1/notifications'+query,role='student')
    for side in (0,1):
        row=db.execute(sql.SQL('SELECT id FROM {}."Notification" WHERE "userId"=%s ORDER BY "createdAt" DESC LIMIT 1').format(sql.Identifier(schemas[side])),(ids[side]['student'],)).fetchone()
        ids[side]['notification']=row[0] if row else 'missing-fixture'
    call('PATCH','/v1/notifications/{notification}/read',role='parent',label='cross-user-notification-IDOR')
    call('PATCH','/v1/notifications/{notification}/read',role='student')
    call('PATCH','/v1/notifications/{notification}/read',role='student',label='idempotent-mark-read')
    call('PATCH','/v1/notifications/read-all',role='student')
    call('PATCH','/v1/notifications/read-all',role='student',label='idempotent-read-all')
    call('GET','/v1/notifications?unreadOnly=true',role='student')
    call('PATCH','/v1/notifications/missing/read',role='student')
    summary = dict(contracts=23,comparisons=len(results),passed=sum(r['status']=='PASS' for r in results),failed=sum(r['status']=='FAIL' for r in results),localChecks=local_checks,results=results)
    (ROOT/'FULL_FOUNDATION_PARITY_REPORT.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
    print('SUMMARY '+json.dumps({k:v for k,v in summary.items() if k!='results'}))
finally:
    if server:
        if server.poll() is None:
            try: server.stdin.write('stop\n');server.stdin.flush()
            except (OSError, BrokenPipeError): pass
            try: server.wait(timeout=10)
            except subprocess.TimeoutExpired: server.terminate();server.wait(timeout=10)
    for schema in created:
        if not re.fullmatch(r'stage_a_diff_[a-f0-9]+_(django|nest)', schema): raise RuntimeError('Unsafe cleanup')
        db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
    db.close()
    print('CLEANUP isolated_schemas_removed='+str(len(created)))
sys.exit(1 if any(r['status']=='FAIL' for r in results) else 0)
