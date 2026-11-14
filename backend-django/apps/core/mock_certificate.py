"""Persisted IELTS/Multilevel result certificate; no grading or external I/O."""
import os
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO

from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from .legacy_tests import js_string
from .mock_attempts import aware


def generate(data):
    output = BytesIO()
    width, height = 595.28, 841.89
    doc = canvas.Canvas(output, pagesize=(width, height))
    accent = '#059669'  # Emerald
    dark_accent = '#064e3b'

    # Outer double border (Obsidian & Emerald)
    doc.setStrokeColor(dark_accent)
    doc.setLineWidth(3)
    doc.rect(26, 26, width - 52, height - 52)
    doc.setStrokeColor(accent)
    doc.setLineWidth(1)
    doc.rect(32, 32, width - 64, height - 64)

    def text(value, x, y, size=11, font='Helvetica', color='#1e293b', center=False):
        value = str(value)
        doc.setFillColor(color)
        if center:
            x = (width - stringWidth(value, font, size)) / 2
        item = doc.beginText(x, height - y)
        item.setFont(font, size)
        item.textOut(value)
        doc.drawText(item)

    def center(value, y, size=11, bold=False, color='#475569'):
        font = 'Helvetica-Bold' if bold else 'Helvetica'
        lines = ['']
        for word in str(value).split(' '):
            candidate = (lines[-1] + ' ' + word).lstrip()
            if lines[-1] and stringWidth(candidate, font, size) > width - 100:
                lines.append(word)
            else:
                lines[-1] = candidate
        for index, line_value in enumerate(lines):
            text(line_value, 0, y + index * size * 1.2, size, font, color, True)
        return (len(lines) - 1) * size * 1.2

    def fixed(value):
        return str(Decimal.from_float(float(value)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))

    # Header branding
    center(os.environ.get('CENTER_NAME', "BESTWAY EDUCATION"), 95, 26, True, dark_accent)
    center('EXAM PREPARATION & ASSESSMENT CENTER', 120, 9, False, '#64748b')
    internal = data.get('certificateType') == 'BESTWAY_INTERNAL_MOCK'
    if internal:
        cert_heading = 'BESTWAY INTERNAL MOCK RESULT'
    elif data.get('isPartial'):
        cert_heading = 'IELTS SKILL PRACTICE REPORT' if data.get('isIelts') else 'MULTILEVEL SKILL PRACTICE REPORT'
    elif not data.get('specificationVersion'):
        cert_heading = 'MOCK TEST REPORT'
    else:
        cert_heading = 'MULTILEVEL CEFR ESTIMATED RESULT'
    center(cert_heading, 145, 13, True, accent)

    center('Practice report for' if data.get('isPartial') else 'This certifies that', 182, 11, False, '#64748b')
    extra = center(data['studentName'], 210, 22, True, '#0f172a')
    title = data['examTitle'] + (f" ({data['level']})" if data.get('level') else '') + ' — ' + data['examType'].replace('_', ' ', 1).upper()
    extra += center(title, 238 + extra, 12, True, accent)

    y = 282 + extra
    for value, x in [('Section / Skill', 130), ('Raw Score', 310)]:
        text(value, x, y, 11, 'Helvetica-Bold', '#0f172a')
    if data['isIelts']:
        text('Band Score', 420, y, 11, 'Helvetica-Bold', '#0f172a')
    elif data.get('specificationVersion') or data.get('isPartial'):
        text('Estimate /75', 420, y, 11, 'Helvetica-Bold', '#0f172a')

    def line(y_pos):
        doc.setStrokeColor('#cbd5e1')
        doc.setLineWidth(0.8)
        doc.line(130, height - y_pos, 475, height - y_pos)

    line(y + 10)
    y += 24

    for row in data['sections']:
        text(row['skill'].capitalize(), 130, y, 11, 'Helvetica', '#334155')
        text(js_string(row['score']) + ' / ' + js_string(row['max']), 310, y, 11, 'Helvetica', '#334155')
        if data['isIelts']:
            text(fixed(row['band']) if row.get('band') is not None else '—', 420, y, 11, 'Helvetica-Bold', '#0f172a')
        elif data.get('specificationVersion') or data.get('isPartial'):
            val_to_show = row.get('standardScore') if row.get('standardScore') is not None else row.get('score')
            text(js_string(val_to_show) if val_to_show is not None else 'Pending', 420, y, 11, 'Helvetica-Bold', '#0f172a')
        y += 22

    line(y + 4)
    y += 44

    if data.get('isPartial'):
        # Section practice: no overall score and no CEFR level exist.
        center('Section practice only — no overall score or CEFR level is issued.', y, 10, True, '#64748b')
    elif data['isIelts']:
        band_val = data.get('overallBand')
        if band_val is not None:
            center('OVERALL BAND SCORE', y, 11, True, '#64748b')
            center(fixed(band_val), y + 44, 42, True, accent)
    else:
        sc_val = data.get('overallScore')
        cefr = data.get('cefrLevel')
        if sc_val is not None and cefr:
            center('ESTIMATED SCORE: ' + js_string(sc_val) + ' / 75', y, 11, True, '#64748b')
            center(cefr, y + 44, 42, True, accent)

    if internal:
        # Owner decision B: the internal certificate states plainly what it is not (uz + en).
        center('BestWay ichki mock natijasi — rasmiy CEFR/UZBMB sertifikati emas.', y + 110, 10, True, '#b45309')
        center('BestWay internal mock result — not an official CEFR/UZBMB certificate.', y + 126, 10, True, '#b45309')
        center('Level from the BestWay Multilevel blueprint table (B1 38–50, B2 51–64, C1 65–75).', y + 144, 8, False, '#64748b')

    # Footer verification metadata
    base_url = (os.environ.get('FRONTEND_URL') or 'https://bestwayec.uz').rstrip('/')
    verify_url = f"{base_url}/tests/attempt/{data['attemptId']}"
    if internal and data.get('verificationCode'):
        api_url = (os.environ.get('PUBLIC_URL') or 'https://api.bestwayec.uz').rstrip('/')
        verify_url = f"{api_url}/v1/certificates/{data['attemptId']}/verify?code={data['verificationCode']}"
        from reportlab.graphics import renderPDF
        from reportlab.graphics.barcode.qr import QrCodeWidget
        from reportlab.graphics.shapes import Drawing
        widget = QrCodeWidget(verify_url)
        x0, y0, x1, y1 = widget.getBounds()
        size = 78
        drawing = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
        drawing.add(widget)
        renderPDF.draw(drawing, doc, width - 50 - size, 40)
        text('Verification code: ' + data['verificationCode'], 50, height - 104, 9, 'Helvetica-Bold', '#0f172a')
    finished_str = aware(data['finishedAt']).strftime('%Y-%m-%d') if data.get('finishedAt') else 'N/A'

    text('Issue Date: ' + finished_str, 50, height - 90, 9, color='#475569')
    text(('Report ID: ' if data.get('isPartial') else 'Certificate ID: ') + data['attemptId'], 50, height - 76, 8, color='#64748b')
    text('Verify online: ' + verify_url, 50, height - 62, 8, color=accent)
    text('BestWay Mock Examination Engine · Unofficial Diagnostic Practice Report', 50, height - 48, 7, color='#94a3b8')

    doc.showPage()
    doc.save()
    return output.getvalue()
