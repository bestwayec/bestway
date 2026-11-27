"""Live Exam Guard 5.0: multi-group-safe supervisor routing, incident correlation, and real-time teacher alerts."""
from __future__ import annotations

from datetime import datetime, timedelta
from html import escape
from uuid import UUID, uuid4

from django.core.cache import cache
from django.db import connection, transaction
from django.db.models import Count, F, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.legacy_schema.models import Group, MockAnswer, MockAttempt, MockQuestion, Notification, User
from common.api.exceptions import ContractAPIException

from .classroom_roster import member_profiles
from .homework_scoring import ASSIGNMENT_KEY
from .models import ClassroomArchive, ExamIntegrityIncident, HomeworkAssignment, HomeworkSubmission

CANONICAL_EVENT_MAP = {
    "blur": "WINDOW_FOCUS_LOST",
    "window_blur": "WINDOW_FOCUS_LOST",
    "window_loss": "WINDOW_FOCUS_LOST",
    "focus_lost": "WINDOW_FOCUS_LOST",
    "window_focus_lost": "WINDOW_FOCUS_LOST",
    "window_focus": "WINDOW_FOCUS_RESTORED",
    "focus_restored": "WINDOW_FOCUS_RESTORED",
    "window_focus_restored": "WINDOW_FOCUS_RESTORED",
    "tab_switch": "PAGE_HIDDEN",
    "page_hidden": "PAGE_HIDDEN",
    "visibility_hidden": "PAGE_HIDDEN",
    "page_visible": "PAGE_VISIBLE",
    "exit_fullscreen": "FULLSCREEN_EXITED",
    "fullscreen_exit": "FULLSCREEN_EXITED",
    "fullscreen_exited": "FULLSCREEN_EXITED",
    "fullscreen_restored": "FULLSCREEN_RESTORED",
    "copy_blocked": "CLIPBOARD_ACTION_BLOCKED",
    "cut_blocked": "CLIPBOARD_ACTION_BLOCKED",
    "paste_blocked": "CLIPBOARD_ACTION_BLOCKED",
    "copy_paste": "CLIPBOARD_ACTION_BLOCKED",
    "contextmenu_blocked": "CLIPBOARD_ACTION_BLOCKED",
    "clipboard_action_blocked": "CLIPBOARD_ACTION_BLOCKED",
    "session_conflict": "SESSION_CONFLICT",
    "session_takeover": "SESSION_TAKEOVER",
    "network_disconnected": "NETWORK_DISCONNECTED",
    "offline": "NETWORK_DISCONNECTED",
    "network_reconnected": "NETWORK_RECONNECTED",
    "online": "NETWORK_RECONNECTED",
    "answer_save_failed": "ANSWER_SAVE_FAILED",
    "answers_synchronized": "ANSWERS_SYNCHRONIZED",
    "exam_submitted": "EXAM_SUBMITTED",
    "devtools_open": "DEVTOOLS_OPENED",
    "devtools_attempt": "DEVTOOLS_OPENED",
    "mouse_leave": "POINTER_LEFT_WINDOW",
}

ALERT_WORTHY_EVENTS = {
    "WINDOW_FOCUS_LOST",
    "PAGE_HIDDEN",
    "FULLSCREEN_EXITED",
    "CLIPBOARD_ACTION_BLOCKED",
    "SESSION_CONFLICT",
    "SESSION_TAKEOVER",
    "DEVTOOLS_OPENED",
    "POINTER_LEFT_WINDOW",
}

CORRELATABLE_EXIT_EVENTS = {"WINDOW_FOCUS_LOST", "PAGE_HIDDEN", "FULLSCREEN_EXITED"}

