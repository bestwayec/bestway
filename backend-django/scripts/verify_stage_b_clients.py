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
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=Path(os.environ.get('BESTWAY_CLIENT_EVIDENCE_DIR',str(ROOT)))
EVIDENCE.mkdir(parents=True,exist_ok=True)
REPORT=EVIDENCE/'STAGE_B_CLIENT_REPORT.json'
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


def warm_proxy():
    from urllib.request import urlopen
    from urllib.error import HTTPError
    started=time.monotonic()
    try:
        response=urlopen('http://localhost:3000/api/backend/auth/me',timeout=90)
    except HTTPError as error:
        response=error
    with response:
        response.read()
        report['timings'].append(dict(gate='cold authenticated proxy (anonymous diagnostic, not E2E)',status=response.status,durationMs=round((time.monotonic()-started)*1000)))


def capture(page,role):
    """Capture while the browser is alive; never capture a password field."""
    report['failureUrl']=page.url
    try:
        report['failureDom']=page.locator('body').inner_text(timeout=3000)[:5000]
        page.screenshot(path=str(EVIDENCE/('STAGE_B_CLIENT_'+role+'.png')),full_page=True,
                        mask=[page.locator('#password')],timeout=10000)
    except Exception as error:
        report['captureError']=type(error).__name__


def probe_authenticated_upstream(context):
    """Compare Python/Node transports without storing or printing credentials."""
    from urllib.request import Request,urlopen
    token=next((c['value'] for c in context.cookies() if c['name']=='bw_at'),None)
    if not token:return
    probes=[]
    started=time.monotonic()
    try:
        with urlopen(Request('http://127.0.0.1:8001/v1/auth/me',headers={'Authorization':'Bearer '+token}),timeout=15) as response:
            response.read();probes.append(dict(transport='python',status=response.status,durationMs=round((time.monotonic()-started)*1000)))
    except Exception as error:probes.append(dict(transport='python',error=type(error).__name__))
    code="let token='';process.stdin.on('data',v=>token+=v);process.stdin.on('end',async()=>{const t=Date.now();try{const r=await fetch('http://127.0.0.1:8001/v1/auth/me',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});await r.arrayBuffer();console.log(JSON.stringify({transport:'node',status:r.status,durationMs:Date.now()-t}))}catch(e){console.log(JSON.stringify({transport:'node',error:e.name,cause:e.cause?.code,durationMs:Date.now()-t}))}})"
    output=subprocess.run(['node','-e',code],input=token,capture_output=True,text=True,timeout=20)
    try:probes.append(json.loads(output.stdout))
    except Exception:probes.append(dict(transport='node',exitCode=output.returncode))
    report['authenticatedTransportProbes']=probes
    print('UPSTREAM '+json.dumps(probes),flush=True)


