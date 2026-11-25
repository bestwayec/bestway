"""Print and spreadsheet representations of the same authorized classroom report."""
import calendar
import csv
from datetime import date
from io import BytesIO, StringIO

from openpyxl import Workbook
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

from .teacher_analytics import get_group_analytics, invalid

SCALES = {"ielts_academic": "IELTS Academic", "ielts_general": "IELTS General", "multilevel": "Multilevel"}


def _data(actor, group_id, month, params):
    query = dict(params.items()) if params else {}
    if month:
        try:
            start = date.fromisoformat(f"{month}-01")
        except ValueError:
            invalid("Use YYYY-MM for the report month.")
        query.setdefault("from", start.isoformat())
        query.setdefault("to", start.replace(day=calendar.monthrange(start.year, start.month)[1]).isoformat())
    return get_group_analytics(actor, group_id, query)


def _tables(data):
    summary = [
        ["Guruh", data["groupName"]],
        ["O'qituvchi", data["teacherName"]],
        ["Guruh a'zolari", data["totalStudents"]],
        ["Hisobotdagi o'quvchilar", data.get("totalEligible")],
        ["Boshlagan", data.get("startedStudents")],
        ["Topshirgan", data.get("submittedStudents")],
        ["Baholash kutilmoqda", data.get("pendingStudents")],
        ["Baholangan", data.get("gradedStudents")],
        ["Topshirmagan", data.get("notSubmittedStudents")],
        ["Topshirish (%)", data.get("completionRate")],
        ["Davomat (%)", data.get("groupAverageAttendance")],
        ["Urinishlar", data["totalMockAttempts"]],
    ]
    for track, score in data.get("groupAveragesByScale", {}).items():
        label = SCALES[track]
        summary.append([f"{label} · o‘rtacha", score])
        scale = data.get("scaleSummary", {}).get(track, {})
        summary.extend([[f"{label} · mediana", scale.get("median")], [f"{label} · eng yuqori", scale.get("best")]])
    students = [["O'quvchi", "Davomat (%)", "Urinishlar", *SCALES.values(), "Oxirgi faollik"]]
    for row in data["students"]:
        timestamp = row.get("lastActiveAt")
        students.append([row["name"], row["attendanceRate"], row["mockAttemptsCount"],
                         *[row.get("scoresByScale", {}).get(scale) for scale in SCALES],
                         str(timestamp)[:16] if timestamp else None])
    ranks = [["O'rin", "O'quvchi", "Shkala", "Natija", "Tahrir", "Baholash versiyasi"]]
    ranks.extend([[row["rank"], row["name"], SCALES[row["track"]], row["score"],
                   row["specificationVersion"], row["scoreVersion"]] for row in data.get("ranking", [])])
    topics = [["Shkala", "Bo'lim", "Savol turi", "To'g'ri", "Xato", "Javobsiz", "Aniqlik (%)"]]
    topics.extend([[SCALES.get(row.get("track"), ""), row.get("skill"), row["topic"], row.get("correct"),
                    row.get("incorrect"), row.get("unanswered"), row.get("accuracy")] for row in data.get("weakTopicsHeatmap", [])])
    skills = [["Shkala", "Bo'lim", "O'rtacha", "O'quvchilar", "Urinishlar"]]
    for track, sections in data.get("skills", {}).items():
        skills.extend([[SCALES[track], skill, row["average"], row["students"], row["attempts"]]
                       for skill, row in sections.items()])
    difficulty = [["Bo'lim", "Savol", "Savol turi", "To'g'ri", "Xato", "Javobsiz"]]
    difficulty.extend([[row["skill"], row["number"], row["questionType"], row["correct"], row["incorrect"], row["unanswered"]]
                       for row in data.get("questionDifficulty", [])])
    distribution = [["Shkala", "Natija", "Soni"]]
    for track, scores in data.get("scoreDistribution", {}).items():
        distribution.extend([[SCALES[track], row["score"], row["count"]] for row in scores])
    history = [["Davr yoki imtihon", "Shkala", "O'rtacha", "Urinishlar"]]
    for key, label in (("weeklyHistory", "week"), ("history", "month"), ("examHistory", "title")):
        history.extend([[row[label], SCALES[row["track"]], row["average"], row["attempts"]] for row in data.get(key, [])])
    monthly_skills = [["Oy", "Shkala", "Bo'lim", "O'rtacha", "Urinishlar"]]
    monthly_skills.extend([[row["month"], SCALES[row["track"]], row["skill"], row["average"], row["attempts"]]
                           for row in data.get("skillHistory", [])])
    tables = {"Hisobot": summary, "O'quvchilar": students, "Reyting": ranks, "Savol turlari": topics,
              "Bo'limlar": skills, "Savollar": difficulty, "Taqsimot": distribution, "Natijalar tarixi": history,
              "Bo‘limlar tarixi": monthly_skills}
    return {title: rows for title, rows in tables.items() if len(rows) > 1 or title in ("O'quvchilar", "Reyting", "Savol turlari")}


def generate_group_monthly_pdf(actor, group_id, month=None, params=None):
    tables = _tables(_data(actor, group_id, month, params))
    output = BytesIO()
    document = SimpleDocTemplate(output, pagesize=landscape(A4), title="Guruh imtihon hisoboti")
    styles = getSampleStyleSheet()
    story = []
    for title, rows in tables.items():
        story.append(Paragraph(escape(title), styles["Heading2"]))
        headers = 0 if title == "Hisobot" else 1
        contents = [[Paragraph(escape(str(value)) if value is not None else "—", styles["BodyText"])
                     for value in row] for row in rows]
        table = Table(contents, colWidths=[document.width / len(rows[0])] * len(rows[0]), repeatRows=headers)
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.white, colors.HexColor("#eff4f1")]),
        ]))
        story.extend([table, Spacer(1, 14)])
    document.build(story)
    return output.getvalue()


def generate_group_workbook(actor, group_id, month=None, params=None):
    workbook = Workbook()
    workbook.remove(workbook.active)
    for title, rows in _tables(_data(actor, group_id, month, params)).items():
        sheet = workbook.create_sheet(title)
        for values in rows:
            sheet.append(values)
            for cell in sheet[sheet.max_row]:
                if cell.data_type == "f":
                    cell.data_type = "s"
        sheet.freeze_panes = "A2"
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def generate_group_monthly_csv(actor, group_id, month=None):
    output = StringIO(newline="")
    writer = csv.writer(output)
    for title, rows in _tables(_data(actor, group_id, month, None)).items():
        writer.writerow([title])
        for row in rows:
            writer.writerow(["'" + value if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@"))
                             else value for value in row])
    return "\ufeff" + output.getvalue()
