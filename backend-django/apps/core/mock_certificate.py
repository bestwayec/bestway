"""Persisted IELTS/Multilevel result certificate; no grading or external I/O."""
from io import BytesIO
from decimal import Decimal,ROUND_HALF_UP
import os
from reportlab.pdfgen import canvas
from reportlab.pdfbase.pdfmetrics import stringWidth
from .mock_attempts import aware
from .legacy_tests import js_string


def generate(data):
    output=BytesIO(); width,height=595.28,841.89
    doc=canvas.Canvas(output,pagesize=(width,height)); accent='#1a4f8b'
    doc.setStrokeColor(accent); doc.setLineWidth(2); doc.rect(30,30,width-60,height-60)
    doc.setLineWidth(.5); doc.rect(36,36,width-72,height-72)
    def text(value,x,y,size=11,font='Helvetica',color='#222222',center=False):
        value=str(value); doc.setFillColor(color)
        if center: x=(width-stringWidth(value,font,size))/2
        item=doc.beginText(x,height-y); item.setFont(font,size); item.textOut(value); doc.drawText(item)
    def center(value,y,size=11,bold=False,color='#666666'):
        font='Helvetica-Bold' if bold else 'Helvetica'; lines=['']
        for word in str(value).split(' '):
            candidate=(lines[-1]+' '+word).lstrip()
            if lines[-1] and stringWidth(candidate,font,size)>width-100: lines.append(word)
            else: lines[-1]=candidate
        for index,line_value in enumerate(lines): text(line_value,0,y+index*size*1.2,size,font,color,True)
        return (len(lines)-1)*size*1.2
    def fixed(value): return str(Decimal.from_float(float(value)).quantize(Decimal('0.1'),rounding=ROUND_HALF_UP))
    center(os.environ.get('CENTER_NAME',"O'quv Markazi"),112,24,True,accent)
    center('ESTIMATED MULTILEVEL RESULT' if data['specificationVersion'] else 'MOCK EXAM RESULT',139,13,color='#444444')
    center('This is to certify that',181)
    extra=center(data['studentName'],209,20,True,'#000000')
    title=data['examTitle']+(f" ({data['level']})" if data['level'] else '')+' — '+data['examType'].replace('_',' ',1).upper()
    extra+=center(title,237+extra,13,True,accent)
    y=282+extra
    for value,x in [('Section',150),('Score',320)]: text(value,x,y,11,'Helvetica-Bold','#000000')
    if data['isIelts']: text('Band',410,y,11,'Helvetica-Bold','#000000')
    elif data['specificationVersion']: text('Estimate /75',410,y,11,'Helvetica-Bold','#000000')
    def line(y): doc.setStrokeColor('#999999'); doc.line(150,height-y,470,height-y)
    line(y+12); y+=24
    for row in data['sections']:
        text(row['skill'].capitalize(),150,y)
        text(js_string(row['score'])+' / '+js_string(row['max']),320,y)
        if data['isIelts']: text(fixed(row['band']) if row['band'] is not None else '—',410,y)
        elif data['specificationVersion']: text(js_string(row['standardScore']) if row['standardScore'] is not None else 'Pending',410,y)
        y+=20
    line(y+8); y+=48
    if data['isIelts'] and data['overallBand'] is not None:
        center('Overall Band Score',y,12); center(fixed(data['overallBand']),y+48,40,True,accent)
    elif data['cefrLevel']:
        value='Estimated score: '+(js_string(data['overallScore']) if data['overallScore'] is not None else 'Pending')+' /75' if data['specificationVersion'] else 'CEFR Level'
        center(value,y,12); center(data['cefrLevel'],y+48,40,True,accent)
    text('Date: '+aware(data['finishedAt']).strftime('%Y-%m-%d'),60,height-110,10,color='#444444')
    text('Certificate ID: '+data['attemptId'],60,height-94,8,color='#888888')
    text('Bu — amaliy (mock) imtihon natijasi. Rasmiy IELTS/Multilevel sertifikati emas.',60,height-78,8,color='#888888')
    doc.showPage(); doc.save(); return output.getvalue()