@contextmanager
def observed_browser():
    with sync_playwright() as pw:
        try:
            yield pw
        except Exception:
            if 'page' in globals() and not page.is_closed():
                capture(page,role)
                probe_authenticated_upstream(context)
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
    if os.environ.get('BESTWAY_CLIENT_DOMAINS')=='1':
        group_id=str(uuid4())
        db.execute('INSERT INTO "Group" (id,name,"teacherId","createdAt") VALUES (%s,\'Local release group\',%s,NOW())',(group_id,users['teacher']))
        db.execute('UPDATE "StudentProfile" SET "groupId"=%s,"isApproved"=true WHERE "userId"=%s',(group_id,users['student']))
        for fixture_role in users:
            db.execute('INSERT INTO "Notification" (id,"userId",type,text,read,"createdAt") VALUES (%s,%s,\'announcement\',\'Local release notification\',false,NOW())',(str(uuid4()),users[fixture_role]))
    eid,sid,gid,qid=[str(uuid4()) for _ in range(4)]
    db.execute('INSERT INTO "MockExam" (id,type,title,"isPublished","isDemo","createdById","createdAt","updatedAt") VALUES (%s,\'ielts_academic\',\'Local UI Reading fixture\',true,true,%s,NOW(),NOW())',(eid,users['admin']))
    db.execute('INSERT INTO "MockSection" (id,"examId",skill,title,"sortOrder","durationMinutes") VALUES (%s,%s,\'reading\',\'Local Reading\',0,60)',(sid,eid))
    db.execute('INSERT INTO "MockQuestionGroup" (id,"sectionId","sortOrder",title,"passageText","createdAt") VALUES (%s,%s,0,\'Local passage\',\'The original answer is station.\',NOW())',(gid,sid))
    db.execute('INSERT INTO "MockQuestion" (id,"groupId",number,"sortOrder",type,prompt,"correctAnswers",points,"createdAt") VALUES (%s,%s,1,0,\'short_answer\',\'Where?\',\'["station"]\'::jsonb,1,NOW())',(qid,gid))
    sys.path.insert(0,str(ROOT))
    from apps.core.multilevel import CURRENT_SPEC,CURRENT_SPEAKING_PROFILE,SPECS
    from stage_a_fixtures import multilevel_questions
    ml_id,ml_section=[str(uuid4()) for _ in range(2)]; ml_answers=[]
    db.execute('INSERT INTO "MockExam" (id,type,title,"isPublished","createdById","specificationVersion","speakingProfileVersion","createdAt","updatedAt") VALUES (%s,\'multilevel\',\'Local UI Multilevel Reading\',true,%s,%s,%s,NOW(),NOW())',(ml_id,users['admin'],CURRENT_SPEC,CURRENT_SPEAKING_PROFILE))
    db.execute('INSERT INTO "MockSection" (id,"examId",skill,title,"sortOrder","durationMinutes") VALUES (%s,%s,\'reading\',\'Multilevel Reading\',0,60)',(ml_section,ml_id))
    number=1
    for part in range(len(SPECS[CURRENT_SPEC]['reading']['parts'])):
        group_id=str(uuid4())
        db.execute('INSERT INTO "MockQuestionGroup" (id,"sectionId","sortOrder",title,"passageText","createdAt") VALUES (%s,%s,%s,%s,\'Original synthetic local reading passage.\',NOW())',(group_id,ml_section,part,'Part '+str(part+1)))
        for index,question in enumerate(multilevel_questions('reading',part,number)):
            question_id=str(uuid4()); ml_answers.append(question)
            db.execute('INSERT INTO "MockQuestion" (id,"groupId",number,"sortOrder",type,prompt,options,"correctAnswers",points,"wordLimit","answerRule","acceptedVariants","createdAt") VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,1,%s,%s,%s::jsonb,NOW())',(question_id,group_id,question['number'],index,question['type'],question['prompt'],json.dumps(question['options']),json.dumps(question['correctAnswers']),question.get('wordLimit'),question.get('answerRule'),json.dumps(question['acceptedVariants'])))
        number+=len(multilevel_questions('reading',part,number))
    extra_fixtures=[]
    if os.environ.get('BESTWAY_CLIENT_EXTRA_SKILLS')=='1':
        import base64,wave
        media_root=Path(storage.name)/'mock';media_root.mkdir(parents=True,exist_ok=True)
        audio_key='mock/local-fixture.wav'
        with wave.open(str(Path(storage.name)/audio_key),'wb') as audio:
            audio.setparams((1,2,8000,0,'NONE','not compressed'));audio.writeframes(b'\0\0'*16000)
        image_key='mock/local-fixture.png'
        (Path(storage.name)/image_key).write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSu8AAAAASUVORK5CYII='))
        for program in ('IELTS','MULTILEVEL'):
            for skill in ('listening','writing','speaking'):
                exam_id,section_id=[str(uuid4()) for _ in range(2)]
                db.execute('INSERT INTO "MockExam" (id,type,title,"isPublished","isDemo","createdById","specificationVersion","speakingProfileVersion","createdAt","updatedAt") VALUES (%s,%s,%s,true,%s,%s,%s,%s,NOW(),NOW())',
                    (exam_id,'ielts_academic' if program=='IELTS' else 'multilevel','Local UI '+program+' '+skill,program=='IELTS',users['admin'],CURRENT_SPEC if program=='MULTILEVEL' else None,CURRENT_SPEAKING_PROFILE if program=='MULTILEVEL' else None))
                db.execute('INSERT INTO "MockSection" (id,"examId",skill,title,"sortOrder","durationMinutes") VALUES (%s,%s,%s,%s,0,%s)',(section_id,exam_id,skill,'Local '+skill,SPECS[CURRENT_SPEC][skill]['duration']))
                fixture=dict(program=program,skill=skill,examId=exam_id,questions=[],groups=[])
                number=1
                for part in range(len(SPECS[CURRENT_SPEC][skill]['parts']) if program=='MULTILEVEL' else 1):
                    group_id=str(uuid4());fixture['groups'].append(group_id)
                    maximum=SPECS[CURRENT_SPEC][skill]['parts'][part][3] if program=='MULTILEVEL' and skill in ('writing','speaking') else None
                    db.execute('INSERT INTO "MockQuestionGroup" (id,"sectionId","sortOrder",title,"passageText","partNumber","audioKey","audioDurationSec","imageKey","maxScore","stimulusRef","createdAt") VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())',
                        (group_id,section_id,part,'Part '+str(part+1),'Original synthetic prompt.',part+1,audio_key if skill=='listening' else None,2 if skill=='listening' else None,image_key if skill=='speaking' and part==1 else None,maximum,'Original shared email stimulus' if skill=='writing' and part<2 else None))
                    questions=multilevel_questions(skill,part,number) if program=='MULTILEVEL' else [dict(number=1,type={'listening':'short_answer','writing':'essay_task1','speaking':'speaking_task'}[skill],prompt='Describe your local test experience.',options=[],correctAnswers=['station'] if skill=='listening' else [],acceptedVariants=[],points=1 if skill=='listening' else 9)]
                    for index,question in enumerate(questions):
                        question_id=str(uuid4());fixture['questions'].append(dict(question,id=question_id,groupIndex=part))
                        db.execute('INSERT INTO "MockQuestion" (id,"groupId",number,"sortOrder",type,prompt,options,"correctAnswers",points,"wordLimit","answerRule","acceptedVariants","createdAt") VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s,%s::jsonb,NOW())',
                            (question_id,group_id,question['number'],index,question['type'],question['prompt'],json.dumps(question['options']),json.dumps(question['correctAnswers']),question['points'],question.get('wordLimit'),question.get('answerRule'),json.dumps(question['acceptedVariants'])))
                    number+=len(questions)
                extra_fixtures.append(fixture)
    env=dict(os.environ,DATABASE_URL=urlunparse(parsed._replace(query=urlencode(dict(query,schema=schema)))),DJANGO_SETTINGS_MODULE='config.settings.local',JWT_SECRET=secrets.token_urlsafe(32),STORAGE_DIR=storage.name,PUBLIC_URL='http://localhost:8001',ALLOWED_HOSTS='127.0.0.1,localhost',CORS_ALLOWED_ORIGINS='http://127.0.0.1:3000,http://localhost:1420,http://127.0.0.1:1420',BUILD_COMMIT='stage-b-local-ui')
    django=start([sys.executable,'manage.py','runserver','127.0.0.1:8001','--noreload'],ROOT,env,'django')
    wait_url('http://127.0.0.1:8001/v1/health',django); report['runtime'].append('Django health 200 on 127.0.0.1:8001')
    frontend=ROOT.parent/'frontend'
    next_env=dict(os.environ,API_URL='http://127.0.0.1:8001/v1',NEXT_TELEMETRY_DISABLED='1')
    next_proc=start(['node',str(frontend/'node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','localhost','--port','3000'],frontend,next_env,'next')
    wait_url('http://localhost:3000/en/login',next_proc)
    measure_login('http://127.0.0.1:8001/v1/auth/login',phones['student'],password,'direct Django login')
    measure_login('http://localhost:3000/api/auth/login',phones['student'],'invalid-disposable-password','cold Next login route (invalid credentials)')
    measure_login('http://localhost:3000/api/auth/login',phones['student'],'invalid-disposable-password','warm Next login route (invalid credentials)')
    warm_proxy()
    # Inspect redirect locations without following a possible self-loop.
    from urllib.request import build_opener,HTTPRedirectHandler,Request
    from urllib.error import HTTPError
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*args): return None
    diagnostic=build_opener(NoRedirect())
    report['localeRedirects']=[]
    for path in ('/login','/en/login','/uz/login','/mock','/en/mock'):
        try: response=diagnostic.open(Request('http://localhost:3000'+path),timeout=90)
        except HTTPError as error: response=error
        with response:
            report['localeRedirects'].append(dict(path=path,status=response.status,location=response.headers.get('Location')))
    print('LOCALE '+json.dumps(report['localeRedirects']),flush=True)
    if os.environ.get('BESTWAY_CLIENT_PRECOMPILE')=='1':
        # A separate, explicitly labelled warm-runtime gate. Cold failures remain
        # in their own evidence; no browser API retry or timeout is introduced.
        from http.cookiejar import CookieJar
        from urllib.request import HTTPCookieProcessor
        report['precompile']=[]
        selected_roles=os.environ.get('BESTWAY_CLIENT_ROLES','student,admin,teacher').split(',')
        for fixture_role,paths in [('student',['/en/mock','/en/mock/'+eid]),('admin',['/en/exam-builder','/en/exam-builder/new'])]:
            if fixture_role not in selected_roles:continue
            session=build_opener(HTTPCookieProcessor(CookieJar()))
            report['phase']='precompile login '+fixture_role
            with session.open(Request('http://localhost:3000/api/auth/login',data=json.dumps(dict(phone=phones[fixture_role],password=password)).encode(),headers={'Content-Type':'application/json'}),timeout=90) as response:response.read()
            for path in paths:
                report['phase']='precompile '+path
                started=time.monotonic()
                with session.open('http://localhost:3000'+path,timeout=90) as response:
                    response.read();report['precompile'].append(dict(path=path,status=response.status,durationMs=round((time.monotonic()-started)*1000)))
        print('PRECOMPILE '+json.dumps(report['precompile']),flush=True)
    with observed_browser() as pw:
        browser=pw.chromium.launch(headless=True,args=['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'] if extra_fixtures else [])
        roles=os.environ.get('BESTWAY_CLIENT_ROLES','student,admin,teacher').split(',')
        if any(role not in ('student','admin','teacher') for role in roles):raise ValueError('Unknown fixture role')
        for role in roles:
            context=browser.new_context(permissions=['microphone'] if extra_fixtures else []); page=context.new_page()
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
            page.screenshot(path=str(EVIDENCE/('STAGE_B_CLIENT_'+role+'.png')),full_page=True)
            report['browser'].append(dict(role=role,gate='login-rendered-catalogue',url=page.url,text=page.locator('body').inner_text()[:4000],inputs=page.locator('input').evaluate_all('(nodes)=>nodes.map(n=>({placeholder:n.placeholder,type:n.type}))'),buttons=page.get_by_role('button').all_text_contents()))
            print('BROWSER '+json.dumps(report['browser'][-1],ensure_ascii=False),flush=True)
            if role=='student' and not extra_fixtures and os.environ.get('BESTWAY_CLIENT_DOMAINS')!='1':
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
                assert saved.value.status==201
                page.reload(wait_until='domcontentloaded',timeout=90000)
                expect(answer).to_have_value('station', timeout=30000)
                assert db.execute('SELECT "startedAt","deadlineAt" FROM "MockAttempt" WHERE id=%s',(attempt_id,)).fetchone()==before
                with page.expect_response(lambda r:'/submit' in r.url and r.request.method=='POST') as submitted:
                    page.get_by_role('button',name='Finish',exact=True).click()
                assert submitted.value.status==201
                page.get_by_role('textbox',name='Answer for question 1',exact=True).wait_for(state='hidden')
                final=db.execute('SELECT status FROM "MockAttempt" WHERE id=%s',(attempt_id,)).fetchone()[0]
                assert final=='completed'
                report['browser'].append(dict(role=role,gate='IELTS Reading timed start-autosave-refresh-submit',status='PASS',persistedStatus=final,timerPreserved=True,text=page.locator('body').inner_text()[:4500]))
                page.screenshot(path=str(EVIDENCE/'STAGE_B_CLIENT_reading_result.png'),full_page=True)
                page.goto('http://localhost:3000/en/mock',wait_until='domcontentloaded')
                page.get_by_role('button',name='Switch to MULTILEVEL',exact=True).click()
                page.get_by_text('Local UI Multilevel Reading',exact=True).first.wait_for()
                page.goto('http://localhost:3000/en/mock/'+ml_id,wait_until='domcontentloaded')
                with page.expect_response(lambda r:'/mock/exams/'+ml_id+'/start' in r.url) as ml_started:
                    page.get_by_role('button',name='Timed (exam mode)',exact=True).click()
                assert ml_started.value.status==201
                ml_attempt=ml_started.value.json()['data']['attemptId']
                for question in ml_answers:
                    if question['type'] in ('short_answer','sentence_completion','summary_completion'):
                        page.get_by_role('textbox',name='Answer for question '+str(question['number']),exact=True).fill(question['correctAnswers'][0])
                    else:
                        fieldset=page.get_by_role('group',name='Question '+str(question['number']),exact=True)
                        fieldset.locator('input[value="'+question['correctAnswers'][0]+'"]').check()
                save_deadline=time.monotonic()+30
                while db.execute('SELECT COUNT(*) FROM "MockAnswer" WHERE "attemptId"=%s AND response<>\'\'',(ml_attempt,)).fetchone()[0]!=35:
                    if time.monotonic()>save_deadline: raise AssertionError('Multilevel autosave did not persist all 35 responses')
                    page.wait_for_timeout(100)
                page.reload(wait_until='domcontentloaded')
                page.get_by_role('textbox',name='Answer for question 1',exact=True).wait_for()
                expect(page.get_by_role('textbox',name='Answer for question 1',exact=True)).to_have_value('word', timeout=30000)
                assert db.execute('SELECT COUNT(*) FROM "MockAnswer" WHERE "attemptId"=%s AND response<>\'\'',(ml_attempt,)).fetchone()[0]==35
                with page.expect_response(lambda r:'/mock/attempts/'+ml_attempt+'/submit' in r.url) as ml_submitted:
                    page.get_by_role('button',name='Finish',exact=True).click()
                    page.get_by_role('button',name='Submit exam',exact=True).click()
                assert ml_submitted.value.status==201
                report['browser'].append(dict(role=role,gate='Multilevel 35-question timed Reading autosave-reload-submit',status='PASS',persistedStatus=db.execute('SELECT status FROM "MockAttempt" WHERE id=%s',(ml_attempt,)).fetchone()[0]))
            if role=='student' and extra_fixtures:
                page.on('dialog',lambda dialog:dialog.accept())
                for fixture in extra_fixtures:
                    if os.environ.get('BESTWAY_CLIENT_SKILL_PROGRAM') and fixture['program']!=os.environ['BESTWAY_CLIENT_SKILL_PROGRAM']:continue
                    gate=dict(role=role,gate=fixture['program']+' '+fixture['skill']+' rendered lifecycle',status='FAIL')
                    try:
                        if fixture['program']=='MULTILEVEL' and db.execute('SELECT "activeProgram" FROM "StudentProfile" WHERE "userId"=%s',(users['student'],)).fetchone()[0]!='MULTILEVEL':
                            page.goto('http://localhost:3000/en/mock',wait_until='domcontentloaded')
                            page.get_by_role('button',name='Switch to MULTILEVEL',exact=True).click()
                            page.get_by_text('Local UI MULTILEVEL listening',exact=True).first.wait_for()
                        page.goto('http://localhost:3000/en/mock/'+fixture['examId'],wait_until='domcontentloaded')
                        mode='Timed (exam mode)' if fixture['program']=='IELTS' else 'Practice (untimed)'
                        gate['mode']=mode
                        with page.expect_response(lambda r:'/mock/exams/'+fixture['examId']+'/start' in r.url) as begun:
                            page.get_by_role('button',name=mode,exact=True).click()
                        assert begun.value.status==201,'start HTTP '+str(begun.value.status)
                        aid=begun.value.json()['data']['attemptId'];gate['attemptId']=aid
                        if fixture['skill']=='listening':
                            element=page.locator('audio').first;element.wait_for(state='attached')
                            if fixture['program']=='IELTS':
                                page.get_by_role('button',name='Play audio (once only)',exact=True).click()
                                page.get_by_role('button',name='Played once',exact=True).wait_for(timeout=30000)
                                audio_requests=[r for r in report['network'] if '/mock/groups/'+fixture['groups'][0]+'/audio' in r['url']]
                                assert audio_requests,'No authenticated audio request observed'
                                gate['audioHttpStatus']=audio_requests[-1]['status']
                            else:
                                with page.expect_response(lambda r:'/mock/groups/' in r.url and '/audio' in r.url) as loaded:
                                    element.evaluate('(audio)=>{audio.load();audio.play().catch(()=>{})}')
                                gate['audioHttpStatus']=loaded.value.status
                            assert gate['audioHttpStatus'] in (200,206),'Listening audio HTTP '+str(gate['audioHttpStatus'])
                            for question in fixture['questions']:
                                if question['type'] in ('short_answer','note_completion','sentence_completion','summary_completion'):
                                    page.get_by_role('textbox',name='Answer for question '+str(question['number']),exact=True).fill(question['correctAnswers'][0])
                                else:
                                    page.get_by_role('group',name='Question '+str(question['number']),exact=True).locator('input[value="'+question['correctAnswers'][0]+'"]').check()
                        elif fixture['skill']=='writing':
                            page.locator('textarea').first.wait_for()
                            for index in range(len(fixture['questions'])):
                                if fixture['program']=='MULTILEVEL':
                                    page.locator('[aria-label="Writing task progress"]').get_by_role('button').nth(index).click()
                                page.locator('textarea').first.fill(('Original local test response about learning and community. '*30).strip())
                        else:
                            for question in fixture['questions']:
                                if fixture['program']=='MULTILEVEL':
                                    page.locator('[aria-label="Speaking task progress"]').get_by_role('button').nth(question['groupIndex']).click()
                                panel=page.get_by_text(question['prompt'],exact=True).locator('..').locator('..')
                                if fixture['program']=='IELTS':
                                    page.get_by_role('button',name='Record',exact=True).click()
                                    page.get_by_role('button',name='Stop',exact=True).wait_for()
                                    page.wait_for_timeout(1500)
                                    with page.expect_response(lambda r:'/speaking/'+question['id'] in r.url and r.request.method=='POST') as uploaded:
                                        page.get_by_role('button',name='Stop',exact=True).click()
                                else:
                                    panel.get_by_role('button',name='Test microphone',exact=True).click()
                                    panel.get_by_role('button',name='Start response',exact=True).click()
                                    panel.get_by_role('button',name='Stop recording',exact=True).wait_for()
                                    page.wait_for_timeout(1500)
                                    with page.expect_response(lambda r:'/speaking/'+question['id'] in r.url and r.request.method=='POST' and not r.url.endswith('/start')) as uploaded:
                                        panel.get_by_role('button',name='Stop recording',exact=True).click()
                                assert uploaded.value.status==201,'Speaking upload HTTP '+str(uploaded.value.status)
                                expect(page.get_by_text('Uploading',exact=True)).to_have_count(0,timeout=30000)
                        count=len(fixture['questions']);deadline=time.monotonic()+45
                        predicate='"audioKey" IS NOT NULL' if fixture['skill']=='speaking' else "response<>''"
                        while db.execute('SELECT COUNT(*) FROM "MockAnswer" WHERE "attemptId"=%s AND '+predicate,(aid,)).fetchone()[0]!=count:
                            if time.monotonic()>deadline:raise AssertionError('Not all responses persisted')
                            page.wait_for_timeout(100)
                        page.reload(wait_until='domcontentloaded')
                        if fixture['skill']=='writing':expect(page.locator('textarea').first).to_have_value(re.compile('^Original local test response'),timeout=30000)
                        if fixture['skill']=='speaking' and fixture['program']=='IELTS':page.get_by_role('button',name='Re-record',exact=True).wait_for()
                        if fixture['skill']=='speaking' and fixture['program']=='MULTILEVEL':
                            for part in range(len(fixture['groups'])):
                                page.locator('[aria-label="Speaking task progress"]').get_by_role('button').nth(part).click()
                                expect(page.get_by_text('Uploaded',exact=True)).to_have_count(sum(q['groupIndex']==part for q in fixture['questions']),timeout=30000)
                        assert db.execute('SELECT COUNT(*) FROM "MockAnswer" WHERE "attemptId"=%s AND '+predicate,(aid,)).fetchone()[0]==count
                        with page.expect_response(lambda r:'/mock/attempts/'+aid+'/submit' in r.url and r.request.method=='POST') as finished:
                            page.get_by_role('button',name='Finish',exact=True).click()
                            if fixture['program']=='MULTILEVEL':page.get_by_role('button',name='Submit exam',exact=True).click()
                        assert finished.value.status==201,'submit HTTP '+str(finished.value.status)
                        state=db.execute('SELECT status,"overallBand" FROM "MockAttempt" WHERE id=%s',(aid,)).fetchone()
                        expected='completed' if fixture['skill']=='listening' else 'grading'
                        assert state[0]==expected,(state,expected)
                        if fixture['skill']!='listening':
                            assert state[1] is None
                            assert db.execute('SELECT COUNT(*) FROM "MockAnswer" WHERE "attemptId"=%s AND "isGraded"=true',(aid,)).fetchone()[0]==0
                        gate.update(status='PASS',persistedStatus=state[0],persistedResponses=count,reloadPreserved=True)
                        page.screenshot(path=str(EVIDENCE/(fixture['program']+'_'+fixture['skill']+'_result.png')),full_page=True)
                    except Exception as error:
                        gate['error']=type(error).__name__+': '+str(error)[:1000]
                        capture(page,fixture['program']+'_'+fixture['skill'])
                    report['browser'].append(gate);print('SKILL '+json.dumps(gate),flush=True)
                if any(gate.get('status')=='FAIL' for gate in report['browser']):report['error']='Some rendered skill gates failed; see per-gate evidence'
            if role=='admin' and os.environ.get('BESTWAY_CLIENT_DOMAINS')!='1':
                page.goto('http://localhost:3000/en/exam-builder/new',wait_until='networkidle',timeout=90000)
                report['browser'].append(dict(role=role,gate='create-setup-render',text=page.locator('body').inner_text()[:4500],buttons=page.get_by_role('button').all_text_contents()))
                print('BROWSER '+json.dumps(report['browser'][-1],ensure_ascii=False),flush=True)
                page.locator('#eb-title').fill('Local UI authored IELTS')
                with page.expect_response(lambda r:r.request.method=='POST' and urlparse(r.url).path=='/api/backend/mock/exams') as created_exam:
                    page.get_by_role('button',name='Create & Continue',exact=True).click()
                report['starterRequest']=json.loads(created_exam.value.request.post_data or '{}')
                report['starterResponse']=created_exam.value.json()
                assert created_exam.value.status==201,'Create exam returned HTTP '+str(created_exam.value.status)
                page.wait_for_url('**/exam-builder/*',wait_until='domcontentloaded')
                page.locator('#ov-title').wait_for(state='visible')
                authored_id=created_exam.value.json()['data']['id']
                created_payload=json.loads(created_exam.value.request.post_data or '{}')
                report['starterRequest']=created_payload
                report['starterResponse']=created_exam.value.json()
                assert created_payload['starterStructure'] is True
                assert created_payload['skills']==['reading']
                starter_sections=db.execute('SELECT skill FROM "MockSection" WHERE "examId"=%s ORDER BY "sortOrder"',(authored_id,)).fetchall()
                assert [row[0] for row in starter_sections]==created_payload['skills']
                assert db.execute('SELECT COUNT(*) FROM "MockQuestionGroup" WHERE "sectionId" IN (SELECT id FROM "MockSection" WHERE "examId"=%s)',(authored_id,)).fetchone()[0]==3
                report['browser'].append(dict(role=role,gate='IELTS selected-skill starter through UI',status='PASS',payloadSkills=created_payload['skills'],persistedSections=len(starter_sections),persistedGroups=3,text=page.locator('body').inner_text()[:4500]))
                page.locator('#ov-title').fill('Local UI edited IELTS')
                with page.expect_response(lambda r:r.request.method=='PATCH' and '/mock/exams/'+authored_id in r.url) as saved_draft:
                    page.get_by_role('button',name='Save Draft',exact=True).first.click()
                assert saved_draft.value.status==200
                assert db.execute('SELECT title FROM "MockExam" WHERE id=%s',(authored_id,)).fetchone()[0]=='Local UI edited IELTS'
                with page.expect_response(lambda r:'/mock/exams/'+authored_id+'/readiness' in r.url) as reviewed:
                    page.get_by_role('button',name=re.compile('^Review')).first.click()
                assert reviewed.value.status==200
                with page.expect_response(lambda r:'/mock/exams/'+authored_id+'/preview' in r.url) as preview:
                    page.get_by_role('button',name='Preview',exact=True).first.click()
                assert preview.value.status==200
                assert 'correctAnswers' not in json.dumps(preview.value.json())
                report['browser'].append(dict(role=role,gate='IELTS draft save-Review-keyless Preview',status='PASS',text=page.locator('body').inner_text()[:4500]))
                page.screenshot(path=str(EVIDENCE/'STAGE_B_CLIENT_builder.png'),full_page=True)
            if os.environ.get('BESTWAY_CLIENT_DOMAINS')=='1':
                paths=['dashboard','leaderboard','notifications','videos','news'] if role=='student' else ['dashboard','attendance','payments','notifications','news']
                for path in paths:
                    gate=dict(role=role,gate=path+' rendered local fixture page',status='FAIL',scope='render + API evidence; not complete domain lifecycle')
                    try:
                        before_network=len(report['network'])
                        response=page.goto('http://localhost:3000/en/'+path,wait_until='networkidle',timeout=90000)
                        assert response.status==200 and urlparse(page.url).path=='/en/'+path
                        assert page.get_by_role('heading').count()>0,'No rendered page heading'
                        gate['headings']=page.get_by_role('heading').all_text_contents()
                        gate['requests']=report['network'][before_network:]
                        failures=[r for r in gate['requests'] if r['status']>=400]
                        assert not failures,'Failed domain API requests: '+json.dumps(failures)
                        if path=='attendance':
                            cell=page.locator('[data-grid-cell]').first;cell.wait_for()
                            with page.expect_response(lambda r:'/attendance/bulk' in r.url and r.request.method=='PUT') as changed:cell.click()
                            assert changed.value.status==200
                            assert db.execute('SELECT COUNT(*) FROM "Attendance" WHERE "studentId"=%s',(users['student'],)).fetchone()[0]>0
                            gate['persistedMutation']='attendance cell'
                        if path=='payments':
                            page.locator('[data-grid-cell]').first.click()
                            dialog=page.get_by_role('dialog');dialog.wait_for()
                            dialog.get_by_role('button',name='Paid',exact=True).click();dialog.locator('#amount').fill('100')
                            with page.expect_response(lambda r:'/payments/bulk' in r.url and r.request.method=='PUT') as changed:
                                dialog.get_by_role('button',name='Save',exact=True).click()
                            assert changed.value.status==200
                            assert db.execute('SELECT COUNT(*) FROM "Payment" WHERE "studentId"=%s AND amount=100',(users['student'],)).fetchone()[0]>0
                            gate['persistedMutation']='synthetic local payment grid only; no provider transaction'
                        if path=='notifications':
                            with page.expect_response(lambda r:'/notifications/' in r.url and r.request.method=='PATCH') as changed:
                                page.get_by_role('button').filter(has_text='Local release notification').click()
                            assert changed.value.status==200
                            assert db.execute('SELECT read FROM "Notification" WHERE "userId"=%s AND text=\'Local release notification\'',(users[role],)).fetchone()==(True,)
                            gate['persistedMutation']='notification read'
                        gate['status']='PASS';page.screenshot(path=str(EVIDENCE/(role+'_'+path+'.png')),full_page=True)
                    except Exception as error:
                        gate['error']=type(error).__name__+': '+str(error)[:1000];capture(page,role+'_'+path)
                    report['browser'].append(gate);print('DOMAIN '+json.dumps(gate),flush=True)
                auth_gate=dict(role=role,gate='browser refresh-role gate-logout',status='FAIL')
                try:
                    access=next(c for c in context.cookies() if c['name']=='bw_at')
                    broken=dict(access,value='invalid-local-fixture');context.add_cookies([broken])
                    refreshed=page.evaluate("async()=>{const response=await fetch('/api/backend/auth/me');return {status:response.status,body:await response.json()}}")
                    assert refreshed['status']==200 and refreshed['body']['data']['user']['role']==role
                    assert next(c for c in context.cookies() if c['name']=='bw_at')['value'] not in (access['value'],'invalid-local-fixture')
                    auth_gate['refreshRotatedCookie']=True
                    if role=='student':
                        denied=page.evaluate("async()=>{const response=await fetch('/api/backend/mock/exams',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'ielts_academic',title:'Denied local fixture',starterStructure:false})});return {status:response.status,body:await response.json()}}")
                        assert denied['status']==403,denied['status'];auth_gate['studentAuthorDenied']=True
                        page.goto('http://localhost:3000/en/exam-builder',wait_until='domcontentloaded')
                        assert urlparse(page.url).path=='/en/dashboard';auth_gate['studentStaffRouteRedirect']=True
                    page.goto('http://localhost:3000/en/dashboard',wait_until='networkidle',timeout=90000)
                    page.get_by_role('button',name=re.compile('Local UI '+role)).click()
                    with page.expect_response(lambda r:'/api/auth/logout' in r.url) as logged_out:
                        page.get_by_role('menuitem',name='Log out',exact=True).click()
                    assert logged_out.value.status==200
                    page.wait_for_url('**/en/login',wait_until='domcontentloaded')
                    assert not [c for c in context.cookies() if c['name'] in ('bw_at','bw_rt','bw_role') and c['value']]
                    auth_gate.update(status='PASS',logoutClearedCookies=True)
                except Exception as error:auth_gate['error']=type(error).__name__+': '+str(error)[:1000];capture(page,role+'_auth')
                report['browser'].append(auth_gate);print('AUTH '+json.dumps(auth_gate),flush=True)
                if any(g.get('status')=='FAIL' for g in report['browser']):report['error']='Domain/auth gate failure; see per-gate evidence'
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
        report['runtime'].extend(name+': '+line[:300] for line in lines if re.search(r'"(?:GET|POST|PUT|PATCH|DELETE|OPTIONS) /|Error:|Module not found|GET /|POST /|^\s+at ',line))
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