UZ_EVENT_LABELS = {
    "WINDOW_FOCUS_LOST": "imtihon oynasidan chiqdi",
    "PAGE_HIDDEN": "boshqa oyna yoki tabga o‘tdi",
    "FULLSCREEN_EXITED": "to‘liq ekran rejimidan chiqdi",
    "CLIPBOARD_ACTION_BLOCKED": "nusxalash yoki qo‘yishga urindi",
    "SESSION_CONFLICT": "boshqa sessiya bilan to‘qnashuv aniqlandi",
    "SESSION_TAKEOVER": "imtihon boshqa oynada ochildi",
    "DEVTOOLS_OPENED": "dasturchi asboblarini ochishga urindi",
    "POINTER_LEFT_WINDOW": "kursor imtihon oynasidan chiqdi",
    "NETWORK_DISCONNECTED": "internet aloqasi uzildi",
    "NETWORK_RECONNECTED": "internet aloqasi tiklandi",
    "ANSWER_SAVE_FAILED": "javobni saqlashda xatolik",
    "ANSWERS_SYNCHRONIZED": "oflayn javoblar sinxronlashtirildi",
    "EXAM_SUBMITTED": "imtihon topshirildi",
    "WINDOW_FOCUS_RESTORED": "imtihon oynasiga qaytdi",
    "PAGE_VISIBLE": "sahifaga qaytdi",
    "FULLSCREEN_RESTORED": "to‘liq ekran tiklandi",
}


def normalize_event(raw_event: str) -> str:
    key = (raw_event or "").strip().lower()
    if key in CANONICAL_EVENT_MAP:
        return CANONICAL_EVENT_MAP[key]
    if key.upper() in UZ_EVENT_LABELS:
        return key.upper()
    raise ContractAPIException("VALIDATION_ERROR", "Unknown exam event", 400)


RECOVERY_WINDOW = timedelta(minutes=15)
CLOCK_SKEW = timedelta(seconds=30)
MAX_EVENTS_PER_MINUTE = 60


def _active_teacher(teacher_id, group_id):
    if not teacher_id or not User.objects.filter(pk=teacher_id, role="teacher", is_active=True).exists():
        return False
    return group_id is None or (
        Group.objects.filter(pk=group_id, teacher_id=teacher_id).exists()
        and not ClassroomArchive.objects.filter(group_id=group_id).exists()
    )


def resolve_attempt_supervision(attempt: MockAttempt) -> tuple[str | None, str | None]:
    """Resolve the authoritative (group_id, supervisor_teacher_id) for this attempt.

    Uses ONLY LiveExamSession supervision or the explicit HomeworkAssignment / Cohort
    that launched this attempt. NEVER falls back to StudentProfile.group_id or public channels.
    """
    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass(%s) IS NOT NULL", ['"LiveExamParticipant"'])
        if cursor.fetchone()[0]:
            cursor.execute(
                '''SELECT s."groupId", s."teacherId"
                   FROM "LiveExamParticipant" p
                   JOIN "LiveExamSession" s ON s.id = p.session_id
                   WHERE p.attempt_id = %s AND p.student_id = %s AND s.exam_id = %s
                   ORDER BY p."joinedAt" DESC LIMIT 1''',
                [attempt.id, attempt.student_id, attempt.exam_id],
            )
            row = cursor.fetchone()
            if row:
                return tuple(row) if _active_teacher(row[1], row[0]) else (None, None)

    assignment_id = (attempt.media_state or {}).get(ASSIGNMENT_KEY)
    if not assignment_id:
        assignment_id = (
            HomeworkSubmission.objects.filter(
                attempt_id=attempt.id, student_id=attempt.student_id, source="exam_attempt",
            )
            .values_list("assignment_id", flat=True)
            .first()
        )
    if assignment_id:
        assignment = (
            HomeworkAssignment.objects.select_related("cohort", "cohort__classroom")
            .filter(pk=assignment_id, exam_id=attempt.exam_id)
            .first()
        )
        if assignment and (assignment.participant_ids is None or attempt.student_id in assignment.participant_ids):
            classroom = assignment.cohort.classroom
            group_id = classroom.id if classroom else None
            supervisor_id = (classroom.teacher_id if classroom and classroom.teacher_id else assignment.cohort.teacher_id)
            if _active_teacher(supervisor_id, group_id):
                return group_id, supervisor_id

    return None, None


def _bump_guard_seq(supervisor_id: str | None):
    if not supervisor_id:
        return
    key = f"guard_alert_seq:{supervisor_id}"
    try:
        if not cache.add(key, 1, timeout=86400):
            cache.incr(key)
    except Exception:
        pass


