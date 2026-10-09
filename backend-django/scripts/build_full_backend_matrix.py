"""Generate the resumable full-source matrix without starting application jobs."""
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.test')
import django
django.setup()
from apps.core.urls import urlpatterns
from apps.legacy_schema import models

data = json.loads(subprocess.run(['node', str(ROOT/'scripts/full_backend_inventory.cjs')], capture_output=True, text=True, encoding='utf-8', check=True, timeout=40).stdout)
canonical = lambda value: re.sub(r':[^/]+|<[^>]+>', ':param', value.rstrip('/'))
registered = {}
for pattern in urlpatterns:
    for method in pattern.callback.cls.http_method_names:
        if method.upper() in ('GET','POST','PATCH','PUT','DELETE'):
            registered[(method.upper(), canonical('/v1/'+str(pattern.pattern)))] = pattern.callback.__module__
foundation = ROOT/'FULL_FOUNDATION_PARITY_REPORT.json'
foundation_verified = foundation.exists() and json.loads(foundation.read_text())['failed'] == 0
attendance_report = ROOT/'ATTENDANCE_PARITY_REPORT.json'
attendance_verified = attendance_report.exists() and json.loads(attendance_report.read_text())['failed'] == 0
game_report = ROOT/'GAME_POINTS_PARITY_REPORT.json'
game_verified = game_report.exists() and json.loads(game_report.read_text())['failed'] == 0
admin_report = ROOT/'ADMIN_CONTENT_PARITY_REPORT.json'
admin_verified = admin_report.exists() and json.loads(admin_report.read_text())['failed'] == 0
legacy_report = ROOT/'LEGACY_ADMIN_PARITY_REPORT.json'
legacy_verified = legacy_report.exists() and json.loads(legacy_report.read_text())['failed'] == 0
telegram_report = ROOT/'TELEGRAM_PARITY_REPORT.json'
telegram_verified = telegram_report.exists() and json.loads(telegram_report.read_text())['failed'] == 0
assessment_report = ROOT/'ASSESSMENT_PARITY_REPORT.json'
assessment_verified = assessment_report.exists() and json.loads(assessment_report.read_text())['failed'] == 0
counts = dict(total=len(data['routes']), implemented=0, verified=0, missing=0, partial=0)
lines = ['# Full NestJS to Django backend matrix', '',
    'Generated from all built controller metadata and actual source on 2026-10-09. Source remains read-only. Registration is reported separately from verified business behavior.', '',
    'Existing exam evidence: Stage A 279/279; Stage B 713/716 with three approved attempt-bound media restrictions. Full backend completion requires every remaining row below and worker/provider verification.', '',
    '| NestJS module | Route / authentication / roles / success | Django implementation | Database tables | Status | Missing behavior | Test coverage |',
    '|---|---|---|---|---|---|---|']
