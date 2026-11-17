"""AI vs teacher calibration: mean absolute error per rubric criterion.

Teacher CSV (one row per assessed part):
    job_id,part_id,<criterion>,<criterion>,...
    e.g. job_id,part_id,ta,cc,lr,gra            (IELTS Writing; part_id task1:<q> / task2:<q>)
         job_id,part_id,fluency,lexical,grammar,pronunciation   (IELTS Speaking; part_id speaking)
A blank cell means the teacher did not score that criterion; it is left out of the error.

AI scores come either from a second CSV in the same layout, or from the database: the job's
selected (else latest successful) AI evaluation, never the teacher-finalised result.
"""
from __future__ import annotations

import csv
import math
from collections import defaultdict

KEY_COLUMNS = ('job_id', 'part_id')
# Optional descriptive columns the export may carry; they are not criteria.
META_COLUMNS = {'skill', 'program', 'student', 'student_id', 'attempt_id', 'teacher', 'note', 'comment'}


def _number(value):
    if value is None:
        return None
    text = str(value).strip().replace(',', '.')
    if not text:
        return None
    number = float(text)
    if not math.isfinite(number):
        raise ValueError(f'Not a finite score: {value!r}')
    return number


def read_scores(path):
    """{(job_id, part_id): {criterion: score}} from a CSV file."""
    with open(path, newline='', encoding='utf-8-sig') as handle:
        return parse_rows(csv.DictReader(handle))


def parse_rows(rows):
    scores = {}
    for line, row in enumerate(rows, start=2):
        row = {(k or '').strip(): v for k, v in row.items()}
        missing = [c for c in KEY_COLUMNS if not (row.get(c) or '').strip()]
        if missing:
            raise ValueError(f'Line {line}: missing {", ".join(missing)}')
        key = (row['job_id'].strip(), row['part_id'].strip())
        values = {}
        for column, value in row.items():
            if column in KEY_COLUMNS or column.lower() in META_COLUMNS or not column:
                continue
            try:
                number = _number(value)
            except ValueError as error:
                raise ValueError(f'Line {line}, {column}: {error}') from None
            if number is not None:
                values[column] = number
        scores[key] = values
    return scores


def mae_by_criterion(teacher, ai):
    """Per criterion: number of paired scores, MAE, mean signed error (AI - teacher) and the
    share of pairs within half a band. Parts or criteria only one side scored are counted apart."""
    errors = defaultdict(list)
    unmatched = []
    for key, teacher_scores in teacher.items():
        ai_scores = ai.get(key)
        if ai_scores is None:
            unmatched.append(key)
            continue
        for criterion, expected in teacher_scores.items():
            actual = ai_scores.get(criterion)
            if actual is not None:
                errors[criterion].append(actual - expected)
    report = {}
    for criterion in sorted(errors):
        values = errors[criterion]
        report[criterion] = dict(
            n=len(values),
            mae=round(sum(abs(v) for v in values) / len(values), 3),
            bias=round(sum(values) / len(values), 3),
            withinHalfBand=round(sum(abs(v) <= 0.5 for v in values) / len(values), 3),
        )
    every = [v for values in errors.values() for v in values]
    overall = dict(n=len(every), mae=round(sum(abs(v) for v in every) / len(every), 3) if every else None)
    return dict(criteria=report, overall=overall, unmatchedParts=sorted(unmatched))


def ai_scores_from_db(job_ids):
    """The AI's own criterion scores for the given jobs (selected evaluation, else latest)."""
    from apps.legacy_schema.models import AssessmentEvaluation, AssessmentJob

    jobs = {job.id: job for job in AssessmentJob.objects.filter(id__in=list(job_ids))}
    scores = {}
    for job_id, job in jobs.items():
        evaluations = list(AssessmentEvaluation.objects.filter(job_id=job_id, status='SUCCEEDED').order_by('-completed_at'))
        evaluation = next((e for e in evaluations if e.id == job.selected_evaluation_id), evaluations[0] if evaluations else None)
        for part in ((evaluation.result or {}) if evaluation else {}).get('parts') or []:
            scores[(job_id, str(part.get('id')))] = {k: float(v) for k, v in (part.get('criteria') or {}).items() if v is not None}
    return scores


def format_report(report):
    lines = ['criterion        n     MAE    bias  within 0.5']
    for criterion, row in report['criteria'].items():
        lines.append(f"{criterion:<14} {row['n']:>3} {row['mae']:>7.3f} {row['bias']:>+7.3f} {row['withinHalfBand']:>10.0%}")
    overall = report['overall']
    lines.append(f"{'overall':<14} {overall['n']:>3} {overall['mae'] if overall['mae'] is not None else '-':>7}")
    if report['unmatchedParts']:
        lines.append(f"no AI score for {len(report['unmatchedParts'])} part(s): " + ', '.join('/'.join(k) for k in report['unmatchedParts'][:10]))
    return '\n'.join(lines)
