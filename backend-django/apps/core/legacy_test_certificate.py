"""Local legacy result PDF. No external service, result grading or schema writes."""
from io import BytesIO
import os
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from .mock_attempts import aware


def generate(data):
    output=BytesIO(); width,height=595.28,841.89
    doc=canvas.Canvas(output,pagesize=(width,height))
    doc.setStrokeColor('#1a4f8b'); doc.setLineWidth(2); doc.rect(30,30,width-60,height-60)
    doc.setLineWidth(.5); doc.rect(36,36,width-72,height-72)
    def centered(text,y,font='Helvetica',size=11,color='#666666'):
        doc.setFillColor(color)
        value=doc.beginText((width-stringWidth(str(text),font,size))/2,height-y)
        value.setFont(font,size); value.textOut(str(text)); doc.drawText(value)
    centered(os.environ.get('CENTER_NAME',"O'quv Markazi"),112,'Helvetica-Bold',24,'#1a4f8b')
    centered('NATIJA SERTIFIKATI',138,size=14,color='#444444')
    centered('Ushbu sertifikat',185)
    centered(data['studentName'],215,'Helvetica-Bold',20,'#000000')
    centered('quyidagi testni muvaffaqiyatli topshirgani uchun berildi:',244)
    title=data['testTitle']+(f" ({data['level']})" if data['level'] else '')+' — '+data['testType'].upper()
    centered(title,271,'Helvetica-Bold',14,'#1a4f8b')
    def cell(text,x,y,bold=False,size=12):
        doc.setFillColor('#000000'); value=doc.beginText(x,height-y)
        value.setFont('Helvetica-Bold' if bold else 'Helvetica',size); value.textOut(str(text)); doc.drawText(value)
    y=320; cell("Bo'lim",160,y,True); cell('Ball',380,y,True)
    doc.setStrokeColor('#999999'); doc.line(160,height-y-10,440,height-y-10); y+=26
    number=lambda n:format(n,'.15g')
    for section in data['sections']:
        cell(section['section'].capitalize(),160,y); cell(f"{number(section['score'])} / {number(section['maxScore'])}",380,y); y+=20
    y+=6; doc.line(160,height-y,440,height-y); y+=20
    cell('JAMI',160,y,True,13); cell(f"{number(data['totalScore'])} / {number(data['totalMax'])}",380,y,True,13)
    cell('Sana: '+aware(data['finishedAt']).strftime('%Y-%m-%d'),60,height-110,size=10)
    cell('Sertifikat ID: '+data['attemptId'],60,height-94,size=8)
    cell('Ushbu hujjat markaz administratsiyasi tomonidan tasdiqlangan taqdirda haqiqiy hisoblanadi.',60,height-78,size=8)
    doc.showPage(); doc.save(); return output.getvalue()
