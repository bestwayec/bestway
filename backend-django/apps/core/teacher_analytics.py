"""Comparable results and participation for an authorized classroom."""
from collections import Counter, defaultdict
from datetime import date, timedelta
from math import isfinite
from statistics import mean, median

from django.db.models import Exists, F, OuterRef, Q
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.legacy_schema.models import Attendance, MockAnswer, MockAttempt, MockExamType, MockQuestion, StudentProfile
from common.api.exceptions import ContractAPIException
from .groups import get_group
from .homework_scoring import ASSIGNMENT_KEY
from .mock_practice import is_partial, scope
from .models import ClassroomEnrollment, HomeworkAssignment, HomeworkSubmission

SKILLS = ("listening", "reading", "writing", "speaking")
ATTEMPT_LIMIT = 5000


def invalid(message):
    raise ContractAPIException("VALIDATION_ERROR", message, 400)


def filters(params):
    today = timezone.localdate()
    try:
        end = date.fromisoformat(params["to"]) if params.get("to") else today
        start = date.fromisoformat(params["from"]) if params.get("from") else end - timedelta(days=89)
    except ValueError:
        invalid("Use ISO dates for from and to.")
    if start > end or (end - start).days > 365:
        invalid("Choose a date range of at most 366 days.")
    track = params.get("track") or ""
    skill = params.get("skill") or ""
    status = params.get("status") or ""
    policy = params.get("policy") or "latest"
    if track and track not in MockExamType.values:
        invalid("Unknown assessment track.")
    if skill and skill not in SKILLS:
        invalid("Unknown assessment skill.")
    if status and status not in ("in_progress", "grading", "completed"):
        invalid("Unknown attempt status.")
    if policy not in ("latest", "best"):
        invalid("Choose latest or best for repeated attempts.")
    return dict(start=start, end=end, track=track, skill=skill, status=status, policy=policy,
                exam_id=params.get("examId") or "", assignment_id=params.get("assignmentId") or "")


def authorize(actor, group_id):
    group = get_group(group_id)
    if actor.role not in ("admin", "super_admin") and not (actor.role == "teacher" and group.teacher_id == actor.id):
        raise ContractAPIException("FORBIDDEN", "Bu guruh sizga biriktirilmagan", 403)
    return group


def classroom_attempts(group_id):
    """Use a dated enrollment or an explicit link from a classroom assignment."""
    enrolled = ClassroomEnrollment.objects.filter(
        group_id=group_id, student_id=OuterRef("student_id"), started_at__lte=OuterRef("started_at"),
    ).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=OuterRef("started_at")))
    linked = HomeworkSubmission.objects.filter(
        assignment__cohort__classroom_id=group_id, assignment__exam_id=OuterRef("exam_id"),
        student_id=OuterRef("student_id"), attempt_id=OuterRef("id"), source="exam_attempt",
    )
    launch = HomeworkAssignment.objects.filter(cohort__classroom_id=group_id, exam_id=OuterRef("exam_id"),
                                               id=OuterRef("assignment_for_report"))
    return MockAttempt.objects.alias(assignment_for_report=KeyTextTransform(ASSIGNMENT_KEY, "media_state")).filter(
        Exists(enrolled) | Exists(linked) | Exists(launch),
    )


def valid_score(value, maximum):
    return type(value) in (int, float) and isfinite(value) and 0 <= value <= maximum


def skill_score(attempt, skill):
    if attempt.exam.type == "multilevel":
        value = (attempt.standard_scores or {}).get(skill)
        value = value.get("estimatedStandardScore") if isinstance(value, dict) else value
        return value if valid_score(value, 75) else None
    value = (attempt.section_bands or {}).get(skill)
    return value if valid_score(value, 9) else None


def comparable_score(attempt, skill=""):
    if attempt.status != "completed" or attempt.flow_mode != "full_test" or is_partial(attempt):
        return None
    maximum = 75 if attempt.exam.type == "multilevel" else 9
    value = skill_score(attempt, skill) if skill else attempt.overall_score if maximum == 75 else attempt.overall_band
    return value if valid_score(value, maximum) else None


