"""Exact local API comparison. No semantic response normalization; no database."""
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.test')
import django
django.setup()
from rest_framework.test import APIClient

cases = [
    {'role': role, 'payload': {'text': text}}
    for role in ['teacher', 'admin', 'super_admin']
    for text in ['1. Explain', 'Instructions\r\n1) Choose\n(A) First\nB. Second',
                 'TRUE FALSE NOT GIVEN\n1. Statement', 'YES NO NOT GIVEN\n1. Statement',
                 '1. Fill ____\n2: Fill ...\n3. Explain', 'No questions']
] + [
    {'role': role, 'payload': {'text': '1. Explain'}} for role in ['student', 'parent', None]
] + [
    {'role': 'teacher', 'payload': payload}
    for payload in [{}, {'text': ''}, {'text': 1}, {'text': 'a' * 20001}, {'text': '\U0001f600' * 10001}, {'text': '1. Explain', 'extra': True}]
]
reference = subprocess.run(
    ['node', str(Path(__file__).with_name('nest_parse_differential.cjs'))],
    input=json.dumps(cases), capture_output=True, text=True, encoding='utf-8', timeout=60,
)
if reference.returncode:
    raise SystemExit(f'Nest harness failed: {reference.stderr}')
nest = json.loads(reference.stdout)
passed = 0
for index, (case, expected) in enumerate(zip(cases, nest, strict=True), 1):
    client = APIClient()
    if case['role']:
        client.force_authenticate(SimpleNamespace(id='fixture-user', role=case['role'], is_authenticated=True))
    response = client.post('/v1/mock/parse-questions', case['payload'], format='json')
    actual = {'status': response.status_code, 'body': response.data}
    if actual == expected:
        passed += 1
        print(f'PASS case={index} role={case["role"]}')
    else:
        print(f'DIFF case={index} role={case["role"]} nest={json.dumps(expected)[:2000]} django={json.dumps(actual)[:2000]}')
print(f'SUMMARY {passed}/{len(cases)} exact matches; authentication injected, JWT not tested')
raise SystemExit(0 if passed == len(cases) else 1)