def _queue_private_telegram_alert(supervisor_id: str, incident: ExamIntegrityIncident, student_name: str, group_name: str, exam_title: str):
    """Queue a private Telegram alert ONLY for the authorized supervising teacher via durable outbox."""
    from . import telegram_outbox as outbox
    from .teacher_workspace import site_url

    action_text = UZ_EVENT_LABELS.get(incident.event_type, incident.event_type)
    skill_label = (incident.skill or "Exam").capitalize()
    monitor_url = (
        site_url(f"/groups/{incident.group_id}?tab=guard")
        if incident.group_id
        else site_url("/teacher")
    )
    text = (
        "⚠️ <b>IMTIHON NAZORATI</b>\n\n"
        f"<b>O‘quvchi:</b> {escape(student_name)}\n"
        f"<b>Guruh:</b> {escape(group_name or 'Biriktirilmagan')}\n"
        f"<b>Imtihon:</b> {escape(exam_title)}\n"
        f"<b>Bo‘lim:</b> {escape(skill_label)}\n"
        f"<b>Hodisa:</b> {escape(action_text)}"
    )
    keyboard = [[{"text": "👁 Live Exam Monitor", "url": monitor_url}]]
    outbox.enqueue(
        supervisor_id,
        "teacher",
        f"guard_alert:{incident.id}:v{incident.occurrence_count}",
        text,
        keyboard,
        urgent=True,
    )


def _event_response(incident, *, created, notified, now):
    return {
        "incidentId": incident.id,
        "eventType": incident.event_type,
        "occurrenceCount": incident.occurrence_count,
        "created": created,
        "supervisorNotified": notified,
        "serverTime": now,
    }


