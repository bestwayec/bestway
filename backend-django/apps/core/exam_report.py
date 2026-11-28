"""One authoritative dataset for an assigned exam (BESTWAY 5.1).

The teacher Result Center, the Excel export, the private Telegram leaderboard and the
classroom aggregate report all read ``build``; there is no second result calculation.

Rules
* Roster: the participant snapshot taken when the exam was assigned (current members only
  for legacy assignments without one). One row per eligible student, always.
* Attempt selection: the latest attempt linked to this assignment (one per assignment).
* Participation (not_started, in_progress, submitted, auto_submitted, not_submitted) and
  grading (none, awaiting_assessment, awaiting_teacher_review, partially_graded, finalized)
  are separate dimensions, so counts reconcile.
* A Writing/Speaking score is shown only once the teacher confirmed it; Overall only when
  every required subjective grade is teacher-confirmed. Pending is never 0; a real 0 stays 0.
* Ranking: finalized results only, score descending, shared competition ranking for ties
  (1, 2, 2, 4); inside a tie the order is by name and does not imply a better rank.
  Completion speed never breaks a tie.
* Growth: the student's previous finalized attempt on the same exam type and flow,
  submitted before this one. Different scales (IELTS band, Multilevel /75, raw objective)
  are never compared.
* Stage: ``open`` before closure; ``preliminary`` after closure while any submitted result
  is not final or any attempt is still running; ``final`` after closure once every
  submitted result is finalized.
"""
from __future__ import annotations

import hashlib
import json
from math import isfinite
from statistics import median

from django.utils import timezone

from apps.legacy_schema.models import MockAttempt, User

from .homework_scoring import ASSIGNMENT_KEY
from .mock_attempts import AUTO_SUBMIT_KEY, aware
from .models import HomeworkAssignment
from .teacher_analytics import classroom_assessments

SUBJECTIVE = ("writing", "speaking")
SKILLS = ("listening", "reading", "writing", "speaking")


def fail(code, message, status):
    from common.api.exceptions import ContractAPIException
    raise ContractAPIException(code, message, status)


def scale_of(exam_type):
    return "multilevel" if exam_type == "multilevel" else "ielts" if exam_type in ("ielts_academic", "ielts_general") else "raw"


def _num(value, maximum):
    return value if type(value) in (int, float) and isfinite(value) and 0 <= value <= maximum else None


def _skill(attempt, skill, scale):
    if scale == "multilevel":
        value = (attempt.standard_scores or {}).get(skill)
        value = value.get("estimatedStandardScore") if isinstance(value, dict) else value
        return _num(value, 75)
    band = _num((attempt.section_bands or {}).get(skill), 9)
    if band is not None:
        return band
    raw = (attempt.raw_scores or {}).get(skill)
    return raw.get("score") if isinstance(raw, dict) and _num(raw.get("score"), raw.get("max") or 0) is not None else None


def _raw_total(attempt):
    score = total = 0
    for value in (attempt.raw_scores or {}).values():
        if isinstance(value, dict) and type(value.get("max")) in (int, float) and value["max"] > 0:
            score += value.get("score") or 0
            total += value["max"]
    return (score, total) if total else (None, None)


def _overall(attempt, scale):
    if scale == "multilevel":
        return _num(attempt.overall_score, 75)
    if scale == "ielts" and attempt.flow_mode == "full_test":
        return _num(attempt.overall_band, 9)
    if scale == "ielts" and attempt.overall_band is not None:
        return _num(attempt.overall_band, 9)
    return _raw_total(attempt)[0]


def assignment_for(actor, assignment_id):
    """The assignment, if the actor supervises its classroom (current permission, every call)."""
    row = HomeworkAssignment.objects.select_related("cohort", "cohort__classroom", "exam").filter(pk=assignment_id).first()
    if row is None or row.exam_id is None:
        fail("NOT_FOUND", "Imtihon topilmadi", 404)
    role = getattr(actor, "role", None)
    if role in ("admin", "super_admin"):
        return row
    teacher_id = row.cohort.classroom.teacher_id if row.cohort.classroom_id else row.cohort.teacher_id
    if role != "teacher" or str(teacher_id) != str(actor.id):
        fail("NOT_FOUND", "Imtihon topilmadi", 404)
    return row


def roster_ids(row):
    if row.participant_ids is not None:
        return list(row.participant_ids)
    from .classrooms import participant_ids
    return participant_ids(row.cohort)


