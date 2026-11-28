"""Student and group exam progress (BESTWAY 5.1). Staff-only, from persisted finalized results.

* Comparable = completed, teacher-confirmed (no unconfirmed subjective grade), same track
  (IELTS band vs Multilevel /75 are never mixed), and the same flow (full exam vs skill
  practice are never mixed). Only attempts made for this group's assignments count.
* Growth needs at least two comparable results; otherwise ``insufficientHistory``.
* Missing skill scores stay ``None`` (charts must not join them as zero).
* Score changes describe observed test performance, not guaranteed proficiency change.
"""
from __future__ import annotations

from apps.legacy_schema.models import MockAttempt, User
from common.api.exceptions import ContractAPIException

from . import exam_report
from .classroom_results import assignment_attempts
from .models import ClassroomEnrollment, HomeworkAssignment
from .teacher_analytics import authorize, classroom_assessments

TRACKS = {"ielts": ("ielts_academic", "ielts_general"), "multilevel": ("multilevel",)}
SKILLS = exam_report.SKILLS
LIMIT = 200


def _track(params):
    track = params.get("track", "ielts")
    if track not in TRACKS:
        raise ContractAPIException("VALIDATION_ERROR", "track: ielts yoki multilevel", 400)
    return track


def _flow(params):
    flow = params.get("flow", "full_test")
    if flow not in ("full_test", "single_skill", "partial_practice"):
        raise ContractAPIException("VALIDATION_ERROR", "flow noto‘g‘ri", 400)
    return flow


def _point(attempt, scale):
    return dict(attemptId=attempt.id, examTitle=attempt.exam.title, examType=attempt.exam.type,
                date=attempt.submitted_at, overall=exam_report._overall(attempt, scale),
                skills={s: exam_report._skill(attempt, s, scale) for s in SKILLS})


def _summary(points):
    values = [p for p in points if p["overall"] is not None]
    if not values:
        return dict(count=0, insufficientHistory=True)
    first, latest = values[0], values[-1]
    previous = values[-2] if len(values) > 1 else None
    best = max(values, key=lambda p: p["overall"])
    enough = len(values) >= 2
    return dict(count=len(values), insufficientHistory=not enough, first=first["overall"], latest=latest["overall"],
                previous=previous["overall"] if previous else None, best=best["overall"],
                changeFromPrevious=round(latest["overall"] - previous["overall"], 2) if enough else None,
                changeFromFirst=round(latest["overall"] - first["overall"], 2) if enough else None,
                skillChange={s: (round(latest["skills"][s] - previous["skills"][s], 2)
                                 if enough and latest["skills"][s] is not None and previous["skills"][s] is not None else None)
                             for s in SKILLS},
                firstDate=first["date"], latestDate=latest["date"])


def student_progress(actor, group_id, student_id, params):
    authorize(actor, group_id)
    if not ClassroomEnrollment.objects.filter(group_id=group_id, student_id=student_id).exists():
        raise ContractAPIException("NOT_FOUND", "O‘quvchi topilmadi", 404)
    track, flow = _track(params), _flow(params)
    scale = "multilevel" if track == "multilevel" else "ielts"
    rows = list(assignment_attempts(MockAttempt.objects.select_related("exam"), group_id=group_id).filter(
        student_id=student_id, status="completed", flow_mode=flow, exam__type__in=TRACKS[track],
        submitted_at__isnull=False).order_by("submitted_at")[:LIMIT])
    classroom_assessments(rows)
    points = [_point(a, scale) for a in rows if not getattr(a, "unconfirmed_classroom_grade", False)]
    total = assignment_attempts(MockAttempt.objects.all(), group_id=group_id).filter(student_id=student_id).exclude(status="in_progress").count()
    assigned = HomeworkAssignment.objects.filter(cohort__classroom_id=group_id, exam__isnull=False).filter(
        participant_ids__contains=[student_id]).count()
    name = User.objects.filter(id=student_id).values_list("name", flat=True).first()
    return dict(studentId=student_id, name=name, track=track, flow=flow, scale=scale, completed=total,
                finalized=len(points), assigned=assigned, participationRate=round(100 * total / assigned) if assigned else None,
                history=points, summary=_summary(points))


def group_progress(actor, group_id, params):
    authorize(actor, group_id)
    track = _track(params)
    assignments = list(HomeworkAssignment.objects.select_related("cohort", "cohort__classroom", "exam").filter(
        cohort__classroom_id=group_id, exam__type__in=TRACKS[track]).order_by("-deadline")[:20])
    history, latest_rows = [], None
    for row in reversed(assignments):
        report = exam_report.build(row)
        if report["stage"] == "open":
            continue
        finalized = [r for r in report["rows"] if r["overall"] is not None]
        skill_avg = {}
        for skill in SKILLS:
            values = [r["scores"][skill] for r in finalized if r["scores"][skill] is not None]
            skill_avg[skill] = round(sum(values) / len(values), 2) if values else None
        c = report["counts"]
        history.append(dict(assignmentId=row.id, title=report["examTitle"], date=row.deadline, stage=report["stage"],
                            eligible=c["eligible"], handedIn=c["handedIn"], finalized=c["finalized"], pending=c["awaitingGrading"],
                            completionRate=round(100 * c["handedIn"] / c["eligible"]) if c["eligible"] else None,
                            average=report["stats"]["average"], median=report["stats"]["median"], highest=report["stats"]["highest"],
                            sample=report["stats"]["sample"], skills=skill_avg))
        latest_rows = report["rows"]
    improved = declined = 0
    support = []
    for entry in latest_rows or []:
        if entry["growth"] is None:
            continue
        if entry["growth"] > 0:
            improved += 1
        elif entry["growth"] < 0:
            declined += 1
            support.append(dict(studentId=entry["studentId"], name=entry["name"], growth=entry["growth"]))
    return dict(groupId=group_id, track=track, history=history, improved=improved, declined=declined,
                mayNeedSupport=sorted(support, key=lambda s: s["growth"])[:10],
                note="Changes compare populations that may differ between exams; see eligible and sample counts.")