@transaction.atomic
def record_event(
    actor,
    attempt: MockAttempt,
    raw_event: str,
    *,
    observed_at=None,
    skill: str | None = None,
    question_ref: str = "",
    event_id: str | None = None,
    offline_synced: bool = False,
) -> dict:
    """Persist a bounded observation and alert the currently authorized supervisor."""
    from .mock_attempts import aware

    if actor.role != "student" or actor.id != attempt.student_id:
        raise ContractAPIException("FORBIDDEN", "Ruxsat berilmagan", 403)
    attempt = MockAttempt.objects.select_for_update().select_related("exam").get(
        pk=attempt.id, student_id=actor.id,
    )
    event_type = normalize_event(raw_event)
    now = timezone.now()
    obs_dt = observed_at if observed_at is not None else now
    if not isinstance(obs_dt, datetime) or timezone.is_naive(obs_dt):
        raise ContractAPIException("VALIDATION_ERROR", "observedAt must include a time zone", 400)
    ends = min((aware(end) for end in (
        attempt.overall_deadline_at or attempt.deadline_at, attempt.submitted_at,
    ) if end is not None), default=None)
    if (
        obs_dt < max(aware(attempt.started_at) - CLOCK_SKEW, now - RECOVERY_WINDOW)
        or obs_dt > now + CLOCK_SKEW
        or (ends is not None and obs_dt > ends + CLOCK_SKEW)
        or (not offline_synced and attempt.status != "in_progress")
    ):
        raise ContractAPIException("GUARD_OBSERVATION_EXPIRED", "Exam observation is outside the permitted window", 409)
    if offline_synced and observed_at is None:
        raise ContractAPIException("VALIDATION_ERROR", "Offline observations require observedAt", 400)
    current_skill = skill or attempt.current_skill or ""
    if current_skill not in ("", "listening", "reading", "writing", "speaking") or len(question_ref) > 120:
        raise ContractAPIException("VALIDATION_ERROR", "Invalid exam observation", 400)
    if question_ref and not MockQuestion.objects.filter(
        pk=question_ref, group__section__exam_id=attempt.exam_id,
    ).exists():
        raise ContractAPIException("VALIDATION_ERROR", "Question does not belong to the exam", 400)
    if event_id is not None:
        try:
            event_id = str(UUID(event_id))
        except (TypeError, ValueError, AttributeError):
            raise ContractAPIException("VALIDATION_ERROR", "eventId must be a UUID", 400)
    elif offline_synced:
        event_id = f"{event_type}:{obs_dt.isoformat()}:{current_skill}:{question_ref}"

    incidents = ExamIntegrityIncident.objects.filter(attempt_id=attempt.id)
    duplicate = incidents.filter(metadata__eventIds__contains=[event_id]).first() if event_id else None
    if duplicate:
        return _event_response(duplicate, created=False, notified=False, now=now)
    minute_count = sum(incidents.filter(
        updated_at__gte=now - timedelta(minutes=1),
    ).values_list("occurrence_count", flat=True))
    if minute_count >= MAX_EVENTS_PER_MINUTE:
        raise ContractAPIException("GUARD_RATE_LIMIT", "Too many exam observations", 429)

    group_id, supervisor_id = resolve_attempt_supervision(attempt)
    mode = "supervised_mock" if supervisor_id else "practice"
    is_alert = event_type in ALERT_WORTHY_EVENTS and supervisor_id is not None

    with transaction.atomic():
        # Correlate rapid focus/visibility/fullscreen events within 5 seconds on the same attempt & skill
        existing = None
        if event_type in CORRELATABLE_EXIT_EVENTS:
            cutoff = now - timedelta(seconds=5)
            existing = (
                ExamIntegrityIncident.objects.select_for_update()
                .filter(
                    attempt_id=attempt.id,
                    skill=current_skill,
                    supervisor_id=supervisor_id,
                    event_type__in=CORRELATABLE_EXIT_EVENTS,
                    status="open",
                    updated_at__gte=cutoff,
                )
                .order_by("-updated_at")
                .first()
            )
        elif event_type in ALERT_WORTHY_EVENTS:
            cutoff = now - timedelta(seconds=5)
            existing = (
                ExamIntegrityIncident.objects.select_for_update()
                .filter(
                    attempt_id=attempt.id,
                    skill=current_skill,
                    supervisor_id=supervisor_id,
                    event_type=event_type,
                    status="open",
                    updated_at__gte=cutoff,
                )
                .order_by("-updated_at")
                .first()
            )

        if existing is not None:
            existing.occurrence_count = existing.occurrence_count + 1
            existing.observed_at = max(existing.observed_at, obs_dt)
            if event_id:
                existing.metadata = {**existing.metadata, "eventIds": [
                    *existing.metadata.get("eventIds", []), event_id,
                ]}
            existing.save(update_fields=["occurrence_count", "observed_at", "metadata", "updated_at"])
            incident = existing
            created = False
        else:
            incident = ExamIntegrityIncident.objects.create(
                attempt_id=attempt.id,
                student_id=attempt.student_id,
                exam_id=attempt.exam_id,
                group_id=group_id,
                supervisor_id=supervisor_id,
                event_type=event_type,
                skill=current_skill,
                question_ref=str(question_ref or "")[:120],
                integrity_mode=mode,
                occurrence_count=1,
                observed_at=obs_dt,
                metadata={"offlineSynced": offline_synced, "eventIds": [event_id] if event_id else []},
            )
            created = True

        if is_alert and supervisor_id and created:
            student_name = (
                User.objects.filter(id=attempt.student_id).values_list("name", flat=True).first()
                or getattr(actor, "name", None)
                or "O‘quvchi"
            )
            group_name = Group.objects.filter(id=group_id).values_list("name", flat=True).first() if group_id else ""
            exam_title = attempt.exam.title if getattr(attempt, "exam", None) else "Mock Imtihon"

            Notification.objects.create(
                id=str(uuid4()),
                user_id=supervisor_id,
                type="announcement",
                text="Imtihon nazoratida yangi kuzatuv qayd etildi.",
                read=False,
                created_at=now,
            )

            try:
                _queue_private_telegram_alert(supervisor_id, incident, student_name, group_name or "", exam_title)
            except Exception:
                pass

            transaction.on_commit(lambda: _bump_guard_seq(supervisor_id))

    return _event_response(incident, created=created, notified=bool(is_alert and created), now=now)


def private_teacher_access(teacher_id, incident):
    if incident.supervisor_id != teacher_id or not _active_teacher(teacher_id, incident.group_id):
        return False
    return resolve_attempt_supervision(incident.attempt) == (incident.group_id, teacher_id)


