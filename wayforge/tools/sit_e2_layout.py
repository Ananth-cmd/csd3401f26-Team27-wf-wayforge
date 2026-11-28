#!/usr/bin/env python3
"""
\\file sit_e2_layout.py
\\brief Lay out block E2 from SIT's own room list and draw its floor plans

Usage:
    python tools/sit_e2_layout.py

Reads data/plans/sit-punggol/sit/E2.json (SIT's room names, codes and levels from the
SIT Campus Wayfinder, with each room's position along and across the block) and writes
    data/plans/sit-punggol/E2/E2 - Level NN.png   one drawing per floor, read by wf_cli
    the E2 block of data/plans/sit-punggol/site.json (rooms with SIT codes and names)
for build_sit_punggol.py to turn into the campus .wfb.

The footprint stays the one in site.json (153 x 35 m, from OpenStreetMap). Inside it each floor
has the plan SIT's map shows for E2: a row of rooms along the north face, a corridor, two rows
of rooms in the middle, a second corridor and a narrow row along the south face, with the west
end (u < -15 m) as one or two large rooms. Lift Lobby 13 and Lift Lobby 15 / Service Lobby 16
cross the middle rows; the stairs and toilets stand where SIT's map has them, the same on every
floor. Each room takes the stretch of its row between its neighbours (halfway to the next room,
at most ROOM_MAX long); what is left of a row is open floor joined to the corridor.
SIT's mezzanines are folded into the floor below them (1M into Level 1, 2M into Level 2); the
model's floors are 4.5 m apart for the whole campus. Level 10 is the roof floor (one lab).

Exit codes:
    0  drawings and site.json written
    2  missing input

\\author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
AI declaration: Claude was used as a support tool for writing this script and its comments.
\\date 2026-11-28
"""
import json
import math
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DIR = os.path.join(ROOT, 'data', 'plans', 'sit-punggol')

LEN, DEP = 153.0, 35.0          # footprint, metres (x east along the block, d from the north face)
UMIN, UMAX = -33.0, 110.0       # extent of E2 along its axis in SIT's map (u, metres from Lift Lobby 13)
ROOM_MAX = 60.0                 # a room takes its whole stretch of the row (up to this), so the row has no leftover spaces
ROOM_MIN = 3.6                  # shortest, metres (smaller rooms are spread along the row)
GAP_MIN = 3.0                   # a leftover stretch of a row shorter than this joins the room beside it
MPP = 0.043333                  # metres per pixel of the drawings (as before)
ORIGIN = (9.0, 21.0)            # where the footprint starts on the sheet, metres from the bottom left
IMG = (3900, 1453)              # drawing size, pixels

# Rows across the block, metres from the north face: (name, d0, d1)
# corridors 2.4 m wide: wf_cli takes a region for a corridor (walking paths along it) only under 2.6 m
N, C1, M1, M2, C2, S = (0, 11), (11, 13.4), (13.4, 21.5), (21.5, 28), (28, 30.4), (30.4, 35)
X_WEST = 19.3                   # the west end (u < -15) ends here; the corridors start here


def X(u):
    """SIT position along the block -> metres from the west face of the footprint."""
    return (u - UMIN) * LEN / (UMAX - UMIN)


# Cores, the same on every floor: (kind, name, x0, x1, row, door side)
CORES = [
    ('stair', 'Stair', 19.6, 23.4, N, 'S'), ('toilet', 'Male Toilet', 24.0, 30.0, N, 'S'),
    ('toilet', 'Wheelchair Toilet', 30.0, 34.0, N, 'S'), ('stair', 'Stair', 46.0, 49.6, N, 'S'),
    ('stair', 'Stair', 106.0, 109.6, N, 'S'), ('toilet', 'Wheelchair Toilet', 116.0, 120.0, N, 'S'),
    ('toilet', 'Female Toilet', 120.0, 126.0, N, 'S'),
    ('stair', 'Stair', 26.5, 30.3, S, 'N'), ('stair', 'Stair', 126.5, 130.3, S, 'N'),
]
LOBBY13 = (31.25, 40.25)        # Lift Lobby 13 across both middle rows, 2 lifts (at 31.0 wf_cli misses one lift cross)
LOBBY15 = (116.5, 125.5)        # Lift Lobby 15, 2 lifts
LOBBY16 = (125.5, 131.0)        # Service Lobby 16, 1 lift


