"""Recalculate the CEFR level (and, for Multilevel, the overall score) stored on finished attempts.

    python manage.py rescore_cefr_levels --dry-run          # default: list what would change, write nothing
    python manage.py rescore_cefr_levels --dry-run --json
    python manage.py rescore_cefr_levels --apply            # write the changes (one transaction per batch)

Results are stored when they are scored, so attempts finished before the current scales keep the level they
were given. This brings them in line with the scales now in force:

* IELTS: `cefrLevel` from the stored `overallBand` (ielts.org: C2 8.5, C1 7.0, B2 5.5, B1 4.0, below 4.0 BELOW_B1).
* Multilevel: every section's level from its stored standard score, the overall score as the mean of the stored
  section standard scores, and the level from that overall (C1 65, B2 51, B1 38, below 38 BELOW_B1). A leftover
  internal `practiceGrade` (removed; it replaced the Writing/Speaking scores in the overall) is dropped from
  `rawScores`, so the overall is again the mean of the real section scores.

Not touched: section bands, IELTS overall bands, raw scores, answers, certificates already issued, attempts that
are not finished, and section practice (it has no overall or level). Run the dry-run first and read the summary.
"""
import json
from collections import Counter

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.core.mock_scoring import cefr_band, multilevel_level, multilevel_overall_score
from apps.legacy_schema.models import MockAttempt

FIELDS = ('overall_score', 'cefr_level', 'standard_scores', 'raw_scores')
PARTIAL_FLOWS = ('partial_practice', 'single_skill')


