"""Read-only checks around the Mock 27 import. Changes nothing, deletes nothing, never publishes.

  python manage.py check_mock27 --stage preflight --author <id> [--source-dir DIR]
  python manage.py check_mock27 --stage post
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.migrations.recorder import MigrationRecorder

from apps.core.mock27 import EXAM_SLUG
from apps.core.mock27 import gates
from apps.core.mock27.importer import PRIVATE_FILES
from apps.core.mock27.package_checks import evidence_issues, objective_issues
from apps.core.models import MockExamGate
from apps.legacy_schema.models import MockAttempt, MockExam, MockQuestion, User

REQUIRED_TABLES = ('MockExam', 'MockSection', 'MockQuestionGroup', 'MockQuestion', 'MockExamImport',
                   'MockImportSourceMap', 'MockStagedMedia', 'MockAttempt', 'MockAnswer', 'StudentProfile', 'User')


class Report:
    def __init__(self, out):
        self.out, self.failed = out, 0

    def row(self, ok, message, *, warn=False):
        label = 'PASS' if ok else ('WARN' if warn else 'FAIL')
        self.failed += 0 if ok or warn else 1
        self.out(f'{label} {message}')


def inside_git_worktree(path: Path) -> bool:
    return any((p / '.git').exists() for p in [path.resolve(), *path.resolve().parents])


class Command(BaseCommand):
    help = __doc__

    def add_arguments(self, parser):
        parser.add_argument('--stage', choices=('preflight', 'post'), required=True)
        parser.add_argument('--author')
        parser.add_argument('--source-dir')
        parser.add_argument('--exam-id', default=EXAM_SLUG)

    def handle(self, *args, **opts):
        r = Report(self.stdout.write)
        exam_id = opts['exam_id']
        if opts['stage'] == 'preflight':
            self.preflight(r, opts, exam_id)
        else:
            self.post(r, exam_id)
        if r.failed:
            raise CommandError(f'{r.failed} check(s) failed')
        self.stdout.write('ALL REQUIRED CHECKS PASSED')

    # ------------------------------------------------------------------ preflight
    def preflight(self, r, opts, exam_id):
        r.row(connection.vendor == 'postgresql', f'database is PostgreSQL ({connection.vendor})')
        applied = {name for app, name in MigrationRecorder.Migration.objects.values_list('app', 'name') if app == 'core'}
        r.row('0018_mock_exam_gate_and_listening_audio' in applied, 'Django migration core.0018 (audio gate tables) is applied')
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public._prisma_migrations') IS NOT NULL")
            ledger = cursor.fetchone()[0]
            r.row(ledger, 'Prisma migration ledger exists (database was migrated with prisma migrate deploy)')
            if ledger:
                cursor.execute('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL')
                r.row(cursor.fetchone()[0] == 0, 'no unfinished or rolled-back Prisma migrations')
            cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()")
            present = {row[0] for row in cursor.fetchall()}
        r.row(not [t for t in REQUIRED_TABLES if t not in present], f'required Prisma tables present {[t for t in REQUIRED_TABLES if t not in present] or ""}')
        root = Path(settings.MEDIA_ROOT)
        r.row(root.is_absolute() and root.is_dir(), f'STORAGE_DIR resolves to an existing absolute directory: {root}')
        try:
            with tempfile.NamedTemporaryFile(dir=root, prefix='.m27-preflight-') as handle:
                handle.write(b'ok')
            r.row(True, 'STORAGE_DIR is writable (probe file created and removed)')
        except OSError as error:
            r.row(False, f'STORAGE_DIR is not writable: {error}')
        r.row(os.environ.get('STORAGE_DIR') is not None, 'STORAGE_DIR is set explicitly (not the repository default)', warn=True)
        try:
            import av  # noqa: F401
            r.row(True, 'PyAV is installed (audio validation and duration measurement)')
        except ImportError:
            r.row(False, 'PyAV is missing: install requirements/prod.txt')
        actor = User.objects.filter(id=opts['author'], role__in=['admin', 'super_admin']).first() if opts['author'] else None
        r.row(actor is not None, '--author is an administrator account')
        exam = MockExam.objects.filter(id=exam_id).first()
        if exam is None:
            r.row(True, f'exam {exam_id} does not exist yet: the import will create a DRAFT')
        else:
            r.row(not exam.is_published and not exam.is_demo, 'existing exam is an unpublished, non-demo draft')
            r.row(not MockAttempt.objects.filter(exam_id=exam_id).exists(), 'no attempts exist for the exam (student data untouched)')
        if opts['source_dir']:
            source = Path(opts['source_dir'])
            r.row(source.is_dir(), f'source directory exists: {source}')
            r.row(not inside_git_worktree(source), 'source directory is OUTSIDE any git work tree (third-party material must never be committed)')
            for skill, (name, groups) in PRIVATE_FILES.items():
                path = source / name
                if not path.is_file():
                    r.row(False, f'{name} is missing')
                    continue
                package = json.loads(path.read_text(encoding='utf-8'))
                problems = objective_issues(package, expected_groups=groups) + (evidence_issues(package) if skill == 'reading' else [])
                r.row(not problems, f'{skill}: 40/40 questions, keys, options and numbering valid {problems[:2] or ""}')
        self.stdout.write('This command is read-only. Next: take a database backup, then run import_mock27 --dry-run.')

    # ------------------------------------------------------------------ post
    def post(self, r, exam_id):
        exam = MockExam.objects.filter(id=exam_id).first()
        r.row(exam is not None, f'exam {exam_id} exists')
        if exam is None:
            return
        r.row(exam.type == 'ielts_academic' and exam.profile == 'full_mock', 'type ielts_academic, profile full_mock')
        r.row(not exam.is_published and not exam.is_demo, f'exam is an unpublished, non-demo DRAFT (published={exam.is_published}, demo={exam.is_demo})', warn=exam.is_published)
        counts = {s: MockQuestion.objects.filter(group__section__exam_id=exam_id, group__section__skill=s).count()
                  for s in ('listening', 'reading', 'writing', 'speaking')}
        r.row(counts == dict(listening=40, reading=40, writing=2, speaking=3), f'question counts {counts}')
        gate = MockExamGate.objects.filter(exam_id=exam_id).first()
        r.row(gate is not None, 'publication gate row exists')
        if gate:
            r.row(True, f'content rights: {gate.content_rights}; sources: {gate.rights_sources}')
        parts = gates.parts_report(exam_id)
        self.stdout.write('Listening audio: ' + ', '.join(f'Part {p["partNumber"]}={p["status"]}' for p in parts))
        self.stdout.write('Blockers: ' + ('; '.join(gates.blockers(exam)) or 'none'))
