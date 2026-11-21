"""Original BESTWAY Writing Task 1 maps: Riverside Park, 2005 and 2025.

Both maps are drawn from one shared coordinate model, so everything that did not change
(boundary, entrance, pond, north arrow, scale) is identical by construction and every change
is an explicit, checkable difference. North is up. Colours pair with direct labels and
patterns, so the maps stay readable without colour.
"""
from __future__ import annotations

W, H = 600, 470  # viewBox of one map
PARK = (30, 55, 570, 425)  # x0, y0, x1, y1 (boundary)
ENTRANCE = (80, 425)  # south-west, on the south boundary
POND = dict(cx=480, cy=118, rx=70, ry=42)

# Features that exist in 2005 (and, where noted, change by 2025)
PICNIC = (60, 80, 180, 155)  # north-west
LAWN_2005 = (190, 210, 390, 310)  # central lawn, centre (290, 260)
LAWN_2025 = (245, 230, 335, 290)  # smaller, same centre
PLAYGROUND_2005 = (420, 315, 540, 395)  # south-east
PLAYGROUND_2025 = (395, 290, 550, 400)  # expanded, contains the 2005 footprint
MAIN_PATH = [(80, 425), (80, 175), (410, 175), (410, 118)]  # entrance -> west edge -> north of lawn -> pond
RING = dict(cx=290, cy=260, r=85)  # 2025 circular path, tangent to the main path at (290, 175)
BIKE = (170, 398, 390, 418)  # 2025 bicycle parking along the south boundary
BOARDWALK = 'M 412 172 Q 480 192 548 166'  # beside the south shore of the pond

COLORS = dict(grass='#e6f2dc', lawn='#b5da9f', pond='#a9d3ee', path='#a47551', play='#f6d98c', cafe='#e8a68a',
              bike='#b8c1d1', picnic='#f2e2b8', ink='#1f2937', wood='#7a5230')

FONT = "font-family=\"Inter, 'Segoe UI', Arial, sans-serif\""


def _label(x, y, text, size=14, weight='600', anchor='middle'):
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" {FONT} '
            f'fill="{COLORS["ink"]}" stroke="#ffffff" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">{text}</text>')


def _rect(box, fill, stroke=None, rx=6, extra=''):
    x0, y0, x1, y1 = box
    stroke_attr = f' stroke="{stroke}" stroke-width="2"' if stroke else ''
    return f'<rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" rx="{rx}" fill="{fill}"{stroke_attr} {extra}/>'


def _poly(points, width=7, color=None, dash=None):
    d = ' '.join(f'{x},{y}' for x, y in points)
    dash_attr = f' stroke-dasharray="{dash}"' if dash else ''
    return (f'<polyline points="{d}" fill="none" stroke="{color or COLORS["path"]}" stroke-width="{width}" '
            f'stroke-linecap="round" stroke-linejoin="round"{dash_attr}/>')


def _common(year: int) -> list[str]:
    x0, y0, x1, y1 = PARK
    ex, ey = ENTRANCE
    out = [
        f'<rect x="0" y="0" width="{W}" height="{H}" fill="#ffffff"/>',
        _label(300, 30, f'Riverside Park, {year}', 20, '700'),
        _rect(PARK, COLORS['grass'], '#374151', 4),
        # entrance gap in the boundary
        f'<rect x="{ex - 16}" y="{ey - 3}" width="32" height="6" fill="#ffffff"/>',
        f'<path d="M {ex - 12} {ey + 12} L {ex} {ey + 2} L {ex + 12} {ey + 12}" fill="none" stroke="{COLORS["ink"]}" '
        f'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
        _label(ex, ey + 30, 'Entrance', 14, '700'),
        # pond (unchanged)
        f'<ellipse cx="{POND["cx"]}" cy="{POND["cy"]}" rx="{POND["rx"]}" ry="{POND["ry"]}" fill="{COLORS["pond"]}" stroke="#4b8fb8" stroke-width="2"/>',
        _label(POND['cx'], POND['cy'] + 5, 'Pond', 14),
        # north arrow (outside the park, top-right) + scale bar (bottom-right)
        f'<g transform="translate(548 44)"><path d="M0 -16 L7 8 L0 3 L-7 8 Z" fill="{COLORS["ink"]}"/>'
        f'<text x="14" y="4" font-size="14" font-weight="700" {FONT} fill="{COLORS["ink"]}">N</text></g>',
        f'<g transform="translate(470 452)"><rect x="0" y="-5" width="60" height="6" fill="{COLORS["ink"]}"/>'
        f'<text x="68" y="2" font-size="12" {FONT} fill="{COLORS["ink"]}">50 m</text></g>',
    ]
    return out