def latest_attempts(attempts, skill, policy):
    selected = {}
    for attempt in attempts:
        if comparable_score(attempt, skill) is None:
            continue
        signature = (attempt.student_id, attempt.exam_id, attempt.specification_version, attempt.score_version)
        prior = selected.get(signature)
        if prior is None or (policy == "best" and comparable_score(attempt, skill) > comparable_score(prior, skill)):
            selected[signature] = attempt
    return selected


def objective_metrics(attempts, skill, include_questions=False):
    taken = [attempt for attempt in attempts if attempt.status == "completed"]
    if skill in ("writing", "speaking") or not taken:
        return [], []
    ids = [attempt.id for attempt in taken]
    sections = (skill,) if skill else ("reading", "listening")
    answers = MockAnswer.objects.filter(
        attempt_id__in=ids,
        question__group__section__skill__in=sections,
        question__group__section__exam_id=F("attempt__exam_id"),
    ).values_list("attempt_id", "question_id", "is_correct", "response")
    evaluated = {(attempt, question): (correct, response) for attempt, question, correct, response in answers.iterator()}
    definitions = defaultdict(list)
    questions_in_exams = MockQuestion.objects.filter(
        group__section__exam_id__in={a.exam_id for a in taken}, group__section__skill__in=sections,
    ).values_list("group__section__exam_id", "group__section__skill", "id", "number", "type")
    for exam_id, section, question_id, number, kind in questions_in_exams.iterator():
        definitions[exam_id].append((section, question_id, number, kind))
    categories, questions = {}, {}
    for attempt in taken:
        track = attempt.exam.type
        scoped = scope(attempt)
        allowed = set(scoped["questionIds"]) if scoped is not None else None
        for section, question_id, number, kind in definitions[attempt.exam_id]:
            if section not in (attempt.raw_scores or {}) or (allowed is not None and question_id not in allowed):
                continue
            correct, response = evaluated.get((attempt.id, question_id), (None, ""))
            if correct is None and (response or "").strip():
                continue
            state = "correct" if correct else "incorrect" if (response or "").strip() else "unanswered"
            category = categories.setdefault((track, section, kind), dict(correct=0, incorrect=0, unanswered=0, affected=set()))
            category[state] += 1
            if include_questions:
                question = questions.setdefault(question_id, dict(questionId=question_id, number=number, skill=section,
                                                                questionType=kind, correct=0, incorrect=0, unanswered=0))
                question[state] += 1
            if state == "incorrect":
                category["affected"].add(attempt.student_id)
    rows = []
    for (track, section, kind), counts in sorted(categories.items()):
        attempted = counts["correct"] + counts["incorrect"]
        accuracy = round(100 * counts["correct"] / attempted) if attempted else None
        rows.append(dict(track=track, skill=section, questionType=kind, topic=kind, accuracy=accuracy,
                         groupErrorRate=100 - accuracy if accuracy is not None else None,
                         affectedStudentsCount=len(counts.pop("affected")),
                         gradedResponseCount=attempted, **counts))
    return rows, list(questions.values())


