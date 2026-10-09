"""Validate existing Prisma schema without creating or altering any table."""
from django.apps import apps
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from common.schema_validation import expected_migrations, migration_problems


class Command(BaseCommand):
    help = 'Read-only production schema/version gate for Prisma-owned Django models.'

    def add_arguments(self, parser):
        parser.add_argument('--skip-ledger', action='store_true',
                            help='Only for a disposable non-public schema on loopback PostgreSQL.')
        parser.add_argument('--migration-history-only', action='store_true',
                            help='Check existing history before migrations; do not inspect model columns.')
        parser.add_argument('--allow-pending', action='store_true',
                            help='Allow unapplied checked-in migrations during the history-only preflight.')

    def handle(self, *args, **options):
        problems = []
        if options['allow_pending'] and not options['migration_history_only']:
            raise CommandError('--allow-pending requires --migration-history-only')
        if options['skip_ledger'] and options['migration_history_only']:
            raise CommandError('History-only preflight cannot skip the ledger')
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION READ ONLY')
            cursor.execute('SELECT current_schema()')
            schema = cursor.fetchone()[0]
            if not schema:
                raise CommandError('Configured schema does not exist')
            if options['skip_ledger'] and (schema == 'public' or
                    connection.settings_dict['HOST'] not in ('localhost', '127.0.0.1', '::1')):
                raise CommandError('--skip-ledger requires a disposable non-public loopback schema')
            if not options['skip_ledger']:
                cursor.execute('SELECT to_regclass(%s)', [f'{schema}._prisma_migrations'])
                if cursor.fetchone()[0] is None:
                    problems.append('Prisma migration ledger is missing; do not baseline automatically')
                else:
                    cursor.execute('SELECT migration_name, checksum, finished_at, rolled_back_at '
                                   'FROM "_prisma_migrations" ORDER BY started_at')
                    problems.extend(migration_problems(expected_migrations(), cursor.fetchall(),
                                                       allow_pending=options['allow_pending']))
            if options['migration_history_only']:
                if problems:
                    raise CommandError('Prisma history compatibility failed:\n' + '\n'.join(problems))
                self.stdout.write(self.style.SUCCESS('Existing Prisma history compatible; pending source migrations allowed'
                    if options['allow_pending'] else 'Existing Prisma history complete and compatible'))
                return
            cursor.execute('SELECT table_name, column_name, udt_name FROM information_schema.columns '
                           'WHERE table_schema = %s', [schema])
            columns = {(table, column): type_name for table, column, type_name in cursor.fetchall()}
            cursor.execute('SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid '
                           'JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=%s', [schema])
            enums = {}
            for name, label in cursor.fetchall():
                enums.setdefault(name, set()).add(label)
            models = list(apps.get_app_config('legacy_schema').get_models())
            for model in models:
                table = model._meta.db_table
                if model._meta.managed:
                    problems.append(f'Prisma-owned model must remain unmanaged: {table}')
                for field in model._meta.local_fields:
                    type_name = columns.get((table, field.column))
                    if type_name is None:
                        problems.append(f'Missing mapped column: {table}.{field.column}')
                        continue
                    choice_field = getattr(field, 'base_field', field)
                    if choice_field.choices:
                        enum_type = type_name.removeprefix('_')
                        if enum_type in enums:
                            missing = set(str(value) for value, _ in choice_field.choices) - enums[enum_type]
                            if missing:
                                problems.append(f'Missing enum values for {table}.{field.column}: {sorted(missing)}')
        if problems:
            raise CommandError('Schema compatibility failed:\n' + '\n'.join(problems))
        self.stdout.write(self.style.SUCCESS(f'Schema compatible: {len(models)} unmanaged models; '
                                             f'Prisma ledger {"skipped for disposable schema" if options["skip_ledger"] else "verified"}'))
