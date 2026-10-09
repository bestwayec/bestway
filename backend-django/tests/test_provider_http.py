"""Real HTTP adapter tests against loopback only, never external providers."""
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
from threading import Thread
from django.test import SimpleTestCase
from apps.core.assessment_providers import provider_json
from apps.core.assessment_results import ProviderError

class ProviderHTTPTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length','0')))
                name=self.path.strip('/');status=int(name) if name.isdigit() else 302 if name=='redirect' else 200
                self.send_response(status)
                if name=='redirect':self.send_header('Location','https://example.invalid/private')
                raw=b'{"ok":true}' if name not in ('empty','malformed','large') else b'' if name=='empty' else b'private invalid body' if name=='malformed' else b'x'*(2*1024*1024+1)
                if name=='oversized-header':self.send_header('Content-Length',str(3*1024*1024))
                else:self.send_header('Content-Length',str(len(raw)))
                self.end_headers()
                try:self.wfile.write(raw)
                except (BrokenPipeError,ConnectionResetError):pass
            def log_message(self,*args):pass
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);cls.server.daemon_threads=True
        cls.thread=Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(5);super().tearDownClass()
    def test_success_and_sanitized_http_status_flags(self):
        base='http://127.0.0.1:'+str(self.server.server_port)+'/'
        self.assertEqual(provider_json(base+'success',b'local',{},1000),dict(ok=True))
        for status,code,transient,uncertain in [(401,'PROVIDER_AUTH_FAILED',False,False),(403,'PROVIDER_AUTH_FAILED',False,False),(408,'PROVIDER_REQUEST_REJECTED',False,True),(429,'PROVIDER_RATE_LIMITED',True,False),(500,'PROVIDER_UNAVAILABLE',True,False)]:
            with self.subTest(status=status),self.assertRaises(ProviderError) as caught:provider_json(base+str(status),b'local',{},1000)
            self.assertEqual((caught.exception.code,caught.exception.transient,caught.exception.uncertain),(code,transient,uncertain))
            self.assertNotIn('private',str(caught.exception))
    def test_bounded_empty_and_malformed_bodies(self):
        base='http://127.0.0.1:'+str(self.server.server_port)+'/'
        for path,code in [('empty','PROVIDER_EMPTY_RESPONSE'),('malformed','PROVIDER_MALFORMED_JSON'),('large','PROVIDER_RESPONSE_TOO_LARGE'),('oversized-header','PROVIDER_RESPONSE_TOO_LARGE')]:
            with self.subTest(path=path),self.assertRaises(ProviderError) as caught:provider_json(base+path,b'local',{},1000)
            self.assertEqual(caught.exception.code,code)
        with self.assertRaises(ProviderError) as caught:provider_json(base+'redirect',b'local',{},1000)
        self.assertEqual((caught.exception.code,caught.exception.transient,caught.exception.uncertain),('PROVIDER_NETWORK_FAILURE',True,True))
