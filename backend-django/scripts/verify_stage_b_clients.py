"""Focused rendered Next.js verification against Django-only local fixtures.

Never an assertion of native Tauri or complete four-skill UI coverage. Browser
requests to non-loopback hosts are aborted. Only a generated schema is written.
"""
import json,os,re,secrets,subprocess,sys,tempfile,time
from pathlib import Path
from urllib.parse import urlparse,urlunparse,parse_qsl,urlencode,unquote
from uuid import uuid4
import bcrypt
import psycopg
from contextlib import contextmanager
from psycopg import sql
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'STAGE_B_CLIENT_REPORT.json'
raw=os.environ['DATABASE_URL']; parsed=urlparse(raw)
if parsed.hostname not in ('localhost','127.0.0.1','::1'): raise RuntimeError('Local PostgreSQL only')
query=dict(parse_qsl(parsed.query)); query.pop('schema',None)
base=urlunparse(parsed._replace(query=urlencode(query)))
schema='stage_b_ui_'+uuid4().hex[:12]
db=psycopg.connect(base,autocommit=True); created=False; processes=[]; handles=[]
report=dict(verdict='STAGE_B_INTEGRATION_BLOCKED',nativeTauri='UNVERIFIED',browser=[],network=[],console=[],blockedExternal=[],runtime=[])
report['timings']=[]; report['failedRequests']=[]
password=secrets.token_urlsafe(18)
storage=tempfile.TemporaryDirectory(prefix='bestway-stage-b-ui-')


