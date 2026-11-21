"""BESTWAY result cards: a clean PNG summary of a SAVED result, rendered with Pillow (no external service).

The renderer is a pure function of a small dict built from stored server-side results (class quiz attempt, vocabulary
run, assignment overview). It never grades, never accepts client numbers, and never converts a classroom result into an
IELTS band. Group summaries carry aggregates only - no student names or individual scores.
"""
from __future__ import annotations

import io
import math
from datetime import timezone as dt_timezone
from functools import lru_cache
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parent / 'assets'
TASHKENT = ZoneInfo('Asia/Tashkent')
W, H, S = 1080, 1350, 2           # logical size and supersampling factor

NAVY, INK, MUTED = '#14301F', '#1F2933', '#6B7785'
TRACK, TILE, BG_TOP, BG_BOTTOM = '#E7ECEF', '#F3F6F4', '#FFFFFF', '#F1F6F1'
STATUS_COLORS = {'excellent': '#2E9B3E', 'good': '#4C9F2F', 'fair': '#F2A01E', 'practice': '#E4572E'}

LABELS = {
    'uz': dict(card='Natija kartasi', correct="To'g'ri javoblar", time='Vaqt', score='Ball', accuracy='Aniqlik', to_review='Takrorlash uchun',
               verified='BESTWAY serveri tomonidan tasdiqlangan natija', student="O'quvchi", grammar='Grammatika testi', vocabulary="Lug'at mashqi",
               mixed='Aralash test', review='Takrorlash', correct_word="to'g'ri", group_card='Guruh xulosasi', submitted='Topshirganlar',
               average="O'rtacha", completion='Bajarilish', group_msg="Sinf umumiy ko'rinishi: bajarilish va o'rtacha", no_names='Shaxsiy natijalar ko\'rsatilmaydi', questions='Savollar'),
    'en': dict(card='Result card', correct='Correct answers', time='Time', score='Score', accuracy='Accuracy', to_review='To review',
               verified='Result verified by the BESTWAY server', student='Student', grammar='Grammar test', vocabulary='Vocabulary practice',
               mixed='Mixed test', review='Review', correct_word='correct', group_card='Group summary', submitted='Submitted',
               average='Average', completion='Completion', group_msg='Class overview: completion and average', no_names='Individual scores are not shown', questions='Questions'),
}
MESSAGES = {
    'uz': dict(excellent="Ajoyib natija! Shunday davom eting!", good="Yaxshi natija! Yana bir oz mashq qiling.",
               fair="Yomon emas. Xatolarni takrorlab chiqing.", practice="Takrorlash kerak. Xatolar ustida ishlang, siz uddalaysiz!"),
    'en': dict(excellent='Excellent work! Keep it up!', good='Good result! A little more practice.',
               fair='Not bad. Review your mistakes.', practice='Needs practice. Work through your mistakes - you can do it!'),
}


def status_key(percent: float) -> str:
    return 'excellent' if percent >= 90 else 'good' if percent >= 75 else 'fair' if percent >= 50 else 'practice'


@lru_cache(maxsize=16)
def _font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    names = (['DejaVuSans-Bold.ttf', 'LiberationSans-Bold.ttf', 'Inter-Bold.otf'] if bold else ['DejaVuSans.ttf', 'LiberationSans-Regular.ttf', 'Inter-Regular.otf'])
    for name in names:
        for folder in ('/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/truetype/liberation', '/usr/share/fonts/opentype/inter', '/usr/share/fonts'):
            path = Path(folder) / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    try:
        return ImageFont.truetype(names[0], size)
    except OSError:
        return ImageFont.load_default(size=size)      # Pillow's bundled scalable font: never fails


def fmt_time(seconds) -> str:
    seconds = max(0, int(seconds or 0))
    return f'{seconds // 60}:{seconds % 60:02d}'


def local_date(value) -> str:
    if value is None:
        return ''
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt_timezone.utc)
    return value.astimezone(TASHKENT).strftime('%d.%m.%Y %H:%M')