def get_group_analytics(actor, group_id, params=None):
    group = authorize(actor, group_id)
    options = filters(params or {})
    profiles = dict(StudentProfile.objects.filter(group_id=group_id).values_list("user_id", "user__name"))
    rows = classroom_attempts(group_id)
    assignment = None
    eligible = set(profiles)
    if options["assignment_id"]:
        assignment = HomeworkAssignment.objects.filter(
            pk=options["assignment_id"], cohort__classroom_id=group_id, exam_id__isnull=False,
        ).first()
        if assignment is None:
            raise ContractAPIException("ASSIGNMENT_NOT_FOUND", "Exam assignment not found.", 404)
        if options["exam_id"] and options["exam_id"] != assignment.exam_id:
            invalid("The assignment belongs to a different exam.")
        members = ClassroomEnrollment.objects.filter(
            group_id=group_id, started_at__lte=assignment.created_at,
        ).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=assignment.created_at))
        links = HomeworkSubmission.objects.filter(assignment=assignment, source="exam_attempt").exclude(attempt_id=None)
        eligible = set(members.values_list("student_id", flat=True)) | set(links.values_list("student_id", flat=True))
        rows = rows.filter(exam_id=assignment.exam_id).filter(
            Q(id__in=links.values("attempt_id")) | Q(assignment_for_report=assignment.id),
        )
        eligible.update(rows.values_list("student_id", flat=True).distinct())
    elif options["exam_id"]:
        rows = rows.filter(exam_id=options["exam_id"])
    rows = rows.filter(started_at__date__range=(options["start"], options["end"]))
    if options["track"]:
        rows = rows.filter(exam__type=options["track"])
    if options["status"]:
        rows = rows.filter(status=options["status"])
    skill = options["skill"]
    if skill:
        rows = rows.filter(Q(raw_scores__has_key=skill) | Q(status="in_progress", current_skill=skill))
    attempts = list(rows.select_related("exam", "student__user")
                    .order_by(Coalesce("submitted_at", "started_at").desc(), "-id")[:ATTEMPT_LIMIT + 1])
    if len(attempts) > ATTEMPT_LIMIT:
        invalid("Too many attempts. Narrow the date range or select an assessment.")

    attendance = defaultdict(list)
    records = Attendance.objects.filter(group_id=group_id, date__range=(options["start"], options["end"]))
    for student, state in records.values_list("student_id", "state").iterator():
        if state in ("present", "late", "absent"):
            attendance[student].append({"present": 1, "late": .5, "absent": 0}[state])
    rates = {student: round(100 * mean(values)) for student, values in attendance.items()}

    by_student = defaultdict(list)
    names = dict(profiles)
    for attempt in attempts:
        names[attempt.student_id] = attempt.student.user.name
        by_student[attempt.student_id].append(attempt)
    for student, name in StudentProfile.objects.filter(user_id__in=eligible - names.keys()).values_list("user_id", "user__name"):
        names[student] = name
    chosen = latest_attempts(attempts, skill, options["policy"])
    comparable = defaultdict(list)
    for attempt in chosen.values():
        comparable[attempt.student_id].append(attempt)
    scale_scores = defaultdict(list)
    students = []
    partitions = defaultdict(list)
    trends = defaultdict(list)
    weekly = defaultdict(list)
    exam_trends = defaultdict(list)
    distributions = defaultdict(Counter)
    same_versions = defaultdict(list)
    for attempt in attempts:
        if comparable_score(attempt, skill) is not None:
            key = (attempt.student_id, attempt.exam_id, attempt.specification_version, attempt.score_version)
            same_versions[key].append(attempt)
    assessments = {attempt.exam_id: attempt.exam.title for attempt in attempts}
    for attempt in chosen.values():
        track = attempt.exam.type
        score = comparable_score(attempt, skill)
        partitions[(track, attempt.exam_id, attempt.specification_version, attempt.score_version)].append((score, attempt))
        stamp = attempt.submitted_at or attempt.started_at
        day = (timezone.localtime(stamp) if timezone.is_aware(stamp) else stamp).date()
        trends[(track, day.isoformat()[:7])].append(score)
        weekly[(track, (day - timedelta(days=day.weekday())).isoformat())].append(score)
        exam_trends[(track, attempt.exam_id, attempt.specification_version, attempt.score_version)].append(score)
        distributions[track][score] += 1

    for student in sorted(eligible | names.keys() if assignment is None else eligible, key=lambda key: (names.get(key, "").casefold(), key)):
        own = by_student.get(student, [])
        scores = defaultdict(list)
        for attempt in comparable[student]:
            scores[attempt.exam.type].append(comparable_score(attempt, skill))
        averages = {track: round(mean(values), 2) for track, values in scores.items()}
        for track, value in averages.items():
            scale_scores[track].append(value)
        recent = own[0] if own else None
        last = recent.finished_at or recent.submitted_at or recent.started_at if recent else None
        average = next(iter(averages.values())) if len(averages) == 1 else None
        students.append(dict(studentId=student, name=names.get(student, ""), attendanceRate=rates.get(student),
                             mockAttemptsCount=len(own), essaysCount=sum("writing" in (a.submitted_sections or []) for a in own),
                             scoresByScale=averages, averageScore=average, scoreLabel=f"{average:.2f}" if average is not None else "—",
                             lastActiveAt=last, status=recent.status if recent else None))

    ranking = []
    if options["exam_id"] or assignment:
        for (track, exam_id, specification, score_version), entries in partitions.items():
            entries.sort(key=lambda item: (-item[0], names[item[1].student_id].casefold(), item[1].student_id))
            previous = None
            rank = 0
            for index, (score, attempt) in enumerate(entries, 1):
                if score != previous:
                    rank = index
                previous = score
                matching = same_versions[(attempt.student_id, exam_id, specification, score_version)]
                improvement = (round(comparable_score(matching[0], skill) - comparable_score(matching[-1], skill), 2)
                               if len(matching) > 1 else None)
                ranking.append(dict(rank=rank, score=score, track=track, examId=exam_id, improvement=improvement,
                                    specificationVersion=specification, scoreVersion=score_version,
                                    studentId=attempt.student_id, name=names[attempt.student_id],
                                    attemptId=attempt.id if attempt.student_id in profiles or actor.role != "teacher" else None,
                                    submittedAt=attempt.submitted_at, attempts=len(by_student[attempt.student_id]),
                                    skills={key: skill_score(attempt, key) for key in SKILLS}))

    topic_rows, question_rows = objective_metrics(attempts, skill, bool(options["exam_id"] or assignment))
    counted = eligible if assignment else eligible | by_student.keys()
    submitted = {a.student_id for a in attempts if a.submitted_at or a.status in ("grading", "completed")}
    graded = {a.student_id for a in attempts if a.status == "completed"}
    pending = {a.student_id for a in attempts if a.status == "grading"} - graded
    averages = {track: round(mean(values), 2) for track, values in scale_scores.items()}
    skills = {}
    for track in MockExamType.values:
        on_track = [attempt for attempt in chosen.values() if attempt.exam.type == track]
        if not on_track:
            continue
        skills[track] = {}
        for key in SKILLS:
            observed = [(a.student_id, score) for a in on_track if (score := skill_score(a, key)) is not None]
            skills[track][key] = dict(average=round(mean(s for _, s in observed), 2) if observed else None,
                                      attempts=len(observed), students=len({st for st, _ in observed}))
    assignments = HomeworkAssignment.objects.filter(cohort__classroom_id=group_id, exam_id__isnull=False)
    return dict(groupId=group.id, groupName=group.name, teacherName=group.teacher.name if group.teacher else "",
                totalStudents=len(profiles), totalEligible=len(counted), assignedStudents=len(eligible) if assignment else None,
                startedStudents=len(by_student), submittedStudents=len(submitted), pendingStudents=len(pending),
                gradedStudents=len(graded), notSubmittedStudents=len(counted - submitted),
                completionRate=round(100 * len(counted & submitted) / len(counted)) if counted else None,
                groupAverageScore=next(iter(averages.values())) if len(averages) == 1 else None,
                groupAveragesByScale=averages,
                scaleSummary={track: dict(median=median(values), students=len(values), best=max(values))
                              for track, values in scale_scores.items()},
                groupAverageAttendance=round(mean(rates[student] for student in counted if student in rates))
                if counted & rates.keys() else None,
                totalMockAttempts=len(attempts), totalEssays=sum(student["essaysCount"] for student in students),
                students=students, weakTopicsHeatmap=topic_rows,
                questionDifficulty=question_rows,
                scoreDistribution={track: [dict(score=score, count=count) for score, count in sorted(counts.items())]
                                   for track, counts in distributions.items()},
                weeklyHistory=[dict(track=track, week=week, average=round(mean(values), 2), attempts=len(values))
                               for (track, week), values in sorted(weekly.items())],
                examHistory=[dict(track=track, examId=exam, title=assessments[exam], specificationVersion=spec,
                                  scoreVersion=version, average=round(mean(values), 2), attempts=len(values))
                             for (track, exam, spec, version), values in exam_trends.items()],
                ranking=ranking, skills=skills, rankingPolicy=options["policy"],
                assessments=[dict(id=key, title=title) for key, title in sorted(assessments.items(), key=lambda item: item[1])],
                assignments=list(assignments.values("id", "title", "exam_id")[:100]),
                history=[dict(track=track, month=month, average=round(mean(values), 2), attempts=len(values))
                         for (track, month), values in sorted(trends.items())])
