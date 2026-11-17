"""Read-only calibration: compare teacher criterion scores (CSV) with the AI's, MAE per criterion.

    python manage.py calibrate_ai_scores --teacher teacher.csv               # AI scores from the database
    python manage.py calibrate_ai_scores --teacher teacher.csv --ai ai.csv   # both from CSV files
    python manage.py calibrate_ai_scores --teacher teacher.csv --json        # machine-readable

CSV layout: see apps/core/calibration.py. Nothing is written to the database.
"""
import json

from django.core.management.base import BaseCommand, CommandError

from apps.core import calibration


class Command(BaseCommand):
    help = 'MAE per rubric criterion between teacher scores (CSV) and AI scores (CSV or database).'

    def add_arguments(self, parser):
        parser.add_argument('--teacher', required=True, help='CSV with job_id, part_id and one column per criterion')
        parser.add_argument('--ai', help='CSV in the same layout; omitted = read the AI evaluations from the database')
        parser.add_argument('--json', action='store_true', help='Print the report as JSON')

    def handle(self, *args, **options):
        try:
            teacher = calibration.read_scores(options['teacher'])
            ai = calibration.read_scores(options['ai']) if options.get('ai') else \
                calibration.ai_scores_from_db({job_id for job_id, _ in teacher})
        except (OSError, ValueError) as error:
            raise CommandError(str(error)) from None
        report = calibration.mae_by_criterion(teacher, ai)
        self.stdout.write(json.dumps(report, indent=2) if options['json'] else calibration.format_report(report))