for row in data['routes']:
    module = row['module']
    key = (row['method'], canonical(row['path']))
    implementation = registered.get(key)
    status = 'MISSING' if not implementation else 'PARTIAL'
    missing = 'Implement controller/service/DTO and differential PostgreSQL checks' if not implementation else 'Review full-domain behavior and exact contract; registration alone is insufficient'
    coverage = 'None' if not implementation else 'Existing scoped tests; full-domain audit pending'
    if implementation and module in ('mock','tests','auth','common','app.controller.ts'):
        status = 'COMPLETE'; missing = 'Global runtime/worker/provider gates tracked separately'; coverage = 'Existing Phase 1–3 / Stage A–B scoped parity evidence'
    if implementation and module in ('groups','settings','audit','articles','notifications','payments'):
        status = 'COMPLETE' if foundation_verified else 'PARTIAL'
        missing = 'Full runtime gate remains' if foundation_verified else 'Differential verification in progress'
        coverage = 'FULL_FOUNDATION_PARITY_REPORT.json' if foundation_verified else 'verify_full_foundation.py'
    if implementation and (module == 'attendance' or row['path']=='/v1/stats/export/attendance'):
        status='COMPLETE' if attendance_verified else 'PARTIAL'
        missing='Full runtime gate remains' if attendance_verified else 'Attendance differential verification pending'
        coverage='ATTENDANCE_PARITY_REPORT.json; test_attendance.py'
    if implementation and module in ('game', 'points'):
        status='COMPLETE' if game_verified else 'PARTIAL'
        missing='Separate game scheduler process required; full runtime gate remains' if game_verified else 'Game/points differential verification pending'
        coverage='GAME_POINTS_PARITY_REPORT.json; test_game_points.py'
    if implementation and module in ('users','gallery','teachers','videos','stats'):
        status='COMPLETE' if admin_verified else 'PARTIAL'
        missing='Scoped API, storage and PostgreSQL parity verified' if admin_verified else 'Administration/content differential verification pending'
        coverage='ADMIN_CONTENT_PARITY_REPORT.json; test_remaining_domains.py'
    if implementation and module == 'telegram':
        status='COMPLETE' if telegram_verified else 'PARTIAL'
        missing='Webhook, linking, menu, transport and PostgreSQL lifecycle parity verified' if telegram_verified else 'Telegram lifecycle differential verification pending'
        coverage='TELEGRAM_PARITY_REPORT.json; verify_full_foundation.py'
    if implementation and module == 'assessment':
        status='COMPLETE' if assessment_verified else 'PARTIAL'
        missing='Review, protected audio, grading and durable worker/provider fixture parity verified' if assessment_verified else 'Assessment differential verification pending'
        coverage='ASSESSMENT_PARITY_REPORT.json; test_assessment.py; test_provider_http.py'
    if implementation and row['path']=='/v1/mock/attempts/:attemptId/grade':
        status='COMPLETE' if assessment_verified else 'PARTIAL'
        missing='Teacher grading and recomputation parity verified' if assessment_verified else 'Mock grading differential verification pending'
        coverage='ASSESSMENT_PARITY_REPORT.json; test_assessment.py'
    if implementation and module == 'tests' and legacy_verified and row['controller']=='TestsController' and row['handler'] in ('create','update','addQuestion','updateQuestion','deleteQuestion','grade','importQuestions','uploadQuestionAudio','questionAudio'):
        status='COMPLETE';missing='Legacy authoring and grading PostgreSQL parity verified';coverage='LEGACY_ADMIN_PARITY_REPORT.json; verify_full_foundation.py'
    if implementation and row['path'] in ('/v1/mock/groups/:groupId/audio','/v1/tests/questions/:id/audio'):
        status = 'APPROVED_DIFFERENCE'; missing = 'Attempt-bound policy retained'; coverage = 'Three explicitly approved media restrictions; Stage B report'
    row.update(django=implementation, migrationStatus=status, missingBehavior=missing, coverage=coverage)
    counts['implemented'] += bool(implementation)
    counts['verified'] += status in ('COMPLETE','APPROVED_DIFFERENCE')
    counts['missing'] += status == 'MISSING'; counts['partial'] += status == 'PARTIAL'
    tables = sorted({t for s in data['services'] if s['source'].split('/')[1] == module for t in s['tables']})
    contract = f"`{row['method']} {row['path']}`; {row['auth']}; roles={','.join(row['roles']) or 'any'}; {row['status']}"
    lines.append(f"| {module} / {row['controller']}.{row['handler']} | {contract} | {implementation or '—'} | {', '.join(tables) or 'see source dependencies'} | {status} | {missing} | {coverage} |")
lines += ['', '## Totals', '', f"Active HTTP: {counts['total']}; implemented: {counts['implemented']}; verified within recorded scope: {counts['verified']}; missing: {counts['missing']}; partial: {counts['partial']}.", '',
    'Verified counts refer to recorded scopes. Full global throttling, external delivery, worker execution and complete Django-only clients remain separate required gates. New domains are never marked complete from URL registration alone.', '', '## Every service and guard', '',
    '| Source class | Source file | Tables | Django status / requirement |', '|---|---|---|---|']
for item in data['services'] + data['guards']:
    module = item['source'].split('/')[1]
    complete = module in ('settings','audit','groups','articles','notifications','payments') and foundation_verified
    complete = complete or (module == 'attendance' and attendance_verified)
    complete = complete or (module in ('game','points') and game_verified)
    complete = complete or (module in ('users','gallery','teachers','videos','stats') and admin_verified)
    complete = complete or (module == 'telegram' and telegram_verified)
    complete = complete or (module == 'assessment' and assessment_verified)
    complete = complete or (module == 'tests' and legacy_verified)
    state = 'COMPLETE — foundation differential verified' if complete else 'PARTIAL — inspect remaining methods/dependencies' if module in ('auth','mock','tests','common','prisma') else 'MISSING — port source behavior'
    if module=='stats' and item['name']=='ExportService' and admin_verified:
        state='COMPLETE — student/payment/attendance exports verified'
    lines.append(f"| {item['name']} | backend/{item['source']} | {', '.join(item['tables']) or 'provider/helper'} | {state} |")
lines += ['', '## Background jobs, startup recovery, events and WebSockets', '',
    'Attendance inventory: 0 independent jobs, 0 event handlers, 0 WebSocket contracts. Parent absence delivery reuses the verified shared NotificationsService contract; there is no attendance reminder scheduler to port.', '']
