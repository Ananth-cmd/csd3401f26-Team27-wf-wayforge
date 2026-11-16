#!/usr/bin/env python3
"""
\\file build_sit_punggol.py
\\brief Build the SIT Punggol campus .wfb from its floor plan images

Usage:
    python tools/build_sit_punggol.py <path/to/wf_cli> [out.wfb]

Reads data/plans/sit-punggol/site.json and the floor plan images in
data/plans/sit-punggol/<BLOCK>/<BLOCK> - Level NN.png. For each block it runs
    wf_cli build <block.wfb> <level images...> --scale <m/px> --floor-height 4.5 --no-align
then rotates and moves the block to its place on the campus, merges the blocks
level by level, names the rooms (code, name, kind from site.json), adds the
Level 5 link bridges and runs  wf_cli graph  on the result for the walking paths.
Each bridge stops at the face of the blocks it joins, with a double door in the
block wall there. The surroundings in surroundings.json (ground, water, roads,
landmarks; written by tools/sit_surroundings.py) and the bridge colours are
added to the file as "site".
Output defaults to studio-web/public/samples/sit-punggol.wfb (compact JSON), the
Studio sample and the file to upload and publish for the live sites.

site.json per block: metresPerPixel of its images; placement (angle in degrees,
campus centre, shift of the block grid, sheet origin of the drawing); rooms
(level, code, name, kind, rectangle in sheet metres). Campus coordinates are
metres east / north of the latitude / longitude in site.json.

Exit codes:
    0  campus written
    1  a wf_cli step failed
    2  bad usage or missing files

\\author Ananthan Elangovan (ananthan.e@digipen.edu)

Contribution: Ananthan Elangovan 100%
  - Per-block build, placement on the campus grid and level merge
  - Room naming from the drawing data, link bridges with doorways, navigation rebuild
  - Surroundings and bridge colours added to the building file

AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.

\\date 2026-10-25
\\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
"""
import json
import math
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DIR = os.path.join(ROOT, 'data', 'plans', 'sit-punggol')


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout + r.stderr)
        sys.exit(1)
    return r.stdout


def room_at(rooms, level, p):
    """Last room of the drawing whose rectangle holds p (later rooms are drawn over earlier ones)."""
    hit = None
    for r in rooms:
        if r['level'] != level: continue
        x0, y0, x1, y1 = r['rect']
        if x0 <= p[0] <= x1 and y0 <= p[1] <= y1: hit = r
    return hit


def place_block(block, doc, levels):
    pl = block['placement']
    a = math.radians(pl['angle'])
    ca, sa = math.cos(a), math.sin(a)
    cx, cy = pl['centre']
    sx, sy = pl['shift']
    ox, oy = pl['sheetOrigin']
    code = block['code']

    def T(p):                                   # sheet metres -> block grid -> campus
        u, v = p[0] - ox + sx, p[1] - oy + sy
        return [round(cx + u * ca - v * sa, 3), round(cy + u * sa + v * ca, 3)]

    for li, L in enumerate(doc['levels']):
        lv = li + 1
        tgt = levels.setdefault(lv, dict(id=f'L{lv}', name=f'Level {lv}', elevation=0.0, ceilingHeight=3.5,
                                         walls=[], openings=[], rooms=[], nodes=[], edges=[], pois=[], anchors=[]))
        for w in L['walls']:
            tgt['walls'].append(dict(w, id=f"{code}_{w['id']}", a=T(w['a']), b=T(w['b'])))
        for o in L['openings']:
            tgt['openings'].append(dict(o, id=f"{code}_{o['id']}", wall=f"{code}_{o['wall']}"))
        for r in L['rooms']:
            c = r['centroid']
            drawn = room_at(block['rooms'], lv, (c[0] - ox, c[1] - oy))
            kind, name, rc = r['kind'], '', ''
            if drawn is not None:
                if kind not in ('stair', 'lift'): kind = drawn['kind']   # stair / lift found by wf_cli are kept
                name, rc = drawn['name'], drawn['code']
            tgt['rooms'].append(dict(r, id=f"{code}_{r['id']}", polygon=[T(p) for p in r['polygon']], centroid=T(c),
                                     kind=kind, name=name, code=rc, boundary=[]))


