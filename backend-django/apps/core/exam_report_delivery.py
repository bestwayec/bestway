"""Automatic exam reports from the authoritative dataset (BESTWAY 5.1).

* Private teacher leaderboard: every eligible student exactly once (ranked finalized
  results with L/R/W/S, then awaiting grading, then not handed in), split into pages under
  the Telegram limit, to the supervising teacher's own verified private chat only.
* Preliminary stage: queued once when the exam closes. Final stage: queued when every
  submitted result is teacher-final; a later authorized grade correction produces a new,
  clearly labelled revision. An unchanged report is never queued twice.
* Durable: ``ExamReportState`` records the revision queued per stage; the sweep has no
  narrow time window, so a report missed during downtime is produced on the next pass.
* The classroom group keeps the existing aggregate, small-group-suppressed report
  (``telegram_notify.homework_group_report``); no named result is ever posted there.
"""
from __future__ import annotations

from datetime import timedelta
from html import escape

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import exam_report
from . import telegram_outbox as outbox
from . import telegram_state as state
from .models import ExamReportState, HomeworkAssignment

PAGE_LIMIT = 3500
LOOKBACK = timedelta(days=30)
MEDALS = {1: "🥇", 2: "🥈", 3: "🥉"}

TEXT = {
    "uz": dict(final="YAKUNIY NATIJALAR", preliminary="DASTLABKI NATIJALAR (Writing/Speaking baholanmoqda)",
               revised="tuzatilgan versiya {v}", group="Guruh", stats="📊 Guruh statistikasi", total="Jami",
               handed="Topshirganlar", auto="Avtomatik topshirilgan", finalized="To‘liq baholanganlar",
               waiting="Baholash kutilmoqda", missing="Topshirmaganlar", running="Hali yozmoqda", average="O‘rtacha",
               none="mavjud emas", page="sahifa", pending_head="⏳ Baholash kutilmoqda:", missing_head="📋 Topshirmaganlar:",
               open_web="Teacher Workspace", rank_note="Teng ballar bir xil o‘rinni oladi."),
    "en": dict(final="FINAL RESULTS", preliminary="PRELIMINARY RESULTS (Writing/Speaking being graded)",
               revised="revision {v}", group="Group", stats="📊 Group statistics", total="Total",
               handed="Handed in", auto="Auto-submitted", finalized="Fully graded", waiting="Awaiting grading",
               missing="Not handed in", running="Still writing", average="Average", none="not available", page="page",
               pending_head="⏳ Awaiting grading:", missing_head="📋 Not handed in:", open_web="Teacher Workspace",
               rank_note="Equal scores share a rank."),
}


def fmt(value, scale):
    if value is None:
        return "—"
    return f"{value:g}" if scale != "ielts" else f"{value:.1f}"


def line(entry, scale):
    head = f"{MEDALS.get(entry['rank'], '')} {entry['rank']}. {escape(entry['name'])} — <b>{fmt(entry['overall'], scale)}</b>".strip()
    if scale == "multilevel" and entry.get("cefr"):
        head += f" ({escape(entry['cefr'])})"
    if scale == "raw" and entry.get("rawMax"):
        head += f"/{entry['rawMax']:g}"
    below = entry.get("belowRange") or []
    skills = " | ".join(f"{k[0].upper()}: {'&lt;4.0' if k in below else fmt(v, scale)}" for k, v in entry["scores"].items() if v is not None)
    return head + (f"\n    {skills}" if skills and scale != "raw" else "")


