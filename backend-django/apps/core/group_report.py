"""Official B2B Monthly Group Analytics & Performance Report Generator.
Produces authentic A4 Executive PDF Reports (ReportLab) & Excel Exports
for Education Center Management, Parents Assemblies, and Academic Board.
"""
from __future__ import annotations

import os
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO
from datetime import datetime
from typing import Any, Dict, List

from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from apps.legacy_schema.models import User
from .teacher_analytics import get_group_analytics


def generate_group_monthly_pdf(actor: User, group_id: str, month: str = None) -> bytes:
    """Generate official A4 B2B Monthly Performance PDF Report."""
    data = get_group_analytics(actor, group_id)
    report_month = month or datetime.now().strftime("%Y-%m")
    
    output = BytesIO()
    width, height = 595.28, 841.89  # A4 Portrait
    doc = canvas.Canvas(output, pagesize=(width, height))
    
    primary = "#064e3b"   # Dark Emerald
    accent = "#059669"    # Emerald 600
    slate_dark = "#0f172a"
    slate_muted = "#475569"
    border_color = "#cbd5e1"

    # Outer Decorative Frame
    doc.setStrokeColor(primary)
    doc.setLineWidth(2.5)
    doc.rect(28, 28, width - 56, height - 56)
    
    doc.setStrokeColor(accent)
    doc.setLineWidth(0.8)
    doc.rect(34, 34, width - 68, height - 68)

    def text(val, x, y, size=10, font="Helvetica", color=slate_dark, center=False):
        val = str(val)
        doc.setFillColor(color)
        if center:
            x = (width - stringWidth(val, font, size)) / 2
        item = doc.beginText(x, height - y)
        item.setFont(font, size)
        item.textOut(val)
        doc.drawText(item)

    def center_text(val, y, size=11, bold=False, color=slate_muted):
        font = "Helvetica-Bold" if bold else "Helvetica"
        text(val, 0, y, size=size, font=font, color=color, center=True)

    # 1. Header Branding
    center_text(os.environ.get("CENTER_NAME", "GRAND EDUCATION & BESTWAY ACADEMY"), 65, 20, True, primary)
    center_text("XALQARO IMTIHONLARGA TAYYORLASH VA BAHOLASH MARKAZI", 84, 8, False, "#64748b")
    center_text("OYLIK AKADEMIK TAHLIL VA GURUH MONITORINGI HISOBOTI", 104, 12, True, accent)

    # 2. Meta Info Banner
    doc.setFillColor("#f8fafc")
    doc.rect(48, height - 165, width - 96, 45, fill=1, stroke=0)
    doc.setStrokeColor(border_color)
    doc.setLineWidth(0.6)
    doc.rect(48, height - 165, width - 96, 45, fill=0, stroke=1)

    text(f"Guruh: {data['groupName']}", 60, 134, 10, "Helvetica-Bold", slate_dark)
    text(f"Ustoz: {data['teacherName']}", 60, 150, 9, "Helvetica", slate_muted)
    
    text(f"Hisobot Davri: {report_month}", 260, 134, 9, "Helvetica", slate_muted)
    text(f"Jami O'quvchilar: {data['totalStudents']} nafar", 260, 150, 9, "Helvetica", slate_muted)

    text(f"Guruh O'rtacha Balli: {data['groupAverageScore']}", 420, 134, 10, "Helvetica-Bold", accent)
    text(f"Topshirilgan Mocklar: {data['totalMockAttempts']} ta", 420, 150, 9, "Helvetica", slate_muted)

    # 3. Table Headers
    y = 195
    headers = [
        ("№", 55),
        ("Talaba F.I.Sh", 80),
        ("Davomat", 250),
        ("Mocklar", 320),
        ("Insholar", 380),
        ("O'rtacha Ball", 440),
        ("Holati", 505),
    ]

    doc.setFillColor("#f1f5f9")
    doc.rect(48, height - y - 14, width - 96, 18, fill=1, stroke=0)
    for title, x_pos in headers:
        text(title, x_pos, y, 9, "Helvetica-Bold", slate_dark)

    y += 18
    doc.setStrokeColor(border_color)
    doc.line(48, height - y + 4, width - 48, height - y + 4)

    # 4. Student Rows
    students = data.get("students", [])[:18]  # Limit to 18 rows for clear A4 page
    for idx, st in enumerate(students):
        row_bg = "#ffffff" if idx % 2 == 0 else "#f8fafc"
        doc.setFillColor(row_bg)
        doc.rect(48, height - y - 11, width - 96, 16, fill=1, stroke=0)

        status_text = "Faol" if st.get("isActive") else "Nofaol"
        status_color = "#16a34a" if st.get("isActive") else "#dc2626"

        text(str(idx + 1), 55, y, 8, "Helvetica", slate_muted)
        text(st["name"][:26], 80, y, 8, "Helvetica-Bold", slate_dark)
        text(f"{st['attendanceRate']}%", 250, y, 8, "Helvetica", slate_dark)
        text(str(st["mockAttemptsCount"]), 325, y, 8, "Helvetica", slate_muted)
        text(str(st["essaysCount"]), 385, y, 8, "Helvetica", slate_muted)
        text(st["scoreLabel"], 450, y, 8, "Helvetica-Bold", accent)
        text(status_text, 505, y, 8, "Helvetica-Bold", status_color)

        y += 16
        if y > 580:
            break

    doc.setStrokeColor(border_color)
    doc.line(48, height - y + 4, width - 48, height - y + 4)

    # 5. Group Weak Topics Breakdown
    y += 20
    text("GURUH BO'YICHA ASOSIY ZAIF NUQTALAR VA TAVSIYALAR", 48, y, 10, "Helvetica-Bold", primary)
    y += 14

    for wt in data.get("weakTopicsHeatmap", [])[:3]:
        text(f"• {wt['topic']} (Xatolik: {wt['groupErrorRate']}%)", 55, y, 8, "Helvetica-Bold", slate_dark)
        text(f"  Tavsiya: {wt['recommendation']}", 55, y + 10, 8, "Helvetica", slate_muted)
        y += 22

    # 6. Signatures and Official Stamp Box
    y = height - 120
    doc.setStrokeColor("#94a3b8")
    doc.line(60, y, 200, y)
    doc.line(width - 200, y, width - 60, y)

    doc.beginText(60, y - 14)
    item = doc.beginText(60, y - 14)
    item.setFont("Helvetica", 8); item.textOut("Guruh O'qituvchisi Imzosi"); doc.drawText(item)

    item2 = doc.beginText(width - 200, y - 14)
    item2.setFont("Helvetica", 8); item2.textOut("O'quv Bo'limi Rahbari / Muhr O'rni"); doc.drawText(item2)

    # 7. Security and Integrity Footer
    doc.setFillColor("#64748b")
    verify_url = f"https://bestwayec.uz/groups/{group_id}"
    text(f"Hujjat haqiqiyligi tekshiruvi: {verify_url} · Grand Education B2B Analytics Engine", 48, height - 42, 7, color="#94a3b8")

    doc.showPage()
    doc.save()
    return output.getvalue()


def generate_group_monthly_csv(actor: User, group_id: str, month: str = None) -> str:
    """Generate Excel-compatible UTF-8 BOM CSV export for group performance."""
    data = get_group_analytics(actor, group_id)
    report_month = month or datetime.now().strftime("%Y-%m")

    lines = [
        f"Guruh Hisoboti: {data['groupName']}",
        f"Ustoz: {data['teacherName']}",
        f"Hisobot Davri: {report_month}",
        f"Guruh O'rtacha Balli: {data['groupAverageScore']}",
        "",
        "O'rin,Talaba F.I.Sh,Telefon,Davomat Foizi,Mocklar Soni,Insholar Soni,O'rtacha Ball,Faollik Holati,Oxirgi Faollik",
    ]

    for idx, st in enumerate(data.get("students", [])):
        status = "Faol" if st.get("isActive") else "Nofaol"
        clean_name = st["name"].replace('"', '""')
        line = f'{idx + 1},"{clean_name}","{st["phone"]}","{st["attendanceRate"]}%",{st["mockAttemptsCount"]},{st["essaysCount"]},"{st["scoreLabel"]}","{status}","{st["lastActiveAt"]}"'
        lines.append(line)

    return "\ufeff" + "\n".join(lines)
