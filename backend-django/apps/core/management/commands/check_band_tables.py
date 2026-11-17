"""Read-only check: the IELTS raw-score -> band tables stored in the database versus the built-in ones.

    python manage.py check_band_tables           # text report
    python manage.py check_band_tables --json    # machine-readable

Super admins can overwrite each table (Listening, Academic Reading, General Training Reading); a
stored table replaces the built-in one for every new result. This lists, per table, whether one is
stored, whether the application can use it (a stored table that does not validate is ignored and the
built-in one is used), and every raw mark (0-40) whose band differs, with the official floor marked:
marks below it show "below 4.0" whatever the table says. Nothing is written to the database.
"""
import json

from django.core.management.base import BaseCommand

from apps.core.mock_scoring import OFFICIAL_BAND_FLOOR, parse_band_table
from apps.core.system_settings import BAND_DEFAULTS, BAND_KEYS
from apps.legacy_schema.models import Setting


def band_at(table, raw):
    """Band of a raw mark (0-40) in a table of [minRaw, band] rows, highest minRaw first."""
    return next((band for minimum, band in table if raw >= minimum), 0)


def compare_table(key, stored):
    """Compare one stored value (None = no row) with the built-in table of `key`."""
    default = BAND_DEFAULTS[key]
    report = dict(table=key, setting=BAND_KEYS[key], stored=stored is not None, usable=None, differences=[])
    if stored is None:
        report['status'] = 'DEFAULT'
        return report
    try:
        table = parse_band_table(stored)
    except (ValueError, TypeError) as error:
        report.update(status='INVALID_IGNORED', usable=False, error=str(error))
        return report
    report['usable'] = True
    floor = OFFICIAL_BAND_FLOOR[key]
    for raw in range(41):
        stored_band, default_band = band_at(table, raw), band_at(default, raw)
        if stored_band != default_band:
            report['differences'].append(dict(raw=raw, stored=stored_band, builtIn=default_band, belowOfficialFloor=raw < floor))
    report['status'] = 'DIFFERENT' if report['differences'] else 'SAME_AS_DEFAULT'
    return report


def build_report():
    rows = {s.key: s.value for s in Setting.objects.filter(key__in=BAND_KEYS.values())}
    return [compare_table(key, rows.get(setting)) for key, setting in BAND_KEYS.items()]


def format_report(report):
    lines = []
    for item in report:
        lines.append(f"{item['table']} ({item['setting']}): {item['status']}")
        if item.get('error'):
            lines.append(f"  stored value is rejected by the application ({item['error']}); the built-in table is used")
        for d in item['differences']:
            note = '  [below the official floor: shown as "below 4.0", the table is not used]' if d['belowOfficialFloor'] else ''
            lines.append(f"  raw {d['raw']:>2}: stored {d['stored']}  built-in {d['builtIn']}{note}")
    return '\n'.join(lines)


class Command(BaseCommand):
    help = 'Compare the stored IELTS band tables with the built-in ones (read-only).'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true', help='Print the report as JSON')

    def handle(self, *args, **options):
        report = build_report()
        self.stdout.write(json.dumps(report, indent=2) if options['json'] else format_report(report))
