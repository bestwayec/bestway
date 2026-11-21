from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.core.mock27.importer import ImportProblem, import_mock27
from apps.legacy_schema.models import User


class Command(BaseCommand):
    help = ('Import BESTWAY IELTS Academic Full Mock Test 27 as a DRAFT (idempotent, transactional). '
            'Listening/Reading come from --source-dir (private packages built by extract_mock27_source); '
            'Writing/Speaking are original. Never publishes.')

    def add_arguments(self, parser):
        parser.add_argument('--author', required=True, help='id of an admin/super_admin user who owns the draft')
        parser.add_argument('--source-dir', help='directory with listening.package.json / reading.package.json')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        actor = User.objects.filter(id=opts['author'], role__in=['admin', 'super_admin']).first()
        if actor is None:
            raise CommandError('--author must be the id of an admin or super_admin user')
        source = Path(opts['source_dir']) if opts['source_dir'] else None
        digests = {}
        if source and (source / 'source_report.json').is_file():
            import json
            digests = {k: v['sha256'] for k, v in json.loads((source / 'source_report.json').read_text())['sources'].items()}
        try:
            result = import_mock27(actor, source_dir=source, source_digests=digests, dry_run=opts['dry_run'])
        except ImportProblem as error:
            raise CommandError(str(error)) from error
        self.stdout.write(str(result))