def blocks_touching(level, pts, margin=2.0):
    """Codes of the blocks with a room corner within margin of the polygon's bounding box."""
    x0, y0 = min(p[0] for p in pts) - margin, min(p[1] for p in pts) - margin
    x1, y1 = max(p[0] for p in pts) + margin, max(p[1] for p in pts) + margin
    return {r['id'].split('_')[0] for r in level['rooms']
            if not r['id'].startswith('BR') and any(x0 <= p[0] <= x1 and y0 <= p[1] <= y1 for p in r['polygon'])}


def in_polygon(p, poly):
    inside = False
    for k in range(len(poly)):
        a, b = poly[k], poly[k - 1]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]: inside = not inside
    return inside


def segment_distance(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1.0)))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)


def crossing_along(p, q, a, b):
    """Where the line p-q crosses the wall a-b, as metres from a along the wall; None when they do not cross."""
    rx, ry, sx, sy = q[0] - p[0], q[1] - p[1], b[0] - a[0], b[1] - a[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-9: return None
    t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / den
    u = ((a[0] - p[0]) * ry - (a[1] - p[1]) * rx) / den
    return u * math.hypot(sx, sy) if 0.0 <= t <= 1.0 and 0.0 <= u <= 1.0 else None


def clip_to_blocks(pts, inside):
    """Bridge outline cut where it runs into a block. Returns the outline that is left as a list of
    (point, mouth): mouth is True when the edge from this point to the next one closes the outline
    across the block face (where the bridge enters the block). When the blocks cut the bridge into
    several pieces, the largest piece is returned."""
    samples = []                                    # (point, is a corner) along the outline, about every 0.2 m
    for k in range(len(pts)):
        a, b = pts[k], pts[(k + 1) % len(pts)]
        n = max(1, int(math.dist(a, b) / 0.2))
        samples += [([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], j == 0) for j in range(n)]
    flags = [inside(p) for p, _ in samples]
    if not any(flags): return [(p, False) for p in pts]
    if all(flags): return []

    def crossing(p, q):                             # where the outline crosses the block face between p (one side) and q
        fp = inside(p)
        for _ in range(12):
            m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
            if inside(m) == fp: p = m
            else: q = m
        return [round((p[0] + q[0]) / 2, 3), round((p[1] + q[1]) / 2, 3)]

    # runs of the outline outside the blocks, each from where it leaves a block to where it enters the next
    N = len(samples)
    start = next(i for i in range(N) if flags[i - 1] and not flags[i])
    runs = []
    for step in range(N):
        i = (start + step) % N
        p, corner = samples[i]
        if flags[i]: continue
        if flags[i - 1]: runs.append([crossing(samples[i - 1][0], p)])
        if corner: runs[-1].append(p)
        if flags[(i + 1) % N]: runs[-1].append(crossing(p, samples[(i + 1) % N][0]))

    def on_face(a, b):
        """How much of the line a-b runs along a block face (block on one side, open on the other), 0..1."""
        ln = math.dist(a, b)
        if ln < 0.05: return 1.0
        nx, ny = (b[1] - a[1]) / ln * 0.4, -(b[0] - a[0]) / ln * 0.4
        steps = max(1, int(ln / 0.5))
        hits = 0
        for j in range(steps):
            t = (j + 0.5) / steps
            m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
            hits += inside([m[0] + nx, m[1] + ny]) != inside([m[0] - nx, m[1] - ny])
        return hits / steps

    # The end of each run is joined to the start of the run that continues the same piece of bridge:
    # the one it reaches along a block face, the nearest when several do.
    pairs = sorted(((on_face(runs[i][-1], runs[j][0]) - 0.01 * math.dist(runs[i][-1], runs[j][0]), i, j)
                    for i in range(len(runs)) for j in range(len(runs))), reverse=True)
    nxt = {}
    for _, i, j in pairs:
        if i not in nxt and j not in nxt.values(): nxt[i] = j
    best, best_area, seen = [], 0.0, set()
    for i in range(len(runs)):
        if i in seen: continue
        piece, k = [], i
        while k not in seen:
            seen.add(k)
            piece += [(q, False) for q in runs[k][:-1]] + [(runs[k][-1], True)]
            k = nxt[k]
        ring = [q for q, _ in piece]
        area = abs(sum(ring[m - 1][0] * q[1] - q[0] * ring[m - 1][1] for m, q in enumerate(ring))) / 2
        if area > best_area: best, best_area = piece, area
    return best


def block_floor(block, level):
    """Test for a campus point lying on a block's floor: inside one of the room rectangles drawn for that level."""
    pl = block['placement']
    a = math.radians(pl['angle'])
    ca, sa = math.cos(a), math.sin(a)
    cx, cy = pl['centre']
    sx, sy = pl['shift']
    rects = [r['rect'] for r in block['rooms'] if r['level'] == level]

    def inside(p, margin=0.15):
        dx, dy = p[0] - cx, p[1] - cy
        u, v = dx * ca + dy * sa - sx, -dx * sa + dy * ca - sy      # campus -> drawing metres, the reverse of place_block
        return any(x0 - margin <= u <= x1 + margin and y0 - margin <= v <= y1 + margin for x0, y0, x1, y1 in rects)
    return inside


def add_bridges(site, levels):
    """Bridges joining two or more blocks; those leading to buildings outside the model are left out.
    A bridge stops at the face of each block it meets and a double door is cut in the block wall
    there, so the walking paths enter the block through a doorway. The room behind that door
    becomes the bridge lobby (a space to walk through, like a corridor) unless it is a stair or lift."""
    colours = []
    for i, br in enumerate(site['bridges'], 1):
        L = levels.get(br['level'])
        if L is None: continue
        if len(blocks_touching(L, br['polygon'])) < 2: continue
        bid = f'BR{i}'
        rooms = [r for r in L['rooms'] if not r['id'].startswith('BR')]
        boxes = [(min(p[0] for p in r['polygon']), min(p[1] for p in r['polygon']),
                  max(p[0] for p in r['polygon']), max(p[1] for p in r['polygon'])) for r in rooms]
        walls = [w for w in L['walls'] if not w['id'].startswith('BR')]
        floors = [block_floor(b, br['level']) for b in site['blocks']]

        def room_at_point(p):
            for r, (x0, y0, x1, y1) in zip(rooms, boxes):
                if x0 <= p[0] <= x1 and y0 <= p[1] <= y1 and in_polygon(p, r['polygon']): return r
            return None

        outline = clip_to_blocks(br['polygon'], lambda p: any(f(p) for f in floors))
        if len(outline) < 3: continue
        pts = [p for p, _ in outline]
        mouth = [m for _, m in outline]
        n = len(pts)

        def along(w, s):                            # point s metres along wall w
            ln = math.dist(w['a'], w['b'])
            return [w['a'][0] + (w['b'][0] - w['a'][0]) * s / ln, w['a'][1] + (w['b'][1] - w['a'][1]) * s / ln]

        def wall_along(a, b, reach):
            """Block wall lying along a-b: the one covering most of it, within reach and 25 degrees."""
            mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            best, span = None, (0.0, 0.0)
            for w in walls:
                ln = math.dist(w['a'], w['b'])
                if ln < 1.0 or segment_distance(mid, w['a'], w['b']) > reach: continue
                d = [(w['b'][0] - w['a'][0]) / ln, (w['b'][1] - w['a'][1]) / ln]
                turn = abs((math.atan2(d[1], d[0]) - ang + math.pi / 2) % math.pi - math.pi / 2)
                if turn > math.radians(25): continue
                s = sorted(((q[0] - w['a'][0]) * d[0] + (q[1] - w['a'][1]) * d[1]) for q in (a, b))
                s0, s1 = max(0.2, s[0]), min(ln - 0.2, s[1])
                if s1 - s0 > span[1] - span[0]: best, span = w, (s0, s1)
            return best, span

        def wall_under(a, b):
            """For a mouth that cuts a corner of a block: the outside wall of the block with the longest
            stretch under the bridge, within 8 m of the mouth."""
            mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
            best, span = None, (0.0, 0.0)
            for w in walls:
                ln = math.dist(w['a'], w['b'])
                if ln < 1.4 or segment_distance(mid, w['a'], w['b']) > 8.0: continue
                nx, ny = -(w['b'][1] - w['a'][1]) / ln * 0.6, (w['b'][0] - w['a'][0]) / ln * 0.6
                steps, s0 = int(ln / 0.25), None
                for j in range(steps + 2):
                    s = min(ln, j * 0.25)
                    under = j <= steps and in_polygon(along(w, s), br['polygon'])
                    if under and s0 is None: s0 = s
                    if not under and s0 is not None:
                        run = (max(0.2, s0), min(ln - 0.2, s - 0.25))
                        m = along(w, (run[0] + run[1]) / 2)
                        outside = (room_at_point([m[0] + nx, m[1] + ny]) is None) != (room_at_point([m[0] - nx, m[1] - ny]) is None)
                        if outside and run[1] - run[0] > span[1] - span[0]: best, span = w, run
                        s0 = None
            return best, span

        # A short end of the bridge that stops just outside a block is a mouth too: it is moved onto the block wall.
        for k in range(n):
            a, b = pts[k], pts[(k + 1) % n]
            if mouth[k] or not 1.2 <= math.dist(a, b) <= 8.0: continue
            w, span = wall_along(a, b, 1.5)
            if w is None or span[1] - span[0] < 1.2: continue
            ln = math.dist(w['a'], w['b'])
            d = [(w['b'][0] - w['a'][0]) / ln, (w['b'][1] - w['a'][1]) / ln]
            for j in (k, (k + 1) % n):
                pts[j] = [round(v, 3) for v in along(w, (pts[j][0] - w['a'][0]) * d[0] + (pts[j][1] - w['a'][1]) * d[1])]
            mouth[k] = True

        doors = 0
        for k in range(n):
            a, b = pts[k], pts[(k + 1) % n]
            ln = math.dist(a, b)
            if ln < 0.3: continue
            wid = f'{bid}_w{k}'
            if mouth[k] and ln >= 1.2:
                w, span = wall_along(a, b, 1.0)
                if w is None or span[1] - span[0] < 1.2: w, span = wall_under(a, b)
                if w is not None and span[1] - span[0] >= 1.2:
                    width = min(2.4, span[1] - span[0] - 0.4)
                    offset = (span[0] + span[1] - width) / 2
                    if any(o['wall'] == w['id'] and o['id'].startswith(bid) and abs(o['offset'] - offset) < 4.0 for o in L['openings']):
                        continue                    # this bridge already has its door in that wall
                    at = along(w, offset + width / 2)
                    wl = math.dist(w['a'], w['b'])
                    nx, ny = -(w['b'][1] - w['a'][1]) / wl, (w['b'][0] - w['a'][0]) / wl
                    # The door goes through that wall and any other block wall right behind or in front of it
                    # (a block face drawn as two lines); it replaces the windows in its way.
                    cut = [(w, offset)]
                    for w2 in walls:
                        s2 = None if w2 is w else crossing_along([at[0] - nx * 1.5, at[1] - ny * 1.5], [at[0] + nx * 1.5, at[1] + ny * 1.5], w2['a'], w2['b'])
                        if s2 is not None and width / 2 + 0.1 <= s2 <= math.dist(w2['a'], w2['b']) - width / 2 - 0.1: cut.append((w2, s2 - width / 2))
                    for j, (wc, off) in enumerate(cut):
                        L['openings'] = [o for o in L['openings'] if not (o['wall'] == wc['id'] and o['type'] == 'window'
                                         and o['offset'] < off + width + 0.2 and o['offset'] + o['width'] > off - 0.2)]
                        L['openings'].append(dict(id=f'{wid}_d' + (str(j) if j else ''), wall=wc['id'], type='door', offset=round(off, 3),
                                                  width=round(width, 3), height=2.1, sill=0.0, confidence=1.0))
                else:                               # no block wall there: the bridge's own end wall carries the door
                    width = min(2.4, ln - 0.4)
                    L['walls'].append(dict(id=wid, a=a, b=b, thickness=0.2, confidence=1.0))
                    L['openings'].append(dict(id=f'{wid}_d', wall=wid, type='door', offset=round((ln - width) / 2, 3),
                                              width=round(width, 3), height=2.1, sill=0.0, confidence=1.0))
                    at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
                    nx, ny = (b[1] - a[1]) / ln, -(b[0] - a[0]) / ln
                doors += 1
                for side in (0.8, -0.8, 1.6, -1.6):  # the block room just behind the door
                    r = room_at_point([at[0] + nx * side, at[1] + ny * side])
                    if r is not None and r['kind'] not in ('corridor', 'stair', 'lift', 'exit'):
                        r['kind'], r['name'] = 'corridor', 'Link Bridge Lobby'   # corridor kind: routes may pass through it
                continue
            L['walls'].append(dict(id=wid, a=a, b=b, thickness=0.2, confidence=1.0))
            for j in range(int((ln - 1.0) // 2.2) if ln >= 3.0 else 0):
                L['openings'].append(dict(id=f'{wid}_o{j}', wall=wid, type='window', offset=round(0.6 + j * 2.2, 3),
                                          width=1.6, height=1.6, sill=0.9, confidence=1.0))
        area = 0.5 * abs(sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n)))
        cx = sum(p[0] for p in pts) / n; cy = sum(p[1] for p in pts) / n
        L['rooms'].append(dict(id=f'{bid}_r', polygon=pts, centroid=[cx, cy], area=round(area, 2), kind='corridor',
                               name=br['name'], code='', confidence=1.0, boundary=[]))
        if br.get('colour'): colours.append(dict(room=f'{bid}_r', level=L['id'], colour=br['colour']))
        print(f'{bid}: {n} corners, {doors} doorways')
    return colours


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    cli = os.path.abspath(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'studio-web', 'public', 'samples', 'sit-punggol.wfb')
    if not os.path.exists(cli):
        sys.stderr.write(f'wf_cli not found: {cli}\n')
        return 2
    site = json.load(open(os.path.join(SITE_DIR, 'site.json'), encoding='utf-8'))
    levels = {}
    with tempfile.TemporaryDirectory() as tmp:
        for block in site['blocks']:
            code = block['code']
            images = [os.path.join(SITE_DIR, code, f'{code} - Level {lv:02d}.png') for lv in range(1, block['levels'] + 1)]
            missing = [p for p in images if not os.path.exists(p)]
            if missing:
                sys.stderr.write(f'missing image: {missing[0]}\n')
                return 2
            wfb = os.path.join(tmp, f'{code}.wfb')
            log = run([cli, 'build', wfb, *images, '--name', block['name'], '--scale', str(block['metresPerPixel']),
                       '--floor-height', str(site['floorHeight']), '--no-align'])
            print(f'{code}: {log.strip().splitlines()[-1]}')
            place_block(block, json.load(open(wfb, encoding='utf-8')), levels)
        for lv, L in levels.items():
            L['elevation'] = (lv - 1) * site['floorHeight']
        bridge_colours = add_bridges(site, levels)
        doc = dict(version=1, source=dict(file='data/plans/sit-punggol', pixelsPerMetre=0.0, rectified=False),
                   building=dict(id='sit-punggol', name=site['name'], latitude=site['latitude'], longitude=site['longitude'],
                                 heading=0.0, unitsPerMetre=1.0),
                   levels=[levels[k] for k in sorted(levels)], links=[])
        merged = os.path.join(tmp, 'campus.wfb')
        json.dump(doc, open(merged, 'w', encoding='utf-8'))
        graphed = os.path.join(tmp, 'campus_graph.wfb')
        print('campus:', run([cli, 'graph', merged, '-o', graphed]).strip().splitlines()[-1])
        final = json.load(open(graphed, encoding='utf-8'))
    # "site": the surroundings from surroundings.json (tools/sit_surroundings.py) plus the bridge colours.
    around = os.path.join(SITE_DIR, 'surroundings.json')
    if os.path.exists(around):
        final['site'] = dict(json.load(open(around, encoding='utf-8')), bridges=bridge_colours)
    else:
        print('no surroundings.json: run tools/sit_surroundings.py to add the ground, roads and landmarks')
    json.dump(final, open(out, 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