def kind_of(name):
    n = name.lower()
    if 'toilet' in n: return 'toilet'
    if n.startswith('stair'): return 'stair'
    if 'lobby' in n: return 'lobby'
    if 'study space' in n: return 'classroom'
    if 'office' in n: return 'office'
    if 'server' in n: return 'storage'
    if re.match(r'(sr|dr|mr)\d', n) or 'lectorial' in n or 'hub' in n or 'steps' in n: return 'classroom'
    if 'retail' in n or 'multi-faith' in n: return 'unknown'
    return 'lab'


def big(name):
    """Rooms that take both middle rows (lecture rooms, hubs, The Steps)."""
    return re.search(r'Lectorial|Hub|The Steps|Annex', name) is not None


def lay_out(rooms):
    """Rectangles (x0, d0, x1, d1) for one floor's rooms; returns rooms and open stretches."""
    placed, rows = [], {'N': [], 'M1': [], 'M2': [], 'S': [], 'MM': [], 'W': []}
    for r in rooms:
        if r['kind'] in ('stair', 'toilet', 'lobby'): continue           # cores are fixed
        x, v = X(r['u']), r['v']
        if x < X_WEST: rows['W'].append(r)
        elif big(r['name']): rows['MM'].append(r)
        elif v < -8: rows['N'].append(r)
        elif v < 0.5: rows['M1'].append(r)
        elif v < 7.8: rows['M2'].append(r)
        else: rows['S'].append(r)

    # occupied stretches per row: cores and lobbies
    busy = {'N': [(c[2], c[3]) for c in CORES if c[4] == N], 'S': [(c[2], c[3]) for c in CORES if c[4] == S],
            'M1': [LOBBY13, (LOBBY15[0], LOBBY16[1])], 'M2': [LOBBY13, (LOBBY15[0], LOBBY16[1])],
            'MM': [LOBBY13, (LOBBY15[0], LOBBY16[1])]}

    def fill(row, items, d0, d1, lo=X_WEST, hi=LEN, extra=(), gaps=True):
        taken = sorted(busy.get(row, []) + list(extra))
        free, at = [], lo                                                    # free stretches of the row
        for a, b in taken:
            if a > at: free.append((at, a))
            at = max(at, b)
        if at < hi: free.append((at, hi))
        # Each room's position along the row, moved into a free stretch when its marker is in a core,
        # then spread so no two rooms are closer than ROOM_MIN (two markers can sit almost on top of each other)
        def into(x):
            return min(((min(max(x, a + 1), b - 1), a, b) for a, b in free), key=lambda t: abs(t[0] - x))
        groups = {}
        for r in items:
            x, a, b = into(X(r['u']))
            groups.setdefault((a, b), []).append([x, r])
        out = []
        for (a, b), g in groups.items():
            g.sort(key=lambda t: t[0])
            n = len(g)
            w = min(ROOM_MIN, (b - a) / n)
            for _ in range(50):                                              # push apart, keep inside the stretch
                for i in range(1, n):
                    if g[i][0] - g[i - 1][0] < w:
                        m = (g[i][0] + g[i - 1][0]) / 2
                        g[i - 1][0], g[i][0] = m - w / 2, m + w / 2
                for t in g: t[0] = min(max(t[0], a + w / 2), b - w / 2)
            for i, (x, r) in enumerate(g):
                x0 = a if i == 0 else (g[i - 1][0] + x) / 2
                x1 = b if i == n - 1 else (x + g[i + 1][0]) / 2
                x0, x1 = max(x0, x - ROOM_MAX / 2), min(x1, x + ROOM_MAX / 2)
                out.append((r, (round(x0, 2), d0, round(x1, 2), d1)))
        # What no room covers: a stretch under GAP_MIN is taken by the room beside it; a longer one becomes an
        # unnamed space of its own (with a door, like a room). Left open it would join the corridor into one
        # region over wf_cli's 800 m2 room limit, which it then drops; a sliver of a room with a door in it
        # leaves too little wall for wf_cli to see the door.
        for a, b in (free if gaps else []):
            mine = sorted([o for o in out if a - 0.01 <= o[1][0] and o[1][2] <= b + 0.01], key=lambda o: o[1][0])
            at, prev = a, None
            for o in mine + [None]:
                c0 = o[1][0] if o else b
                gap = c0 - at
                if gap > 0.01:
                    if gap < GAP_MIN and (prev or o):
                        k = out.index(prev) if prev else out.index(o)
                        r, (x0, y0, x1, y1) = out[k]
                        out[k] = (r, (min(x0, round(at, 2)), y0, max(x1, round(c0, 2)), y1))
                        if prev: prev = out[k]
                        else: o = out[k]
                    elif gap >= GAP_MIN:
                        out.append((dict(name='', code='', kind='corridor', u=0, v=0), (round(at, 2), d0, round(c0, 2), d1)))
                if o:
                    at, prev = max(at, o[1][2]), o
        return out

    mm = fill('MM', rows['MM'], M1[0], M2[1], gaps=False)
    span = [(b[0], b[2]) for _, b in mm]
    placed += mm
    placed += fill('N', rows['N'], *N)
    placed += fill('M1', rows['M1'], *M1, extra=span)
    placed += fill('M2', rows['M2'], *M2, extra=span)
    placed += fill('S', rows['S'], *S)
    # west end: one big room, or a north and a south row on either side of the corridor
    w = rows['W']
    if len(w) == 1: placed.append((w[0], (0.0, 0.0, X_WEST, DEP)))
    elif w:
        north = [r for r in w if r['v'] < -6]; south = [r for r in w if r['v'] >= -6]
        placed += fill('WN', north, *N, lo=0.0, hi=X_WEST)
        placed += fill('WS', south, C1[1], DEP, lo=0.0, hi=X_WEST)
    return placed, len(w) > 1