def _teacher_alert_scope(qs, actor):
    if actor.role != "teacher":
        return qs
    qs = qs.filter(supervisor_id=actor.id).filter(
        Q(group__isnull=True) | Q(group__teacher_id=actor.id),
    ).exclude(group_id__in=ClassroomArchive.objects.values("group_id"))
    # Legacy standalone cohorts have no classroom foreign key; recheck their
    # current assignment or session authority before including these events.
    standalone = [
        incident.pk for incident in qs.filter(group__isnull=True).select_related("attempt")
        if private_teacher_access(actor.id, incident)
    ]
    return qs.filter(Q(group__isnull=False) | Q(pk__in=standalone))


def teacher_alerts(actor, *, status: str = "", group_id: str = "", limit: int = 30) -> dict:
    if actor.role not in ("teacher", "admin", "super_admin"):
        raise ContractAPIException("FORBIDDEN", "Ruxsat berilmagan", 403)

    qs = ExamIntegrityIncident.objects.filter(
        event_type__in=ALERT_WORTHY_EVENTS,
        integrity_mode__in=("supervised_mock", "supervised_desktop"),
    ).select_related("student", "exam", "group")

    qs = _teacher_alert_scope(qs, actor)
    if status in ExamIntegrityIncident.STATUSES:
        qs = qs.filter(status=status)
    if group_id:
        qs = qs.filter(group_id=group_id)

    unread_qs = ExamIntegrityIncident.objects.filter(
        event_type__in=ALERT_WORTHY_EVENTS,
        integrity_mode__in=("supervised_mock", "supervised_desktop"),
        status="open",
    )
    unread_qs = _teacher_alert_scope(unread_qs, actor)

    items = [
        {
            "id": row.id,
            "attemptId": row.attempt_id,
            "studentId": row.student_id,
            "studentName": row.student.name if row.student else "O‘quvchi",
            "groupId": row.group_id,
            "groupName": row.group.name if row.group else None,
            "examId": row.exam_id,
            "examTitle": row.exam.title if row.exam else "Mock Imtihon",
            "eventType": row.event_type,
            "eventLabelUz": UZ_EVENT_LABELS.get(row.event_type, row.event_type),
            "skill": row.skill,
            "questionRef": row.question_ref,
            "integrityMode": row.integrity_mode,
            "occurrenceCount": row.occurrence_count,
            "status": row.status,
            "reviewNote": row.review_note,
            "observedAt": row.observed_at,
            "createdAt": row.created_at,
            "updatedAt": row.updated_at,
            "offlineSynced": bool((row.metadata or {}).get("offlineSynced")),
        }
        for row in qs.order_by("-updated_at")[:limit]
    ]
    return {
        "incidents": items,
        "unreadCount": unread_qs.count(),
        "seq": cache.get(f"guard_alert_seq:{actor.id}", 0),
        "serverTime": timezone.now(),
    }


@transaction.atomic
def review_incident(actor, incident_id: str, *, status: str, note: str = "") -> dict:
    if actor.role not in ("teacher", "admin", "super_admin"):
        raise ContractAPIException("FORBIDDEN", "Ruxsat berilmagan", 403)
    if status not in ("acknowledged", "explained", "flagged"):
        raise ContractAPIException("VALIDATION_ERROR", "Invalid review status", 400)

    incident = ExamIntegrityIncident.objects.select_for_update().filter(id=incident_id).first()
    if incident is None:
        raise ContractAPIException("INCIDENT_NOT_FOUND", "Hodisa topilmadi", 404)
    if actor.role == "teacher" and not private_teacher_access(actor.id, incident):
        raise ContractAPIException("FORBIDDEN", "Bu imtihon hodisasini boshqarish huquqingiz yo‘q", 403)

    now = timezone.now()
    incident.status = status
    incident.reviewed_by_id = actor.id
    incident.reviewed_at = now
    incident.review_note = (note or "").strip()[:1000]
    incident.save(update_fields=["status", "reviewed_by_id", "reviewed_at", "review_note", "updated_at"])
    _bump_guard_seq(incident.supervisor_id)
    return {
        "id": incident.id,
        "status": incident.status,
        "reviewNote": incident.review_note,
        "reviewedAt": incident.reviewed_at,
    }


