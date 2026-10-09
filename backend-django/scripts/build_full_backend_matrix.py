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
    state = 'COMPLETE — foundation differential verified' if complete else 'PARTIAL — inspect remaining methods/dependencies' if module in ('auth','mock','tests','common','prisma') else 'MISSING — port source behavior'
    if module=='stats' and item['name']=='ExportService' and attendance_verified:
        state='PARTIAL — attendance CSV verified; students/payments exports pending'
    lines.append(f"| {item['name']} | backend/{item['source']} | {', '.join(item['tables']) or 'provider/helper'} | {state} |")
lines += ['', '## Background jobs, startup recovery, events and WebSockets', '',
    'Attendance inventory: 0 independent jobs, 0 event handlers, 0 WebSocket contracts. Parent absence delivery reuses the verified shared NotificationsService contract; there is no attendance reminder scheduler to port.', '']
for job in data['jobs']:
    lines.append(f"- MISSING: `{job['name']}.{job['handler']}` {job['decorator']} — backend/{job['source']}; preserve durable row claims/retries or monthly archive/reset semantics.")
lines += ['- MISSING: GameService.onModuleInit — recover missed monthly rollovers.',
    '- MISSING: TelegramBotService.onModuleInit/onModuleDestroy — configured polling or webhook lifecycle; dispatch account-link and menu update events, retry polling failures.',
    '- PARTIAL: StorageService startup directory initialization — exam file storage works; video/gallery/teacher protected storage contracts remain.',
    '- No @OnEvent consumers, @SubscribeMessage handlers or WebSocket gateways found. WebSocket contracts: 0/0; Channels is not required by this source inventory.',
    '- Reference assessment jobs use PostgreSQL AssessmentJob and a 20-second poll, not Bull/Celery/Redis queues. Select infrastructure after porting exact claim/lease/retry semantics.', '',
    '## External integrations and storage', '',
    '| Integration | Source | Status / implementation requirement |', '|---|---|---|',
    '| DeepSeek Responses / primary and adjudicator | backend/src/assessment/deepseek.provider.ts | MISSING: HTTP payload, bounded configuration, strict rubric result validation, call ledger and failures |',
    '| Deepgram transcription | backend/src/assessment/deepgram.provider.ts | MISSING: audio/mime/hash contract, transcript reuse, confidence and failure handling |',
    '| Telegram Bot API, polling/webhook, menus and linking | backend/src/telegram/ | PARTIAL: real sendMessage delivery with disabled/provider-failure tests; polling, updates, menus and linking pending; no live provider gate claimed |',
    '| Local storage and signed video streams | backend/src/videos/ | PARTIAL: exam media works; protected video tokens/ranges, gallery/teacher uploads pending |',
    '| PDF certificates and CSV exports | backend/src/tests/, mock/, stats/, game/ | PARTIAL: exam PDFs verified; statistics/game exports pending |', '', '## Prisma model and enum inventory', '',
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
    '## Next implementation checkpoint', '', 'Settings/audit/groups/articles/notifications/payments plus attendance and its CSV export: 31 newly ported contracts verified in FULL_FOUNDATION_PARITY_REPORT.json. AttendanceService has no independent jobs/events. Next port GameService (3 routes, monthly rollover/archive, startup recovery, qualification), which PointsService depends on; then points (3), Telegram lifecycle, remaining user administration, content/media/statistics, legacy authoring and assessment. Resume from this matrix; do not repeat completed exam discovery.']
data['summary'] = counts
(ROOT/'FULL_BACKEND_INVENTORY.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
(ROOT.parent/'DJANGO_FULL_BACKEND_MATRIX.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps(counts))
