"""Read-only report: stored Multilevel levels that differ from the blueprint's level table.

Levels are stored on attempts when they are scored (``cefrLevel`` and each section's
``standardScores[skill].level``). After the move to the agency criteria (38 / 51 / 65) older
attempts keep the level computed with the old floors. This command only counts and lists them;
it never changes data. Re-scoring needs the owner's approval and its own migration.
"""
import json

from django.core.management.base import BaseCommand

from apps.core.mock_scoring import multilevel_level
from apps.legacy_schema.models import MockAttempt


def stored_level_differences(attempts):
    rows = []
    for attempt in attempts:
        changes = {}
        if attempt.overall_score is not None and attempt.cefr_level:
            expected = multilevel_level(attempt.overall_score)
            if expected != attempt.cefr_level:
                changes['overall'] = {'score': attempt.overall_score, 'stored': attempt.cefr_level, 'blueprint': expected}
        for skill, item in (attempt.standard_scores or {}).items():
            value = (item or {}).get('estimatedStandardScore') if isinstance(item, dict) else None
            stored = (item or {}).get('level') if isinstance(item, dict) else None
            if isinstance(value, (int, float)) and stored and 0 <= value <= 75:
                expected = multilevel_level(value)
                if expected != stored:
                    changes[skill] = {'score': value, 'stored': stored, 'blueprint': expected}
        if changes:
            rows.append({'attemptId': attempt.id, 'submittedAt': attempt.submitted_at.isoformat() if attempt.submitted_at else None, 'changes': changes})
    return rows


class Command(BaseCommand):
    help = 'List Multilevel attempts whose stored level differs from the blueprint level table (read-only).'

    def add_arguments(self, parser):
        parser.add_argument('--json', action='store_true')

    def handle(self, *args, **options):
        attempts = MockAttempt.objects.filter(exam__type='multilevel', submitted_at__isnull=False).only(
            'id', 'overall_score', 'cefr_level', 'standard_scores', 'submitted_at')
        total = attempts.count()
        rows = stored_level_differences(attempts.iterator())
        report = {'submittedMultilevelAttempts': total, 'withDifferentStoredLevel': len(rows), 'attempts': rows}
        if options['json']:
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2))
            return
        self.stdout.write(f"Submitted Multilevel attempts: {total}; stored level differs from the blueprint table: {len(rows)}")
        for row in rows[:50]:
            self.stdout.write(f"  {row['attemptId']} {row['submittedAt']} {row['changes']}")
