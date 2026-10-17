"""Read-only native WebView2 control probe; never load application auth code.

Use the NEW local-configured debug executable, not the production release.
Keep existing OS credentials untouched and use a new D: WebView profile.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from urllib.request import urlopen
from urllib.parse import urlparse
from uuid import uuid4
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
EXE=Path(os.environ['BESTWAY_NATIVE_PROBE_EXE']).resolve()
BUILD=Path('D:/bestway-release-readiness-20261009').resolve()
if not EXE.is_relative_to(BUILD) or EXE.name!='bestway-app.exe' or 'debug' not in EXE.parts:
    raise SystemExit('Only the new local debug executable is allowed')
if not EXE.is_file():raise SystemExit('Local debug executable absent')
existing=subprocess.run(['powershell','-NoProfile','-Command',"@(Get-Process bestway-app -ErrorAction SilentlyContinue).Count"],capture_output=True,text=True,timeout=20)
if existing.returncode or existing.stdout.strip()!='0':raise SystemExit('Refuse to interfere with an existing native app')
for port in (1420,9222):
    try:
        with socket.create_connection(('127.0.0.1',port),timeout=1):raise SystemExit('Probe port already occupied: '+str(port))
    except OSError:pass
report=dict(nativeFunctionalE2E='UNVERIFIED',control='UNVERIFIED',explicitSessionMutationCalls=0,blockedExternal=[])


class Bootstrap(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_GET(self):
        body=b'<!doctype html><title>BESTWAY local native control probe</title><h1>Local read-only native probe</h1>'
        self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)))
        self.end_headers();self.wfile.write(body)


server=ThreadingHTTPServer(('127.0.0.1',1420),Bootstrap)
thread=Thread(target=server.serve_forever,daemon=True);thread.start()
profile=BUILD/('webview-probe-'+uuid4().hex[:12]);profile.mkdir()
proc=None
try:
    env=dict(os.environ,WEBVIEW2_USER_DATA_FOLDER=str(profile),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --disable-background-networking --disable-component-update --no-first-run')
    info=subprocess.STARTUPINFO();info.dwFlags|=subprocess.STARTF_USESHOWWINDOW;info.wShowWindow=subprocess.SW_HIDE
    proc=subprocess.Popen([str(EXE)],cwd=EXE.parent,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
        startupinfo=info,creationflags=subprocess.CREATE_NO_WINDOW)
    for _ in range(120):
        if proc.poll() is not None:raise RuntimeError('Native process exited '+str(proc.returncode))
        try:
            with urlopen('http://127.0.0.1:9222/json/version',timeout=1) as response:response.read()
            break
        except Exception:time.sleep(.5)
    else:raise RuntimeError('WebView2 CDP endpoint did not become available in 60 seconds')
    with sync_playwright() as pw:
        browser=pw.chromium.connect_over_cdp('http://127.0.0.1:9222',timeout=15000)
        context=browser.contexts[0]
        def guard(route):
            host=urlparse(route.request.url).hostname
            if host and host not in ('localhost','127.0.0.1','::1'):
                report['blockedExternal'].append(host);route.abort()
            else:route.continue_()
        context.route('**/*',guard)
        page=context.pages[0];page.get_by_role('heading',name='Local read-only native probe').wait_for(timeout=30000)
        page.wait_for_function('!!window.__TAURI_INTERNALS__',timeout=10000)
        # Return presence metadata only. Never return credentials/profile values.
        report['existingSessionPresent']=page.evaluate("async()=>{const data=await window.__TAURI_INTERNALS__.invoke('session_get');return Object.values(data).some(value=>value!==null&&value!=='')}")
        report['control']='PASS native WebView2 CDP, rendered local bootstrap, real read-only Rust IPC'
        evidence=ROOT/'evidence'/'release-20261009';evidence.mkdir(parents=True,exist_ok=True)
        page.screenshot(path=str(evidence/'NATIVE_CONTROL.png'))
except Exception as error:report['error']=type(error).__name__+': '+str(error)[:1000]
finally:
    if proc and proc.poll() is None:
        subprocess.run(['taskkill','/PID',str(proc.pid),'/T','/F'],capture_output=True,timeout=20);proc.wait(timeout=10)
    server.shutdown();server.server_close();thread.join(timeout=5)
    # Preserve new build/profile artifacts; no cache or personal file deletion.
    report['cleanup']='owned native process tree and bootstrap server stopped; new D: profile retained; no explicit session mutation calls'
    evidence=ROOT/'evidence'/'release-20261009';evidence.mkdir(parents=True,exist_ok=True)
    (evidence/'NATIVE_CONTROL_REPORT.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report))
raise SystemExit(1 if report.get('error') else 0)