def floor_plan(level, rooms, sit_level):
    """All rectangles of one floor: (kind, name, code, rect, doors). rect = (x0, d0, x1, d1);
    doors = list of (side, at, width) with side N/S/E/W of the rectangle."""
    placed, west_split = lay_out(rooms)
    out = []
    for r, (x0, d0, x1, d1) in placed:
        doors = []
        if d0 == N[0] and d1 == N[1]: doors.append(('S', None, 1.0))       # north row -> corridor 1
        elif d0 == M1[0] and d1 == M1[1]: doors.append(('N', None, 1.0))
        elif d0 == M2[0] and d1 == M2[1]: doors.append(('S', None, 1.0))
        elif d0 == S[0]: doors.append(('N', None, 1.0))
        elif d0 == M1[0] and d1 == M2[1]: doors += [('N', None, 1.0), ('S', None, 1.0)]
        elif d0 == C1[1] and d1 == DEP: doors.append(('N', None, 1.0))      # west end south row
        elif d0 == 0.0 and d1 == DEP: doors.append(('E', C2[0] + 1.2, 1.0))   # one door, onto corridor 2 (the end of corridor 1 is crowded with doors)
        out.append((r['kind'], r['name'], r['code'], (x0, d0, x1, d1), doors))
    for kind, name, x0, x1, row, side in CORES:
        out.append((kind, name, '', (x0, row[0], x1, row[1]), [(side, None, 1.0)]))
    lob = {r['name']: r for r in rooms if r['kind'] == 'lobby'}
    name13 = next((n for n in lob if 'Lobby 13' in n), f'E2 L{sit_level} Lift Lobby 13')
    name15 = next((n for n in lob if 'Lobby 15' in n), f'E2/E3 L{sit_level} Lift Lobby 15')
    name16 = next((n for n in lob if 'Lobby 16' in n), f'E2/E3 L{sit_level} Service Lobby 16')
    out.append(('lobby', name13, '', (LOBBY13[0], M1[0] + 2.8, LOBBY13[1], M2[1]), [('N', (LOBBY13[0] + 6.6 + LOBBY13[1]) / 2, 1.0), ('S', None, 1.0)]))
    out.append(('lobby', name15, '', (LOBBY15[0], M1[0] + 2.8, LOBBY15[1], M2[1]), [('N', (LOBBY15[0] + 6.6 + LOBBY15[1]) / 2, 1.0), ('S', None, 1.0)]))
    out.append(('lobby', name16, '', (LOBBY16[0], M1[0] + 2.8, LOBBY16[1], M2[1]), [('S', None, 1.0)]))
    for x0, n in ((LOBBY13[0] + 0.6, 2), (LOBBY15[0] + 0.6, 2), (LOBBY16[0] + 0.6, 1)):
        for k in range(n):
            out.append(('lift', '', '', (x0 + k * 3.2, M1[0], x0 + k * 3.2 + 2.8, M1[0] + 2.8), [('S', None, 1.0)]))
    return out, west_split


# ---------------------------------------------------------------- drawing
def px(x, d):
    """Footprint metres -> drawing pixels (y down)."""
    return ((ORIGIN[0] + x) / MPP, IMG[1] - (ORIGIN[1] + DEP - d) / MPP)