def group_live_guard(actor, group_id: str) -> dict:
    from .classroom_roster import assert_active
    from .groups import assert_manages_group, get_group
    from .teacher_analytics import classroom_attempts

    group = get_group(group_id)
    assert_manages_group(actor, group)
    assert_active(group.id)

    students = list(member_profiles(group_id).select_related("user").order_by("user__name"))
    cutoff = timezone.now() - timedelta(hours=24)
    attempts_qs = classroom_attempts(group_id).filter(
        Q(status__in=("in_progress", "grading")) | Q(status="completed", finished_at__gte=cutoff),
    ).select_related("exam").order_by("-started_at")

    latest_attempt = {}
    for att in attempts_qs:
        latest_attempt.setdefault(att.student_id, att)

    attempt_ids = [a.id for a in latest_attempt.values()]
    answer_counts = dict(
        MockAnswer.objects.filter(attempt_id__in=attempt_ids)
        .exclude(response="", audio_key__isnull=True)
        .values("attempt_id")
        .annotate(n=Count("id"))
        .values_list("attempt_id", "n")
    )
    total_q_by_exam = dict(
        MockQuestion.objects.filter(group__section__exam_id__in={a.exam_id for a in latest_attempt.values()})
        .values("group__section__exam_id")
        .annotate(n=Count("id"))
        .values_list("group__section__exam_id", "n")
    )
    incidents_by_attempt = {}
    scope = ExamIntegrityIncident.objects.filter(attempt_id__in=attempt_ids, group_id=group_id)
    for inc in _teacher_alert_scope(scope, actor).order_by("-updated_at"):
        incidents_by_attempt.setdefault(inc.attempt_id, []).append({
            "id": inc.id,
            "eventType": inc.event_type,
            "eventLabelUz": UZ_EVENT_LABELS.get(inc.event_type, inc.event_type),
            "skill": inc.skill,
            "occurrenceCount": inc.occurrence_count,
            "status": inc.status,
            "reviewNote": inc.review_note,
            "observedAt": inc.observed_at,
            "createdAt": inc.created_at,
            "updatedAt": inc.updated_at,
            "offlineSynced": bool((inc.metadata or {}).get("offlineSynced")),
        })

    rows = []
    for sp in students:
        att = latest_attempt.get(sp.user_id)
        if att is None:
            rows.append({
                "studentId": sp.user_id,
                "name": sp.user.name,
                "status": "not_started",
                "attemptId": None,
                "examTitle": None,
                "currentSkill": None,
                "answeredCount": 0,
                "totalQuestions": 0,
                "connectionStatus": "idle",
                "lastActivityAt": None,
                "incidentCount": 0,
                "unreviewedCount": 0,
                "timeline": [],
            })
            continue
        timeline = incidents_by_attempt.get(att.id, [])
        alert_events = [item for item in timeline if item["eventType"] in ALERT_WORTHY_EVENTS]
        unreviewed = sum(1 for item in alert_events if item["status"] == "open")
        last_net = next((item for item in timeline if item["eventType"] in ("NETWORK_DISCONNECTED", "NETWORK_RECONNECTED")), None)
        conn = "offline" if (last_net and last_net["eventType"] == "NETWORK_DISCONNECTED") else "online"
        rows.append({
            "studentId": sp.user_id,
            "name": sp.user.name,
            "status": "submitted" if att.status in ("grading", "completed") else "in_progress",
            "attemptStatus": att.status,
            "attemptId": att.id,
            "examTitle": att.exam.title if att.exam else "",
            "currentSkill": att.current_skill,
            "answeredCount": answer_counts.get(att.id, 0),
            "totalQuestions": total_q_by_exam.get(att.exam_id, 0),
            "connectionStatus": conn if att.status == "in_progress" else "finished",
            "lastActivityAt": att.submitted_at or att.started_at,
            "incidentCount": sum(item["occurrenceCount"] for item in alert_events),
            "unreviewedCount": unreviewed,
            "timeline": timeline[:30],
        })

    return {"groupId": group_id, "groupName": group.name, "students": rows, "serverTime": timezone.now()}