def _tables(box):
    x0, y0, x1, y1 = box
    return ''.join(f'<rect x="{x0 + 18 + i * 34}" y="{y0 + 14}" width="18" height="12" rx="2" fill="#a47551"/>'
                   f'<rect x="{x0 + 18 + i * 34}" y="{y0 + 38}" width="18" height="12" rx="2" fill="#a47551"/>' for i in range(3))


def _swings(box):
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2
    return (f'<path d="M {cx - 30} {y1 - 14} L {cx - 22} {y0 + 24} L {cx + 22} {y0 + 24} L {cx + 30} {y1 - 14}" fill="none" '
            f'stroke="#6b5b2a" stroke-width="3" stroke-linecap="round"/>'
            f'<line x1="{cx - 12}" y1="{y0 + 24}" x2="{cx - 12}" y2="{y0 + 44}" stroke="#6b5b2a" stroke-width="2"/>'
            f'<line x1="{cx + 12}" y1="{y0 + 24}" x2="{cx + 12}" y2="{y0 + 44}" stroke="#6b5b2a" stroke-width="2"/>')


def svg_2005() -> str:
    body = _common(2005)
    body += [
        _poly(MAIN_PATH),
        _rect(PICNIC, COLORS['picnic'], '#b79b4b'), _tables(PICNIC), _label(120, PICNIC[3] - 7, 'Picnic area', 14),
        _rect(LAWN_2005, COLORS['lawn'], '#6aa84f', 10), _label(290, 265, 'Central lawn', 15),
        _rect(PLAYGROUND_2005, COLORS['play'], '#c79b2c'), _swings(PLAYGROUND_2005),
        _label(480, PLAYGROUND_2005[3] + 18, 'Playground', 14),
        _label(245, 196, 'Main walking path', 13),
    ]
    return _wrap(body, 2005, 'Plan of Riverside Park in 2005: entrance in the south-west, picnic area in the north-west, '
                 'central lawn, pond in the north-east, playground in the south-east and one main walking path.')


def svg_2025() -> str:
    body = _common(2025)
    ring = RING
    body += [
        _poly(MAIN_PATH),
        f'<circle cx="{ring["cx"]}" cy="{ring["cy"]}" r="{ring["r"]}" fill="none" stroke="{COLORS["path"]}" stroke-width="7"/>',
        _rect(PICNIC, COLORS['cafe'], '#b5654a'),
        f'<path d="M {PICNIC[0] + 22} {PICNIC[1] + 38} L {(PICNIC[0] + PICNIC[2]) / 2} {PICNIC[1] + 14} L {PICNIC[2] - 22} {PICNIC[1] + 38} Z" fill="#b5654a"/>'
        f'<rect x="{PICNIC[0] + 30}" y="{PICNIC[1] + 38}" width="{PICNIC[2] - PICNIC[0] - 60}" height="14" fill="#fbe9e1" stroke="#b5654a" stroke-width="2"/>',
        _label(120, PICNIC[3] - 7, 'Café', 15, '700'),
        _rect(LAWN_2025, COLORS['lawn'], '#6aa84f', 10), _label(290, 265, 'Lawn', 14),
        _rect(PLAYGROUND_2025, COLORS['play'], '#c79b2c'), _swings(PLAYGROUND_2025),
        _label(472, PLAYGROUND_2025[3] + 18, 'Playground (larger)', 14),
        f'<path d="{BOARDWALK}" fill="none" stroke="{COLORS["wood"]}" stroke-width="9" stroke-linecap="round"/>'
        f'<path d="{BOARDWALK}" fill="none" stroke="#e9d4b0" stroke-width="3" stroke-dasharray="3 5"/>',
        _label(500, 205, 'Boardwalk', 13),
        _rect(BIKE, COLORS['bike'], '#6b7a90', 3),
        ''.join(f'<line x1="{x}" y1="{BIKE[1] + 3}" x2="{x}" y2="{BIKE[3] - 3}" stroke="#4b5563" stroke-width="3"/>'
                for x in range(BIKE[0] + 12, BIKE[2] - 6, 14)),
        _label(280, BIKE[1] - 6, 'Bicycle parking', 13),
        _label(150, 196, 'Walking path', 13),
        _label(290, 360, 'Circular path', 13),
    ]
    return _wrap(body, 2025, 'Plan of Riverside Park in 2025: same entrance and pond; café instead of the picnic area, a smaller '
                 'lawn inside a circular walking path, a boardwalk beside the pond, a larger playground and bicycle parking along the south.')