def draw_floor(path, title, plan, west_split, ground=False):
    im = Image.new('RGB', IMG, 'white')
    g = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('DejaVuSans-Bold.ttf', 15); small = ImageFont.truetype('DejaVuSans.ttf', 11)
        big_font = ImageFont.truetype('DejaVuSans-Bold.ttf', 26)
    except OSError:
        font = small = big_font = ImageFont.load_default()
    T_IN, T_OUT = 5, 8                                                       # wall thickness, px (as the other sheets)

    def fitted(text, width):
        for size in range(15, 6, -1):
            f = ImageFont.truetype('DejaVuSans-Bold.ttf', size)
            if f.getlength(text) <= width: return f
        return f

    def line(a, b, w):
        g.line([px(*a), px(*b)], fill='black', width=w)

    # rooms: outline of each enclosed room (corridors and open floor are what is left)
    gaps = []
    for kind, name, code, (x0, d0, x1, d1), doors in plan:
        for a, b in (((x0, d0), (x1, d0)), ((x1, d0), (x1, d1)), ((x1, d1), (x0, d1)), ((x0, d1), (x0, d0))):
            line(a, b, T_IN)
        for side, at, wd in doors:
            if side in 'NS':
                wd = min(wd, (x1 - x0) - 1.0)
                c = at if at is not None else (x0 + min(1.2 + wd / 2, (x1 - x0) / 2))
                d = d0 if side == 'N' else d1
                gaps.append(((c - wd / 2, d), (c + wd / 2, d), 'h', 1 if side == 'S' else -1))
            else:
                x = x1 if side == 'E' else x0
                gaps.append(((x, at - wd / 2), (x, at + wd / 2), 'v', 1 if side == 'E' else -1))
    # outside walls (with windows on the long faces) and the corridors' west ends
    for a, b in (((0, 0), (LEN, 0)), ((LEN, 0), (LEN, DEP)), ((LEN, DEP), (0, DEP)), ((0, DEP), (0, 0))):
        line(a, b, T_OUT)
    for d in (0.0, DEP):
        for k in range(int(LEN // 4.5)):                                   # 2 m windows (wf_cli bridges gaps up to about that)
            x0, x1 = 1.5 + k * 4.5, 3.5 + k * 4.5
            if any(c[2] - 0.3 < x0 < c[3] + 0.3 or c[2] - 0.3 < x1 < c[3] + 0.3 for c in CORES if (c[4] == N) == (d == 0.0)): continue
            p0, p1 = px(x0, d), px(x1, d)
            top = round(p0[1] - T_OUT / 2)
            g.rectangle([p0[0], top, p1[0], top + T_OUT - 1], fill='white')
            for off in (1, 4, 6):                                               # frame, glass, frame: a window
                g.line([(p0[0], top + off), (p1[0], top + off)], fill='black', width=1)
    # Level 1 entrances: doors in the outside wall at both corridor ends (east face) and on the south face
    # below each lift lobby (exits are only looked for on the ground floor)
    if ground:
        for d in (C1[0] + 1.5, C2[0] + 1.25):
            gaps.append(((LEN, d - 0.5), (LEN, d + 0.5), 'v', 1))
        for x in (LOBBY13[0] + 4.5, LOBBY15[0] + 4.5):
            gaps.append(((x - 0.5, DEP), (x + 0.5, DEP), 'h', 1))

    # doors: cut the gap, draw the leaf swing. Wider than 1.3 m: a double door, a leaf from each jamb
    # (wf_cli does not take one 1.8 m leaf for a door, and the rooms on both sides then run together).
    def leaf(hinge, r, a0, a1):
        g.arc([hinge[0] - r, hinge[1] - r, hinge[0] + r, hinge[1] + r], a0, a1, fill='black', width=2)

    for a, b, o, s in gaps:
        p0, p1 = px(*a), px(*b)
        double = math.dist(a, b) > 1.3                                   # (all doorways are 1.0 m now; kept for wider ones)
        if o == 'h':
            g.rectangle([p0[0], p0[1] - T_IN, p1[0], p1[1] + T_IN], fill='white')
            r = (p1[0] - p0[0]) / (2 if double else 1)
            leaf(p0, r, 270 if s < 0 else 0, 360 if s < 0 else 90)            # left jamb; s < 0: swings up
            if double: leaf(p1, r, 180 if s < 0 else 90, 270 if s < 0 else 180)
        else:
            g.rectangle([p0[0] - T_IN, p0[1], p1[0] + T_IN, p1[1]], fill='white')
            r = (p1[1] - p0[1]) / (2 if double else 1)
            leaf(p0, r, 90 if s < 0 else 0, 180 if s < 0 else 90)             # top jamb; s < 0: swings west
            if double: leaf(p1, r, 180 if s < 0 else 270, 270 if s < 0 else 360)
    # symbols: stair treads, lift crosses; labels
    for kind, name, code, (x0, d0, x1, d1), doors in plan:
        a, b = px(x0, d0), px(x1, d1)
        if kind == 'stair':
            # treads 0.28 m apart, clear of the walls (a rail or a tread touching a wall would split the room)
            far = a[1] + 0.4 / MPP if any(dr[0] == 'S' for dr in doors) else a[1] + 1.4 / MPP
            near = b[1] - 1.4 / MPP if any(dr[0] == 'S' for dr in doors) else b[1] - 0.4 / MPP
            yy = far
            while yy < near:
                g.line([(a[0] + 0.35 / MPP, yy), (b[0] - 0.35 / MPP, yy)], fill='black', width=2)
                yy += 0.28 / MPP
        elif kind == 'lift':
            i = 5                                                               # shaft X, inside the walls
            g.line([(a[0] + i, a[1] + i), (b[0] - i, b[1] - i)], fill='black', width=4)
            g.line([(a[0] + i, b[1] - i), (b[0] - i, a[1] + i)], fill='black', width=4)
        if name and kind != 'stair':                                         # text over the treads splits the stairwell
            label = name.upper()
            cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            f = fitted(label, abs(b[0] - a[0]) - 12)
            g.text((cx, cy - 8), label, fill='black', font=f, anchor='mm')
            if code: g.text((cx, cy + 9), code, fill='black', font=small, anchor='mm')
    # sheet frame and title block, as on the other blocks' sheets: wf_cli strips the outermost frame as an
    # annotation, and without one it takes the building's own outline for the frame
    g.rectangle([28, 28, IMG[0] - 28, IMG[1] - 28], outline='black', width=3)
    g.line([(28, IMG[1] - 230), (IMG[0] - 28, IMG[1] - 230)], fill='black', width=3)
    for x in (560, 1800, 2500, 3000, 3450):
        g.line([(x, IMG[1] - 230), (x, IMG[1] - 28)], fill='black', width=2)
    g.text((600, IMG[1] - 200), 'SIT PUNGGOL CAMPUS - REPLICA', fill='black', font=font)
    g.text((600, IMG[1] - 170), 'BLOCK E2 - ACADEMIC BUILDING (CAMPUS COURT)', fill='black', font=small)
    g.text((1840, IMG[1] - 200), title, fill='black', font=font)
    g.text((60, 40), title, fill='black', font=big_font)
    g.text((60, 80), 'BLOCK E2 - ROOMS, CODES AND ARRANGEMENT FROM THE SIT CAMPUS WAYFINDER; FOOTPRINT FROM OPENSTREETMAP. '
                     'NOT AN OFFICIAL SIT DRAWING.', fill='black', font=small)
    im.save(path, optimize=True)


def main():
    src = os.path.join(SITE_DIR, 'sit', 'E2.json')
    if not os.path.exists(src):
        sys.stderr.write(f'missing {src}\n'); sys.exit(2)
    sit = json.load(open(src, encoding='utf-8'))['rooms']
    for r in sit: r['kind'] = kind_of(r['name'])
    levels = {str(i): str(i) for i in range(1, 11)}
    fold = {'1M': '1', '2M': '2'}
    site_path = os.path.join(SITE_DIR, 'site.json')
    site = json.load(open(site_path, encoding='utf-8'))
    block = next(b for b in site['blocks'] if b['code'] == 'E2')
    rooms_out = []
    for lv in range(1, 11):
        rooms = [r for r in sit if fold.get(r['level'], r['level']) == str(lv)]
        plan, split = floor_plan(lv, rooms, lv)
        name = f'E2 - Level {lv:02d}.png'
        draw_floor(os.path.join(SITE_DIR, 'E2', name), f'BLOCK E2  LEVEL {lv:02d} PLAN', plan, split, ground=lv == 1)
        # site.json rooms: corridors first, so the rooms drawn over them win (room_at takes the last match)
        rooms_out.append(dict(level=lv, code='', name='', kind='corridor', rect=[0.0, 0.0, LEN, DEP]))
        for kind, nm, code, (x0, d0, x1, d1), _ in plan:
            if kind == 'lift': nm = ''
            rooms_out.append(dict(level=lv, code=code, name=nm, kind=kind,
                                  rect=[round(x0, 2), round(DEP - d1, 2), round(x1, 2), round(DEP - d0, 2)]))
    block['rooms'] = rooms_out
    block['levels'] = 10
    block['name'] = 'E2 - ACADEMIC BUILDING (CAMPUS COURT)'
    with open(site_path, 'w', encoding='utf-8') as f:                    # same compact form as before
        f.write(json.dumps(site, separators=(',', ':'), ensure_ascii=False))
    print(f'E2: {len([r for r in rooms_out if r["code"]])} coded rooms on 10 floors')


if __name__ == '__main__':
    main()