def numeric(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def same_number(a, b):
    return a == b or (numeric(a) and numeric(b) and abs(a - b) < 1e-9)


def rescored_ielts(attempt):
    band = attempt.overall_band
    if not numeric(band) or not 0 <= band <= 9:
        return {}
    return {'cefr_level': cefr_band(float(band))}


def rescored_multilevel(attempt):
    changes = {}
    standards = attempt.standard_scores if isinstance(attempt.standard_scores, dict) else {}
    new_standards = {}
    for skill, item in standards.items():
        value = item.get('estimatedStandardScore') if isinstance(item, dict) else None
        if numeric(value) and 0 <= value <= 75:
            level = multilevel_level(float(value))
            if item.get('level') != level or item.get('cefrLevel', level) != level:
                item = dict(item, level=level, **({'cefrLevel': level} if 'cefrLevel' in item else {}))
        new_standards[skill] = item
    if new_standards != standards:
        changes['standard_scores'] = new_standards
    raw = attempt.raw_scores if isinstance(attempt.raw_scores, dict) else {}
    new_raw = {skill: ({k: v for k, v in item.items() if k != 'practiceGrade'} if isinstance(item, dict) else item) for skill, item in raw.items()}
    if new_raw != raw:
        changes['raw_scores'] = new_raw
    scores = [item['estimatedStandardScore'] for item in new_standards.values()
        if isinstance(item, dict) and numeric(item.get('estimatedStandardScore'))]
    short = any(isinstance(item, dict) and item.get('scoreMethod') == 'RAW_ONLY' for item in new_standards.values())
    if scores and not short and numeric(attempt.overall_score):
        overall = multilevel_overall_score(scores)
        level = multilevel_level(overall)
        if not same_number(overall, attempt.overall_score):
            changes['overall_score'] = overall
        if level != attempt.cefr_level:
            changes['cefr_level'] = level
    return changes


def plan(attempt):
    """{field: new value} for one attempt, empty when nothing changes."""
    if attempt.status != 'completed' or attempt.flow_mode in PARTIAL_FLOWS or attempt.score_method == 'PRACTICE_PARTIAL':
        return {}
    exam_type = attempt.exam.type
    if exam_type == 'multilevel':
        changes = rescored_multilevel(attempt)
    elif exam_type in ('ielts_academic', 'ielts_general'):
        changes = rescored_ielts(attempt)
    else:
        return {}
    return {field: value for field, value in changes.items() if field in FIELDS and not (field == 'cefr_level' and value == attempt.cefr_level)}


def describe(attempt, changes):
    row = {'attemptId': attempt.id, 'examType': attempt.exam.type}
    if 'cefr_level' in changes:
        row['cefrLevel'] = {'from': attempt.cefr_level, 'to': changes['cefr_level']}
    if 'overall_score' in changes:
        row['overallScore'] = {'from': attempt.overall_score, 'to': changes['overall_score']}
    if 'standard_scores' in changes:
        row['sectionLevels'] = {skill: {'from': (attempt.standard_scores.get(skill) or {}).get('level'), 'to': item.get('level')}
            for skill, item in changes['standard_scores'].items()
            if isinstance(item, dict) and (attempt.standard_scores.get(skill) or {}).get('level') != item.get('level')}
    if 'raw_scores' in changes:
        row['droppedPracticeGrades'] = sorted(skill for skill, item in (attempt.raw_scores or {}).items()
            if isinstance(item, dict) and 'practiceGrade' in item)
    return row


def build_report(attempts):
    rows, transitions, scanned = [], Counter(), 0
    for attempt in attempts:
        scanned += 1
        changes = plan(attempt)
        if not changes:
            continue
        row = describe(attempt, changes)
        rows.append((attempt, changes, row))
        if 'cefr_level' in changes:
            transitions[f"{attempt.exam.type}: {attempt.cefr_level or '-'} -> {changes['cefr_level']}"] += 1
        if 'overall_score' in changes:
            transitions[f"{attempt.exam.type}: overall score changes"] += 1
        if 'raw_scores' in changes:
            transitions[f"{attempt.exam.type}: internal practice grade dropped"] += 1
    return scanned, rows, transitions


class Command(BaseCommand):
    help = 'Recalculate stored CEFR levels (and Multilevel overall scores) of finished attempts; dry-run by default.'

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument('--dry-run', action='store_true', help='List the changes, write nothing (the default)')
        mode.add_argument('--apply', action='store_true', help='Write the changes')
        parser.add_argument('--json', action='store_true', help='Print the report as JSON')
        parser.add_argument('--limit', type=int, default=50, help='Attempts to list in the text report (default 50)')
        parser.add_argument('--batch', type=int, default=200, help='Attempts per transaction with --apply (default 200)')

    def handle(self, *args, **options):
        if options['batch'] < 1:
            raise CommandError('--batch must be at least 1')
        queryset = MockAttempt.objects.filter(status='completed').select_related('exam').order_by('id')
        scanned, rows, transitions = build_report(queryset.iterator(chunk_size=500))
        applied = 0
        if options['apply']:
            for start in range(0, len(rows), options['batch']):
                with transaction.atomic():
                    for attempt, changes, _ in rows[start:start + options['batch']]:
                        MockAttempt.objects.filter(id=attempt.id).update(**changes)
                        applied += 1
        report = {'mode': 'APPLY' if options['apply'] else 'DRY_RUN', 'scanned': scanned, 'wouldChange': len(rows), 'applied': applied,
                  'transitions': dict(sorted(transitions.items())), 'attempts': [row for _, _, row in rows]}
        if options['json']:
            self.stdout.write(json.dumps(report, ensure_ascii=False, indent=2, default=str))
            return
        verb = 'changed' if options['apply'] else 'would change'
        self.stdout.write(f"{report['mode']}: scanned {scanned} finished attempts; {verb} {len(rows)}"
            + (f" (written: {applied})" if options['apply'] else " (nothing written; run with --apply to write)"))
        for name, count in report['transitions'].items():
            self.stdout.write(f"  {count:>5}  {name}")
        for row in report['attempts'][:max(options['limit'], 0)]:
            self.stdout.write('  ' + json.dumps(row, ensure_ascii=False, default=str))
        if len(rows) > options['limit']:
            self.stdout.write(f"  ... {len(rows) - options['limit']} more (use --limit or --json)")