def _wrap(body: list[str], year: int, description: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" '
            f'aria-labelledby="t{year} d{year}"><title id="t{year}">Riverside Park, {year}</title>'
            f'<desc id="d{year}">{description}</desc>' + ''.join(body) + '</svg>')


def combined_svg() -> str:
    """Both maps side by side, 2005 left and 2025 right, as one figure for the Writing task image."""
    def inner(svg: str, dx: int) -> str:
        start = svg.index('>', svg.index('<svg')) + 1
        return f'<g transform="translate({dx} 0)">{svg[start:svg.rindex("</svg>")]}</g>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {2 * W + 20} {H}" width="{2 * W + 20}" height="{H}" role="img" '
            f'aria-label="Two maps of Riverside Park: 2005 on the left and 2025 on the right">'
            f'<rect width="{2 * W + 20}" height="{H}" fill="#ffffff"/>' + inner(svg_2005(), 0) + inner(svg_2025(), W + 20)
            + f'<line x1="{W + 10}" y1="20" x2="{W + 10}" y2="{H - 20}" stroke="#9ca3af" stroke-width="2" stroke-dasharray="6 6"/></svg>')


def consistency_report() -> dict:
    """Checkable facts the tests assert: unchanged features are identical, changed ones are as specified."""
    x0, y0, x1, y1 = PARK
    inside = lambda box: box[0] >= x0 and box[1] >= y0 and box[2] <= x1 and box[3] <= y1
    contains = lambda outer, inner: outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]
    area = lambda b: (b[2] - b[0]) * (b[3] - b[1])
    ring_box = (RING['cx'] - RING['r'], RING['cy'] - RING['r'], RING['cx'] + RING['r'], RING['cy'] + RING['r'])
    overlap = lambda a, b: not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])
    pond_box = (POND['cx'] - POND['rx'], POND['cy'] - POND['ry'], POND['cx'] + POND['rx'], POND['cy'] + POND['ry'])
    return dict(
        entranceSouthWest=ENTRANCE[0] < (x0 + x1) / 2 and ENTRANCE[1] == y1,
        picnicNorthWest=PICNIC[0] < (x0 + x1) / 2 and PICNIC[1] < (y0 + y1) / 2,
        pondNorthEast=POND['cx'] > (x0 + x1) / 2 and POND['cy'] < (y0 + y1) / 2,
        playgroundSouthEast=PLAYGROUND_2005[0] > (x0 + x1) / 2 and PLAYGROUND_2005[1] > (y0 + y1) / 2,
        allInsidePark=all(inside(b) for b in (PICNIC, LAWN_2005, LAWN_2025, PLAYGROUND_2005, PLAYGROUND_2025, BIKE, ring_box)),
        lawnSmaller=area(LAWN_2025) < area(LAWN_2005) and contains(LAWN_2005, LAWN_2025),
        playgroundExpanded=area(PLAYGROUND_2025) > area(PLAYGROUND_2005) and contains(PLAYGROUND_2025, PLAYGROUND_2005),
        ringAroundLawn=contains(ring_box, LAWN_2025) and (RING['cy'] - RING['r']) == MAIN_PATH[1][1],
        ringClearOfPlayground=not overlap(ring_box, PLAYGROUND_2025),
        ringClearOfCafe=not overlap(ring_box, PICNIC),
        bikeAlongSouth=BIKE[3] > y1 - 15 and not overlap(BIKE, PLAYGROUND_2025) and not overlap(BIKE, ring_box),
        boardwalkClearOfPond=BOARDWALK is not None and pond_box[3] < 172,
        pathReachesPond=MAIN_PATH[-1][0] == int(pond_box[0]) or MAIN_PATH[-1][0] == POND['cx'] - POND['rx'],
    )