def pages(report, lang, version=0):
    t = TEXT.get(lang, TEXT["uz"])
    scale = report["scale"]
    stage = t["final"] if report["stage"] == "final" else t["preliminary"]
    if report["stage"] == "final" and version > 1:
        stage += f" · {t['revised'].format(v=version)}"
    c, s = report["counts"], report["stats"]
    header = (f"🏆 <b>BESTWAY — {escape(report['examTitle'])}</b>\n{t['group']}: {escape(report['groupName'] or '—')}\n"
              f"<b>{stage}</b>")
    body = [line(r, scale) for r in report["rows"] if r["rank"] is not None]
    pending = [r for r in report["rows"] if r["rank"] is None and r["participation"] in ("submitted", "auto_submitted", "in_progress")]
    missing = [r for r in report["rows"] if r["participation"] in ("not_started", "not_submitted")]
    if pending:
        body.append(t["pending_head"])
        body += [f"• {escape(r['name'])} — {'/'.join(x.capitalize() for x in r['pendingSkills']) or t['running']}" for r in pending]
    if missing:
        body.append(t["missing_head"])
        body += [f"• {escape(r['name'])}" for r in missing]
    average = fmt(s["average"], scale) if s["average"] is not None else t["none"]
    footer = (f"{t['stats']}\n{t['total']}: {c['eligible']}\n{t['handed']}: {c['handedIn']} ({t['auto']}: {c['autoSubmitted']})\n"
              f"{t['finalized']}: {c['finalized']}\n{t['waiting']}: {c['awaitingGrading']}\n{t['missing']}: {c['notSubmitted'] + c['notStarted']}\n"
              f"{t['average']}: {average} (n={s['sample']})\n<i>{t['rank_note']}</i>")
    chunks, current = [], []
    for item in body:
        if current and len("\n".join(current)) + len(item) + len(header) + 40 > PAGE_LIMIT:
            chunks.append(current)
            current = []
        current.append(item)
    chunks.append(current)
    out = []
    for index, chunk in enumerate(chunks):
        text = header + (f" · {t['page']} {index + 1}/{len(chunks)}" if len(chunks) > 1 else "") + "\n\n" + "\n".join(chunk)
        if index == len(chunks) - 1:
            text += "\n\n" + footer
        out.append(text)
    return out


def keyboard(report, lang):
    base = getattr(settings, "PUBLIC_WEB_URL", "") or "https://bestwayec.uz"
    t = TEXT.get(lang, TEXT["uz"])
    return [[{"text": t["open_web"], "url": f"{base}/teacher/results/exam/{report['assignmentId']}"}]]


def deliver(assignment_id, *, now=None):
    """Queue the leaderboard for the current stage if its content changed. Returns what was queued."""
    now = now or timezone.now()
    row = HomeworkAssignment.objects.select_related("cohort", "cohort__classroom", "exam").filter(pk=assignment_id).first()
    if row is None or row.exam_id is None:
        return dict(queued=0, reason="missing")
    report = exam_report.build(row, now=now)
    if report["stage"] == "open":
        return dict(queued=0, reason="open")
    teacher_id = report["teacherId"]
    with transaction.atomic():
        st, _ = ExamReportState.objects.select_for_update().get_or_create(assignment_id=row.id)
        if report["stage"] == "preliminary":
            if st.preliminary_revision or st.final_revision:
                return dict(queued=0, reason="unchanged")
            st.preliminary_revision, st.preliminary_at = report["revision"], now
            version = 0
        else:
            if st.final_revision == report["revision"]:
                return dict(queued=0, reason="unchanged")
            st.final_version += 1
            st.final_revision, st.final_at = report["revision"], now
            version = st.final_version
        st.save()
        queued = 0
        if teacher_id:
            lang = state.language_of(teacher_id)
            texts = pages(report, lang, version)
            for index, text in enumerate(texts):
                key = f"exam_board:{row.id}:{report['stage']}:{report['revision']}:{index}"
                queued += bool(outbox.enqueue(teacher_id, "teacher", key, text,
                                              keyboard(report, lang) if index == len(texts) - 1 else None, now=now))
    return dict(queued=queued, stage=report["stage"], revision=report["revision"], version=version)


def sweep(now=None):
    """Closed exam assignments whose final report is not yet queued (bounded, catch-up safe)."""
    from . import telegram_notify
    now = now or timezone.now()
    ids = list(HomeworkAssignment.objects.filter(exam_id__isnull=False, cohort__classroom_id__isnull=False,
                                                 deadline__lte=now, deadline__gte=now - LOOKBACK)
               .exclude(report_state__final_at__isnull=False).order_by("deadline").values_list("pk", flat=True)[:50])
    queued = 0
    for assignment_id in ids:
        queued += deliver(assignment_id, now=now)["queued"]
        report = telegram_notify.homework_group_report(assignment_id, reason="automatic", now=now)
        queued += int(report.get("queuedGroup", False)) + int(report.get("queuedTeacher", False))
    return queued