def _attempts(row, ids):
    rows = list(MockAttempt.objects.select_related("exam").filter(
        exam_id=row.exam_id, student_id__in=ids, media_state__contains={ASSIGNMENT_KEY: row.id}).order_by("student_id", "-started_at"))
    selected = {}
    for attempt in rows:
        selected.setdefault(attempt.student_id, attempt)
    return selected


def _previous(row, attempts):
    """Previous finalized attempt per student on the same exam type and flow (one query)."""
    if not attempts:
        return {}
    rows = list(MockAttempt.objects.select_related("exam").filter(
        student_id__in=list(attempts), status="completed", exam__type=row.exam.type,
        submitted_at__isnull=False, submitted_at__lt=max(aware(a.submitted_at or a.started_at) for a in attempts.values()),
    ).exclude(id__in=[a.id for a in attempts.values()]).order_by("student_id", "-submitted_at")[:2000])
    if not rows:
        return {}
    classroom_assessments(rows)
    out = {}
    for prior in rows:
        current = attempts.get(prior.student_id)
        if current is None or prior.student_id in out or getattr(prior, "unconfirmed_classroom_grade", False):
            continue
        if prior.flow_mode != current.flow_mode or aware(prior.submitted_at) >= aware(current.submitted_at or current.started_at):
            continue
        out[prior.student_id] = prior
    return out


def _monitor(rows, attempts):
    """Live monitor facts from persisted data only: confirmed (server-stored) answers, last
    confirmed answer time, current skill and integrity observations. No answer content."""
    from django.db.models import Count, Max, Q
    from apps.legacy_schema.models import MockAnswer
    from .models import ExamIntegrityIncident
    ids = [a.id for a in attempts.values()]
    answers = {r["attempt_id"]: r for r in MockAnswer.objects.filter(attempt_id__in=ids).values("attempt_id").annotate(
        confirmed=Count("id", filter=~Q(response="") | Q(audio_key__isnull=False)), last=Max("updated_at"))} if ids else {}
    incidents = dict(ExamIntegrityIncident.objects.filter(attempt_id__in=ids).values("attempt_id").annotate(n=Count("id"))
                     .values_list("attempt_id", "n")) if ids else {}
    for entry in rows:
        attempt = attempts.get(entry["studentId"])
        if attempt is None:
            entry["monitor"] = None
            continue
        info = answers.get(attempt.id, {})
        entry["monitor"] = dict(currentSkill=attempt.current_skill if attempt.status == "in_progress" else None,
                                confirmedAnswers=info.get("confirmed", 0),
                                lastConfirmedAt=aware(info["last"]) if info.get("last") else None,
                                startedAt=aware(attempt.started_at), deadlineAt=aware(attempt.overall_deadline_at or attempt.deadline_at)
                                if (attempt.overall_deadline_at or attempt.deadline_at) else None,
                                incidents=incidents.get(attempt.id, 0))


