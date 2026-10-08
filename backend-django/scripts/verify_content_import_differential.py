"""Exact pure-function differential; no semantic normalization, no DB access."""
import copy
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.test')
import django
django.setup()
from apps.core.mock_content import sanitize_content
from apps.core.mock_import_validate import validate_package

html_cases = [None, '', '  <p>Hello <strong>world</strong><br>next</p> ',
    '<script>alert(1)</script><p onclick="bad()">safe</p>',
    '<span data-gap="001">SECRET</span>', '<span>hidden<strong>also hidden</strong></span>safe',
    '<span data-gap="201">invalid</span><span data-gap="200">key</span>',
    '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>',
    '<p>A<p>B', '<ul><li>A<li>B</ul>', '<a href="javascript:bad()">safe</a>',
    '<img src=x onerror=bad()>text', '<p>&amp; &lt; &gt; &quot; &#39; &nbsp;</p>',
    '<span data-gap="1"><span data-gap="2">answer</span></span>',
    '<p><strong>A</p>B</strong>', '<textarea>secret</textarea>public',
    '<h3 class="title">Title</h3><u>underlined</u><em>emphasis</em>',
    '<div><p>Text</p></div>', '<p>A<div>B</div>C', '<!-- comment --><p>safe</p>']
base = dict(schemaVersion='1.0', packageId='fixture', revision=1, profile='practice',
    source=dict(kind='original_practice', label='Fixture'),
    exam=dict(type='ielts_academic', title='Fixture', description='', level='',
        isDemo=False, price=0, isFreeForApproved=False,
        sections=[dict(key='reading', skill='reading', title='Reading', instructions='',
            durationMinutes=60, groups=[dict(key='group', title='Group', instructions='',
                passageText='Passage', questions=[dict(key='q1', number=1,
                    type='multiple_choice', prompt='Choose', options=['A', 'B'],
                    correctAnswers=['A'], points=1)])])]), media=[], reviewIssues=[])
# Include a genuinely valid package, not only matching rejection reports.
group = base['exam']['sections'][0]['groups'][0]
group.update(contentHtml='', audioScript='', contentLayout='document')
group['questions'][0].update(sourceRef='Original fixture', acceptedVariants=[], options=['First choice', 'Second choice'])
cases = [dict(kind='html', value=v) for v in html_cases]
for value in [None, [], {}, base]:
    cases.append(dict(kind='package', value=value))
for field, value in [('schemaVersion', '2.0'), ('revision', 0), ('revision', True),
                     ('profile', 'unknown'), ('extra', True), ('source', {})]:
    pkg = copy.deepcopy(base); pkg[field] = value
    cases.append(dict(kind='package', value=pkg))
for field, value in [('type', 'bad'), ('isPublished', True), ('title', ''), ('price', -1)]:
    pkg = copy.deepcopy(base); pkg['exam'][field] = value
    cases.append(dict(kind='package', value=pkg))
for field, value in [('number', 0), ('type', 'bad'), ('options', []),
                     ('correctAnswers', []), ('extra', True), ('points', 0),
                     ('prompt', ''), ('wordLimit', 0), ('acceptedVariants', ['x'])]:
    pkg = copy.deepcopy(base); pkg['exam']['sections'][0]['groups'][0]['questions'][0][field] = value
    cases.append(dict(kind='package', value=pkg))
for content in html_cases[2:]:
    pkg = copy.deepcopy(base); pkg['exam']['sections'][0]['groups'][0]['contentHtml'] = content
    cases.append(dict(kind='package', value=pkg))
proc = subprocess.run(['node', str(Path(__file__).with_name('nest_content_import_differential.cjs'))],
    input=json.dumps(cases), capture_output=True, text=True, encoding='utf-8', timeout=60)
if proc.returncode:
    raise SystemExit(proc.stderr)
expected = json.loads(proc.stdout)
results = []
for index, (case, reference) in enumerate(zip(cases, expected, strict=True)):
    try:
        value = sanitize_content(case['value']) if case['kind'] == 'html' else validate_package(case['value'])
        actual = dict(value=value)
    except Exception as exc:
        actual = dict(error=str(exc))
    passed = actual == reference
    results.append(dict(case=index, kind=case['kind'], status='PASS' if passed else 'FAIL',
        **({} if passed else dict(nest=reference, django=actual))))
    if not passed:
        print(json.dumps(results[-1], ensure_ascii=True))
print(f'SUMMARY {sum(r["status"] == "PASS" for r in results)}/{len(results)} exact pure-function matches')
raise SystemExit(0 if all(r['status'] == 'PASS' for r in results) else 1)