def start(args,cwd,env,name):
    handle=tempfile.TemporaryFile(mode='w+b'); handles.append((name,handle))
    proc=subprocess.Popen(args,cwd=cwd,env=env,stdout=handle,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    processes.append(proc); return proc


def wait_url(url,proc):
    from urllib.request import urlopen
    for _ in range(120):
        if proc.poll() is not None: raise RuntimeError('Local runtime exited: '+str(proc.returncode))
        try:
            with urlopen(url,timeout=2) as response:
                if response.status==200: return
        except Exception: pass
        time.sleep(.5)
    raise RuntimeError('Local runtime readiness timed out: '+url)


def measure_login(url,phone,secret,label):
    from urllib.request import Request,urlopen
    from urllib.error import HTTPError
    started=time.monotonic()
    try:
        response=urlopen(Request(url,data=json.dumps(dict(phone=phone,password=secret)).encode(),headers={'Content-Type':'application/json'}),timeout=90)
    except HTTPError as error:
        response=error
    with response:
        response.read()  # Never persist tokens, passwords or cookie values.
        report['timings'].append(dict(gate=label,status=response.status,durationMs=round((time.monotonic()-started)*1000)))


def capture(page,role):
    """Capture while the browser is alive; never capture a password field."""
    report['failureUrl']=page.url
    try:
        report['failureDom']=page.locator('body').inner_text(timeout=3000)[:5000]
        page.screenshot(path=str(ROOT/('STAGE_B_CLIENT_'+role+'.png')),full_page=True,
                        mask=[page.locator('#password')],timeout=10000)
    except Exception as error:
        report['captureError']=type(error).__name__


@contextmanager
def observed_browser():
    with sync_playwright() as pw:
        try:
            yield pw
        except Exception:
            if 'page' in globals() and not page.is_closed():
                capture(page,role)
            raise


try:
    env=dict(os.environ,PGPASSWORD=unquote(parsed.password or ''))
    dump=subprocess.run(['pg_dump','--schema-only','--no-owner','--no-privileges','--schema=public','--host',parsed.hostname,'--port',str(parsed.port or 5432),'--username',unquote(parsed.username or ''),'--dbname',unquote(parsed.path.lstrip('/'))],env=env,capture_output=True,text=True,encoding='utf-8',timeout=30)
    if dump.returncode: raise RuntimeError('Local schema dump failed')
    ddl='\n'.join(line for line in dump.stdout.splitlines() if not line.startswith('\\') and line.strip()!='CREATE SCHEMA public;')
    db.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema))); created=True
    db.execute(ddl.replace('public.',schema+'.').replace('SCHEMA public','SCHEMA '+schema),prepare=False)
    db.execute(sql.SQL('SET search_path TO {},public').format(sql.Identifier(schema)))
    phones={}; users={}; hashed=bcrypt.hashpw(password.encode(),bcrypt.gensalt(rounds=12)).decode()
    for index,role in enumerate(('student','teacher','admin')):
        uid=str(uuid4()); users[role]=uid; phones[role]='+99890000010'+str(index)
        db.execute('INSERT INTO "User" (id,name,phone,"passwordHash",role,"isActive","createdAt","updatedAt") VALUES (%s,%s,%s,%s,%s,true,NOW(),NOW())',(uid,'Local UI '+role,phones[role],hashed,role))
        if role=='student': db.execute('INSERT INTO "StudentProfile" ("userId","linkCode","availablePrograms","activeProgram") VALUES (%s,%s,ARRAY[\'IELTS\',\'MULTILEVEL\']::"ExamProgram"[],\'IELTS\')',(uid,'ui-disposable'))
    eid,sid,gid,qid=[str(uuid4()) for _ in range(4)]
    db.execute('INSERT INTO "MockExam" (id,type,title,"isPublished","isDemo","createdById","createdAt","updatedAt") VALUES (%s,\'ielts_academic\',\'Local UI Reading fixture\',true,true,%s,NOW(),NOW())',(eid,users['admin']))
    db.execute('INSERT INTO "MockSection" (id,"examId",skill,title,"sortOrder","durationMinutes") VALUES (%s,%s,\'reading\',\'Local Reading\',0,60)',(sid,eid))
    db.execute('INSERT INTO "MockQuestionGroup" (id,"sectionId","sortOrder",title,"passageText","createdAt") VALUES (%s,%s,0,\'Local passage\',\'The original answer is station.\',NOW())',(gid,sid))
    db.execute('INSERT INTO "MockQuestion" (id,"groupId",number,"sortOrder",type,prompt,"correctAnswers",points,"createdAt") VALUES (%s,%s,1,0,\'short_answer\',\'Where?\',\'["station"]\'::jsonb,1,NOW())',(qid,gid))
    env=dict(os.environ,DATABASE_URL=urlunparse(parsed._replace(query=urlencode(dict(query,schema=schema)))),DJANGO_SETTINGS_MODULE='config.settings.local',JWT_SECRET=secrets.token_urlsafe(32),STORAGE_DIR=storage.name,ALLOWED_HOSTS='127.0.0.1,localhost',CORS_ALLOWED_ORIGINS='http://127.0.0.1:3000,http://localhost:1420,http://127.0.0.1:1420',BUILD_COMMIT='stage-b-local-ui')
    django=start([sys.executable,'manage.py','runserver','127.0.0.1:8001','--noreload'],ROOT,env,'django')
    wait_url('http://127.0.0.1:8001/v1/health',django); report['runtime'].append('Django health 200 on 127.0.0.1:8001')
    frontend=ROOT.parent/'frontend'
    next_env=dict(os.environ,API_URL='http://127.0.0.1:8001/v1',NEXT_TELEMETRY_DISABLED='1')
    next_proc=start(['node',str(frontend/'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','localhost','--port','3000'],frontend,next_env,'next')
    wait_url('http://localhost:3000/en/login',next_proc)
    measure_login('http://127.0.0.1:8001/v1/auth/login',phones['student'],password,'direct Django login')
    measure_login('http://localhost:3000/api/auth/login',phones['student'],'invalid-disposable-password','cold Next login route (invalid credentials)')
    measure_login('http://localhost:3000/api/auth/login',phones['student'],'invalid-disposable-password','warm Next login route (invalid credentials)')
    with observed_browser() as pw:
        browser=pw.chromium.launch(headless=True)
        for role in ('student','teacher','admin'):
            context=browser.new_context(); page=context.new_page()
            page.set_default_timeout(90000)
            def guard(route):
                host=urlparse(route.request.url).hostname
                if host and host not in ('127.0.0.1','localhost','::1'):
                    report['blockedExternal'].append(urlparse(route.request.url).netloc); route.abort()
                else: route.continue_()
            context.route('**/*',guard)
            page.on('console',lambda message:report['console'].append(dict(type=message.type,text=message.text[:300])) if message.type in ('error','warning') else None)
            page.on('pageerror',lambda error:report['console'].append(dict(type='pageerror',text=str(error)[:500])))
            page.on('response',lambda response:report['network'].append(dict(method=response.request.method,url=response.url,path=urlparse(response.url).path,status=response.status)) if '/api/' in response.url else None)
            page.on('requestfinished',lambda request:report['timings'].append(dict(gate='browser request',url=request.url,timing=request.timing)) if '/api/' in request.url else None)
            page.on('requestfailed',lambda request:report['failedRequests'].append(dict(url=request.url,error=request.failure)))
            target='/en/mock' if role=='student' else '/en/exam-builder'
            page.goto('http://localhost:3000/en/login?next='+target,wait_until='networkidle',timeout=90000)
            page.locator('#phone').fill(phones[role]); page.locator('#password').fill(password)
            with page.expect_response(lambda response:'/api/auth/login' in response.url,timeout=30000) as login:
                page.locator('button[type="submit"]').click()
            assert login.value.status==200
            try:
                # A full window.location navigation replaces the login document.
                # Wait for committed DOM, not just its early URL change/old idle state.
                page.wait_for_url('**'+target,wait_until='domcontentloaded',timeout=90000)
                page.locator('body').wait_for(state='visible',timeout=90000)
                if role=='student':
                    page.get_by_text('Local UI Reading fixture',exact=True).first.wait_for(timeout=90000)
                page.wait_for_load_state('networkidle',timeout=90000)
            except Exception:
                capture(page,role)
                raise
            report['cookies']=[dict(name=c['name'],httpOnly=c['httpOnly'],secure=c['secure'],sameSite=c['sameSite']) for c in context.cookies() if c['name'].startswith('bw_')]
            page.screenshot(path=str(ROOT/('STAGE_B_CLIENT_'+role+'.png')),full_page=True)
            report['browser'].append(dict(role=role,gate='login-rendered-catalogue',url=page.url,text=page.locator('body').inner_text()[:4000],inputs=page.locator('input').evaluate_all('(nodes)=>nodes.map(n=>({placeholder:n.placeholder,type:n.type}))'),buttons=page.get_by_role('button').all_text_contents()))
            print('BROWSER '+json.dumps(report['browser'][-1],ensure_ascii=False),flush=True)
            if role=='student':
                page.goto('http://localhost:3000/en/mock/'+eid,wait_until='networkidle',timeout=90000)
                report['browser'].append(dict(role=role,gate='exam-detail',text=page.locator('body').inner_text()[:4500],buttons=page.get_by_role('button').all_text_contents()))
                print('BROWSER '+json.dumps(report['browser'][-1],ensure_ascii=False),flush=True)
                page.on('dialog',lambda dialog:dialog.accept())
                with page.expect_response(lambda r:'/api/backend/mock/exams/'+eid+'/start' in r.url) as started:
                    page.get_by_role('button',name='Timed (exam mode)',exact=True).click()
                assert started.value.status==201
                attempt_id=started.value.json()['data']['attemptId']
                answer=page.get_by_role('textbox',name='Answer for question 1',exact=True)
                answer.wait_for(state='visible')
                before=db.execute('SELECT "startedAt","deadlineAt" FROM "MockAttempt" WHERE id=%s',(attempt_id,)).fetchone()
                with page.expect_response(lambda r:'/answers' in r.url and r.request.method=='POST') as saved:
                    answer.fill('station')
                assert saved.value.status==200
                page.reload(wait_until='domcontentloaded',timeout=90000)
                answer.wait_for(state='visible'); assert answer.input_value()=='station'
                assert db.execute('SELECT "startedAt","deadlineAt" FROM "MockAttempt" WHERE id=%s',(attempt_id,)).fetchone()==before
                with page.expect_response(lambda r:'/submit' in r.url and r.request.method=='POST') as submitted:
                    page.get_by_role('button',name='Finish',exact=True).click()
                assert submitted.value.status==200
                page.get_by_role('textbox',name='Answer for question 1',exact=True).wait_for(state='hidden')
                final=db.execute('SELECT status FROM "MockAttempt" WHERE id=%s',(attempt_id,)).fetchone()[0]
                assert final=='completed'
                report['browser'].append(dict(role=role,gate='IELTS Reading timed start-autosave-refresh-submit',status='PASS',persistedStatus=final,timerPreserved=True,text=page.locator('body').inner_text()[:4500]))
                page.screenshot(path=str(ROOT/'STAGE_B_CLIENT_reading_result.png'),full_page=True)
            if role=='admin':
                page.goto('http://localhost:3000/en/exam-builder/new',wait_until='networkidle',timeout=90000)
                report['browser'].append(dict(role=role,gate='create-setup-render',text=page.locator('body').inner_text()[:4500],buttons=page.get_by_role('button').all_text_contents()))
                print('BROWSER '+json.dumps(report['browser'][-1],ensure_ascii=False),flush=True)
                page.locator('#eb-title').fill('Local UI authored IELTS')
                with page.expect_response(lambda r:r.request.method=='POST' and urlparse(r.url).path=='/api/backend/mock/exams') as created_exam:
                    page.get_by_role('button',name='Create & Continue',exact=True).click()
                assert created_exam.value.status==201
                page.wait_for_url('**/exam-builder/*',wait_until='domcontentloaded')
                page.locator('body').wait_for(state='visible')
                report['browser'].append(dict(role=role,gate='IELTS create starter through UI',status='PASS',text=page.locator('body').inner_text()[:4500]))
                page.screenshot(path=str(ROOT/'STAGE_B_CLIENT_builder.png'),full_page=True)
            context.close()
        browser.close()
except Exception as error:
    report['error']=type(error).__name__+': '+str(error)[:1000]; print('INTEGRATION_ERROR '+report['error'],flush=True)
finally:
    for process in reversed(processes):
        if process.poll() is None:
            subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True)
            process.wait(timeout=10)
    for name,handle in handles:
        handle.seek(0); lines=handle.read().decode('utf-8',errors='replace').splitlines()
        # Request paths/statuses and stack locations only; never dump env/tokens.
        report['runtime'].extend(name+': '+line[:300] for line in lines if re.search(r'"(?:GET|POST|PUT|PATCH|DELETE|OPTIONS) /|Error:|Module not found|GET /|POST /',line))
        handle.close()
    try:
        if created:
            if not re.fullmatch(r'stage_b_ui_[a-f0-9]{12}',schema): raise RuntimeError('Unsafe schema cleanup')
            db.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(schema)))
        report['cleanup']='disposable schema, storage and owned service processes removed'
    except Exception as error:
        report['cleanupError']=type(error).__name__
        report['remainingDisposableSchema']=schema
    finally:
        db.close(); storage.cleanup()
    REPORT.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print('REPORT '+str(REPORT),flush=True)
sys.exit(1 if report.get('error') or report.get('cleanupError') else 0)
