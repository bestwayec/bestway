"""Teacher Result Center 5.1: one assigned exam, from the authoritative dataset."""
from __future__ import annotations

from io import BytesIO

from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from common.auth.permissions import roles

from . import exam_report, exam_report_delivery
from .models import ExamReportState, TelegramOutbox

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(value):
    """Spreadsheet formula-injection guard for text cells (names come from users)."""
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def _delivery(assignment_id):
    st = ExamReportState.objects.filter(assignment_id=assignment_id).first()
    rows = TelegramOutbox.objects.filter(dedupe_key__startswith=f"exam_board:{assignment_id}:").order_by("-id")[:20]
    return dict(preliminaryAt=st.preliminary_at if st else None, finalAt=st.final_at if st else None,
                finalVersion=st.final_version if st else 0,
                messages=[dict(key=r.dedupe_key.split(":")[2], status=r.status, error=r.last_error or None,
                               sentAt=r.sent_at, createdAt=r.created_at) for r in rows])


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def exam_results_view(request, assignment_id: str):
    row = exam_report.assignment_for(request.user, assignment_id)
    report = exam_report.build(row)
    params = request.query_params
    rows = report["rows"]
    if params.get("participation"):
        rows = [r for r in rows if r["participation"] == params["participation"]]
    if params.get("grading"):
        rows = [r for r in rows if r["grading"] == params["grading"]]
    if params.get("search"):
        needle = params["search"][:100].casefold()
        rows = [r for r in rows if needle in r["name"].casefold()]
    try:
        page, limit = max(1, int(params.get("page", 1))), min(200, max(1, int(params.get("limit", 50))))
    except ValueError:
        page, limit = 1, 50
    total = len(rows)
    report["rows"] = rows[(page - 1) * limit:page * limit]
    report["pagination"] = dict(page=page, limit=limit, total=total)
    report["delivery"] = _delivery(row.id)
    return Response({"success": True, "data": report})


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def exam_results_excel_view(request, assignment_id: str):
    import openpyxl
    row = exam_report.assignment_for(request.user, assignment_id)
    report = exam_report.build(row)
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Results"
    sheet.append([safe_cell(f"{report['examTitle']} — {report['groupName']}"), report["stage"].upper(), report["revision"]])
    sheet.append(["Rank", "Student", "Listening", "Reading", "Writing", "Speaking", "Overall", "CEFR", "Growth",
                  "Participation", "Grading", "Submitted at (UTC)"])
    for r in report["rows"]:
        s = r["scores"]
        sheet.append([r["rank"], safe_cell(r["name"]), s["listening"], s["reading"], s["writing"], s["speaking"],
                      r["overall"], r["cefr"], r["growth"], r["participation"], r["grading"],
                      r["submittedAt"].replace(tzinfo=None) if r["submittedAt"] else None])
    buffer = BytesIO()
    book.save(buffer)
    response = HttpResponse(buffer.getvalue(), content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    response["Content-Disposition"] = f'attachment; filename="exam-results-{row.id[:8]}.xlsx"'
    return response


@api_view(["POST"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def exam_results_resend_view(request, assignment_id: str):
    """Explicitly confirmed resend of the current report; grades are never recalculated or duplicated."""
    row = exam_report.assignment_for(request.user, assignment_id)
    if (request.data or {}).get("confirm") is not True:
        from common.api.exceptions import ContractAPIException
        raise ContractAPIException("CONFIRMATION_REQUIRED", "Qayta yuborishni tasdiqlang", 400)
    from django.db import connection
    from django.utils import timezone
    from . import telegram_outbox as outbox
    from . import telegram_state as state
    from .auth_service import audit
    report = exam_report.build(row)
    if report["stage"] == "open" or not report["teacherId"]:
        return Response({"success": True, "data": dict(queued=0, reason=report["stage"])})
    lang = state.language_of(report["teacherId"])
    stamp = int(timezone.now().timestamp())
    texts = exam_report_delivery.pages(report, lang)
    queued = sum(bool(outbox.enqueue(report["teacherId"], "teacher", f"exam_board:{row.id}:resend-{stamp}:{report['revision']}:{i}",
                                     text, now=timezone.now(), urgent=True)) for i, text in enumerate(texts))
    with connection.cursor() as cursor:
        audit(cursor, request.user.id, "exam.report.resend", "HomeworkAssignment", row.id, new=dict(revision=report["revision"], queued=queued))
    return Response({"success": True, "data": dict(queued=queued, revision=report["revision"])}, status=201)


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def exam_results_pdf_view(request, assignment_id: str):
    """A4 PDF of the same dataset as the gradebook (ReportLab, Unicode font when available)."""
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle
    from xml.sax.saxutils import escape
    row = exam_report.assignment_for(request.user, assignment_id)
    report = exam_report.build(row)
    styles = getSampleStyleSheet()
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=landscape(A4), title=report["examTitle"])
    head = ["#", "Student", "L", "R", "W", "S", "Overall", "Growth", "Status"]
    body = [[r["rank"] or "—", Paragraph(escape(r["name"]), styles["Normal"]),
             *[("—" if r["scores"][s] is None else r["scores"][s]) if s not in r["pendingSkills"] else "pending" for s in exam_report.SKILLS],
             "—" if r["overall"] is None else r["overall"], "—" if r["growth"] is None else r["growth"],
             f"{r['participation']} / {r['grading']}"] for r in report["rows"]]
    table = Table([head, *body], repeatRows=1)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, "#999999"), ("BACKGROUND", (0, 0), (-1, 0), "#e8eef7")]))
    c = report["counts"]
    doc.build([Paragraph(escape(f"{report['examTitle']} — {report['groupName']} ({report['stage'].upper()})"), styles["Title"]),
               Paragraph(escape(f"Eligible {c['eligible']} · handed in {c['handedIn']} (auto {c['autoSubmitted']}) · "
                                f"fully graded {c['finalized']} · awaiting {c['awaitingGrading']} · not submitted {c['notSubmitted'] + c['notStarted']} · "
                                f"average {report['stats']['average'] if report['stats']['average'] is not None else 'n/a'} (n={report['stats']['sample']})"),
                         styles["Normal"]), table])
    response = HttpResponse(buffer.getvalue(), content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="exam-results-{row.id[:8]}.pdf"'
    return response


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def group_exam_progress_view(request, group_id: str):
    from . import exam_progress
    return Response({"success": True, "data": exam_progress.group_progress(request.user, group_id, request.query_params)})


@api_view(["GET"])
@permission_classes([roles("teacher", "admin", "super_admin")])
def student_exam_progress_view(request, group_id: str, student_id: str):
    from . import exam_progress
    return Response({"success": True, "data": exam_progress.student_progress(request.user, group_id, student_id, request.query_params)})