def build(row, *, now=None):
    now = now or timezone.now()
    scale = scale_of(row.exam.type)
    ids = roster_ids(row)
    names = dict(User.objects.filter(id__in=ids).values_list("id", "name"))
    attempts = _attempts(row, ids)
    jobs = classroom_assessments(list(attempts.values())) if attempts else {}
    from apps.legacy_schema.models import AssessmentJob
    final_scores = dict(AssessmentJob.objects.filter(
        id__in=[j["id"] for rows in jobs.values() for j in rows if j["finalized"]]).values_list("id", "final_score"))
    closed = now >= aware(row.deadline)
    out_rows = []
    for sid in ids:
        attempt = attempts.get(sid)
        entry = dict(studentId=sid, name=names.get(sid) or "—", attemptId=None, participation=None, grading="none",
                     scores={s: None for s in SKILLS}, overall=None, cefr=None, rawScore=None, rawMax=None,
                     pendingSkills=[], aiFailedSkills=[], submittedAt=None, rank=None, previous=None, growth=None)
        if attempt is None:
            entry["participation"] = "not_submitted" if closed else "not_started"
            out_rows.append(entry)
            continue
        entry["attemptId"] = attempt.id
        if attempt.status == "in_progress":
            entry["participation"] = "in_progress"
            out_rows.append(entry)
            continue
        entry["participation"] = "auto_submitted" if AUTO_SUBMIT_KEY in (attempt.media_state or {}) else "submitted"
        entry["submittedAt"] = attempt.submitted_at
        latest = jobs.get(attempt.id, [])
        final_skills = {j["skill"] for j in latest if j["finalized"]}
        pending = [j for j in latest if not j["finalized"]]
        entry["pendingSkills"] = sorted({j["skill"] for j in pending})
        entry["aiFailedSkills"] = sorted({j["skill"] for j in pending if j["status"] in ("FAILED", "NEEDS_REVIEW") and j["failure_code"]})
        for skill in SKILLS:
            if skill in SUBJECTIVE and skill in {j["skill"] for j in latest} and skill not in final_skills:
                continue  # awaiting the teacher: shown as pending, never as a number
            entry["scores"][skill] = _skill(attempt, skill, scale)
            if entry["scores"][skill] is None and skill in final_skills and scale == "ielts":
                job = next(j for j in latest if j["skill"] == skill and j["finalized"])
                entry["scores"][skill] = _num(final_scores.get(job["id"]), 9)
        entry["rawScore"], entry["rawMax"] = _raw_total(attempt)
        if not pending and attempt.status == "completed":
            entry["grading"] = "finalized"
            entry["overall"] = _overall(attempt, scale)
            entry["cefr"] = attempt.cefr_level if scale == "multilevel" else None
        elif final_skills:
            entry["grading"] = "partially_graded"
        elif any(j["status"] in ("PENDING", "PROCESSING", "RETRY") for j in pending):
            entry["grading"] = "awaiting_assessment"
        else:
            entry["grading"] = "awaiting_teacher_review"
        out_rows.append(entry)

    _monitor(out_rows, attempts)
    previous = _previous(row, {r["studentId"]: attempts[r["studentId"]] for r in out_rows if r["grading"] == "finalized"})
    for entry in out_rows:
        prior = previous.get(entry["studentId"])
        if prior is not None and entry["overall"] is not None:
            value = _overall(prior, scale)
            if value is not None:
                entry["previous"] = value
                entry["growth"] = round(entry["overall"] - value, 2)

    ranked = sorted((r for r in out_rows if r["grading"] == "finalized" and r["overall"] is not None),
                    key=lambda r: (-r["overall"], r["name"].casefold(), r["studentId"]))
    for index, entry in enumerate(ranked):
        entry["rank"] = ranked[index - 1]["rank"] if index and ranked[index - 1]["overall"] == entry["overall"] else index + 1

    part = [r["participation"] for r in out_rows]
    finalized_scores = [r["overall"] for r in ranked]
    submitted = sum(p in ("submitted", "auto_submitted") for p in part)
    all_in = submitted == len(out_rows) and bool(out_rows)
    settled = closed or all_in
    waiting = sum(r["grading"] in ("awaiting_assessment", "awaiting_teacher_review", "partially_graded") for r in out_rows)
    stage = "open" if not settled else "final" if not waiting and "in_progress" not in part else "preliminary"
    counts = dict(eligible=len(out_rows), notStarted=part.count("not_started"), inProgress=part.count("in_progress"),
                  submitted=part.count("submitted"), autoSubmitted=part.count("auto_submitted"),
                  notSubmitted=part.count("not_submitted"), handedIn=submitted, awaitingGrading=waiting,
                  finalized=len(ranked))
    stats = dict(average=round(sum(finalized_scores) / len(finalized_scores), 2) if finalized_scores else None,
                 median=round(median(finalized_scores), 2) if finalized_scores else None,
                 highest=max(finalized_scores) if finalized_scores else None, sample=len(finalized_scores))
    order = {r["studentId"]: i for i, r in enumerate(ranked)}
    out_rows.sort(key=lambda r: (order.get(r["studentId"], len(order)), r["participation"] in ("not_started", "not_submitted"),
                                 r["name"].casefold()))
    digest = hashlib.sha256(json.dumps([stage, [(r["studentId"], r["participation"], r["grading"], r["overall"], r["scores"])
                                                for r in out_rows]], sort_keys=True, default=str).encode()).hexdigest()[:16]
    teacher_id = row.cohort.classroom.teacher_id if row.cohort.classroom_id else row.cohort.teacher_id
    return dict(assignmentId=row.id, title=row.title, examId=row.exam_id, examTitle=row.exam.title, examType=row.exam.type,
                scale=scale, groupId=row.cohort.classroom_id, groupName=row.cohort.classroom.name if row.cohort.classroom_id else row.cohort.name,
                teacherId=teacher_id, timingPolicy=row.timing_policy, opensAt=row.opens_at, deadline=row.deadline,
                closed=closed, stage=stage, revision=digest, generatedAt=now, counts=counts, stats=stats, rows=out_rows)