# --------------------------------------------------------------------------------------------- data builders (saved results only)

def quiz_card_data(result: dict, lang: str = 'uz', student_name: str | None = None) -> dict:
    """From class_quiz.result_payload of a SUBMITTED attempt."""
    if result.get('status') != 'submitted' or result.get('percent') is None:
        raise ValueError('a result card needs a submitted, saved result')
    labels = LABELS[lang]
    return dict(title=result['title'], subtitle=labels.get(result.get('category'), labels['grammar']), student=student_name,
                percent=float(result['percent']), date=local_date(result.get('submittedAt')),
                tiles=[(labels['correct'], f'{result["correct"]}/{result["total"]}'), (labels['time'], fmt_time(result.get('durationSeconds'))),
                       (labels['score'], f'{result["percent"]:g}%')])


def vocab_card_data(result: dict, lang: str = 'uz', student_name: str | None = None, finished_at=None) -> dict:
    """From BotVocabRun.result of a FINISHED run."""
    labels = LABELS[lang]
    if 'percent' not in result or 'correct' not in result:
        raise ValueError('a result card needs a finished, saved result')
    return dict(title=result.get('setTitle') or labels['review'], subtitle=labels['review'] if result.get('kind') == 'review' else labels['vocabulary'],
                student=student_name, percent=float(result['percent']), date=local_date(finished_at),
                tiles=[(labels['correct'], f'{result["correct"]}/{result["total"]}'), (labels['time'], fmt_time(result.get('durationSeconds'))),
                       (labels['to_review'], str(result.get('wrong', 0)))])


def group_summary_data(overview: dict, lang: str = 'uz', now=None) -> dict:
    """Aggregates of an assignment overview: no names, no individual scores."""
    labels = LABELS[lang]
    scores = [p['bestPercent'] for p in overview['participants'] if p['bestPercent'] is not None]
    average = round(sum(scores) / len(scores), 1) if scores else 0.0
    assignment = overview['assignment']
    return dict(title=assignment.get('title', ''), subtitle=labels['group_card'], student=None, percent=float(average), date=local_date(now),
                ring_percent=float(overview['completionPercent']), ring_caption=labels['completion'], footer=labels['no_names'], message=labels['group_msg'],
                tiles=[(labels['submitted'], f'{overview["submitted"]}/{overview["total"]}'), (labels['average'], f'{average:g}%'),
                       (labels['questions'], str(assignment.get('questionCount', '')))])


# --------------------------------------------------------------------------------------------- drawing

def _text_width(draw, text, font):
    return draw.textlength(text, font=font)


def _wrap(draw, text, font, max_width, max_lines):
    words, lines, current = str(text).split(), [], ''
    for word in words:
        trial = f'{current} {word}'.strip()
        if _text_width(draw, trial, font) <= max_width:
            current = trial
            continue
        if current:
            lines.append(current)
        current = word
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and _text_width(draw, lines[-1] + '…', font) > max_width:
            lines[-1] = lines[-1][:-1]
        lines[-1] = lines[-1].rstrip() + '…'
    return lines or ['']


def _center(draw, y, text, font, fill, width=W):
    draw.text(((width - _text_width(draw, text, font)) / 2, y), text, font=font, fill=fill)


def _ring(draw, cx, cy, radius, thickness, percent, color):
    box = [cx - radius, cy - radius, cx + radius, cy + radius]
    draw.ellipse(box, outline=TRACK, width=thickness)
    sweep = max(0.0, min(100.0, percent)) * 3.6
    if sweep <= 0:
        return
    if sweep >= 359.9:
        draw.ellipse(box, outline=color, width=thickness)
        return
    draw.arc(box, start=-90, end=-90 + sweep, fill=color, width=thickness)
    cap = thickness / 2
    for angle in (-90, -90 + sweep):                       # rounded ends
        x = cx + (radius - cap) * math.cos(math.radians(angle))
        y = cy + (radius - cap) * math.sin(math.radians(angle))
        draw.ellipse([x - cap, y - cap, x + cap, y + cap], fill=color)