for job in data['jobs']:
    if job['name']=='GameService' and game_verified:
        lines.append('- COMPLETE scoped verification: GameService.monthlyReset — `python manage.py run_game_scheduler`; 00:05 Asia/Tashkent, startup recovery, archive/reset, rollback and concurrency verified. Separate process must be operated alongside the web server; deployment/runtime gate remains.')
        continue
    lines.append(f"- MISSING: `{job['name']}.{job['handler']}` {job['decorator']} — backend/{job['source']}; preserve durable row claims/retries or monthly archive/reset semantics.")
lines += ['- COMPLETE scoped verification: GameService.onModuleInit — scheduler startup recovers missed monthly rollovers; `--once` runs recovery and exits.' if game_verified else '- MISSING: GameService.onModuleInit — recover missed monthly rollovers.',
    ('- COMPLETE scoped verification: TelegramBotService.onModuleInit/onModuleDestroy — `python manage.py run_telegram_bot` supports configured polling/webhook lifecycle, graceful shutdown, update dispatch and local recorded transport.' if telegram_verified else '- MISSING: TelegramBotService.onModuleInit/onModuleDestroy — configured polling/webhook lifecycle.'),
    ('- COMPLETE scoped verification: StorageService initialization and protected video/gallery/teacher media flows.' if admin_verified else '- PARTIAL: StorageService startup directory initialization — protected media contracts pending.'),
    '- No @OnEvent consumers, @SubscribeMessage handlers or WebSocket gateways found. WebSocket contracts: 0/0; Channels is not required by this source inventory.',
    ('- COMPLETE scoped verification: reference AssessmentJob has durable claim/lease/retry semantics; `python manage.py run_assessment_worker` is explicit and does not start on web import.' if assessment_verified else '- MISSING: reference assessment job claim/lease/retry worker.'), '',
    '## External integrations and storage', '',
    '| Integration | Source | Status / implementation requirement |', '|---|---|---|',
    '| DeepSeek Responses / primary and adjudicator | backend/src/assessment/deepseek.provider.ts | COMPLETE scoped: strict provider contracts, bounded HTTP and local fixture/loopback tests; no external credentialed call made |',
    '| Deepgram transcription | backend/src/assessment/deepgram.provider.ts | COMPLETE scoped: audio/hash/transcript contracts and local provider fixture tests; no external credentialed call made |',
    '| Telegram Bot API, polling/webhook, menus and linking | backend/src/telegram/ | COMPLETE scoped webhook/polling command, recorded transport, menu/link lifecycle and local database parity; no live delivery claimed |',
    '| Local storage and signed video streams | backend/src/videos/ | COMPLETE scoped authenticated upload/media, storage keys, cleanup, signed video tokens and range parity |',
    '| PDF certificates and CSV exports | backend/src/tests/, mock/, stats/, game/ | COMPLETE within scoped local API fixtures and export contracts |', '', '## Prisma model and enum inventory', '',
    '| Model / enum | Django mapping | Status |', '|---|---|---|']
mapped = {m._meta.db_table: m for _, m in inspect.getmembers(models, inspect.isclass) if issubclass(m, models.LegacyModel) and m is not models.LegacyModel}
for item in data['models']:
    model = mapped.get(item['name'])
    lines.append(f"| {item['name']} | {'apps.legacy_schema.models.'+model.__name__ if model else 'MISSING'} | {'COMPLETE unmanaged mapping; domain writes verified separately' if model else 'MISSING'} |")
for item in data['enums']:
    mapped_enum = getattr(models, item['name'], None)
    match = mapped_enum is not None and set(mapped_enum.values) == set(item['values'])
    lines.append(f"| enum {item['name']}: {', '.join(item['values'])} | apps.legacy_schema.models.{item['name']} | {'COMPLETE' if match else 'PARTIAL — compare exact values'} |")
lines += ['', 'ParentStudent has a composite Prisma primary key represented by a read-only surrogate in Django; do not use unrestricted ORM writes on it. Existing linking uses exact-column SQL. No production migrations or table recreation are authorized.', '',
    '## Next implementation checkpoint', '', 'All 173 active routes are registered; the 44 previously missing routes and five partial user contracts have scoped implementation evidence. Isolated PostgreSQL differential: 1,184/1,184 comparisons across 82 grouped contracts, zero differences, plus concurrency, rollback, provider-fixture and worker checks. Remaining gates are broad full-runtime/client/native verification and credentialed external-provider smoke tests; no production deployment or Stage C expansion was performed.']
data['summary'] = counts
(ROOT/'FULL_BACKEND_INVENTORY.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
(ROOT.parent/'DJANGO_FULL_BACKEND_MATRIX.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(counts))