def render_png(data: dict, lang: str = 'uz') -> bytes:
    labels, messages = LABELS[lang], MESSAGES[lang]
    percent = max(0.0, min(100.0, float(data['percent'])))
    key = status_key(percent)
    color = STATUS_COLORS[key]
    canvas = Image.new('RGB', (W * S, H * S), BG_TOP)
    d = ImageDraw.Draw(canvas)
    for y in range(H * S):                                   # soft vertical gradient
        t = y / (H * S)
        d.line([(0, y), (W * S, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip((255, 255, 255), (241, 246, 241))))
    sc = lambda v: int(v * S)
    f = lambda size, bold=False: _font(sc(size), bold)

    # header: logo + card caption
    logo = Image.open(ASSETS / 'bestway-logo.png').convert('RGBA')
    logo = logo.resize((sc(250), round(logo.height * sc(250) / logo.width)), Image.LANCZOS)
    canvas.paste(logo, (sc(60), sc(48)), logo)
    d.text((sc(W - 60) - _text_width(d, labels['card'], f(30, True)), sc(88)), labels['card'], font=f(30, True), fill=MUTED)
    d.rounded_rectangle([sc(60), sc(150), sc(W - 60), sc(156)], radius=sc(3), fill=color)

    # title block
    y = 190
    for line in _wrap(d, data['title'], f(54, True), sc(W - 140), 2):
        _center(d, sc(y), line, f(54, True), INK, W * S)
        y += 68
    _center(d, sc(y + 4), data.get('subtitle', ''), f(30), MUTED, W * S)
    y += 52
    if data.get('student'):
        _center(d, sc(y + 6), f'{labels["student"]}: {data["student"]}', f(34, True), NAVY, W * S)
        y += 54

    # circular progress
    ring_value = float(data.get('ring_percent', percent))
    cy = max(590, y + 232)
    _ring(d, sc(W / 2), sc(cy), sc(200), sc(44), ring_value, color)
    big = f'{ring_value:g}%'
    _center(d, sc(cy - 56), big, f(100 if len(big) <= 4 else 80, True), INK, W * S)
    _center(d, sc(cy + 48), data.get('ring_caption') or labels['correct_word'], f(32), MUTED, W * S)

    # stat tiles
    tiles = data['tiles']
    tile_w, gap = 296, 26
    left = (W - (len(tiles) * tile_w + (len(tiles) - 1) * gap)) / 2
    top = cy + 238
    for i, (label, value) in enumerate(tiles):
        x0 = left + i * (tile_w + gap)
        d.rounded_rectangle([sc(x0), sc(top), sc(x0 + tile_w), sc(top + 150)], radius=sc(26), fill=TILE)
        vf = f(48, True)
        d.text((sc(x0 + tile_w / 2) - _text_width(d, value, vf) / 2, sc(top + 24)), value, font=vf, fill=INK)
        lf = f(24)
        d.text((sc(x0 + tile_w / 2) - _text_width(d, label, lf) / 2, sc(top + 98)), label, font=lf, fill=MUTED)

    # performance message pill
    message = data.get('message') or messages[key]
    mf = f(32, True)
    lines = _wrap(d, message, mf, sc(W - 200), 2)
    pill_h = 40 + 44 * len(lines)
    py = top + 176
    d.rounded_rectangle([sc(80), sc(py), sc(W - 80), sc(py + pill_h)], radius=sc(34), fill=color)
    for i, line in enumerate(lines):
        _center(d, sc(py + 22 + i * 44), line, mf, '#FFFFFF', W * S)

    # footer
    foot = data.get('footer') or labels['verified']
    _center(d, sc(H - 112), foot, f(24), MUTED, W * S)
    if data.get('date'):
        _center(d, sc(H - 74), data['date'], f(26, True), NAVY, W * S)
    out = canvas.resize((W, H), Image.LANCZOS)
    buffer = io.BytesIO()
    out.save(buffer, 'PNG', optimize=True)
    return buffer.getvalue()
