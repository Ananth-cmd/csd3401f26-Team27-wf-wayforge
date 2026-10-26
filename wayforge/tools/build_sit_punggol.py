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
  - Room naming from the drawing data, link bridges, navigation rebuild

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


def add_bridges(site, levels):
    """Bridges joining two or more blocks; those leading to buildings outside the model are left out."""
    for i, br in enumerate(site['bridges'], 1):
        L = levels.get(br['level'])
        if L is None: continue
        pts = br['polygon']
        if len(blocks_touching(L, pts)) < 2: continue
        bid = f'BR{i}'
        for k in range(len(pts)):
            a, b = pts[k], pts[(k + 1) % len(pts)]
            ln = math.dist(a, b)
            if ln < 0.3: continue
            wid = f'{bid}_w{k}'
            L['walls'].append(dict(id=wid, a=a, b=b, thickness=0.2, confidence=1.0))
            for j in range(int((ln - 1.0) // 2.2) if ln >= 3.0 else 0):
                L['openings'].append(dict(id=f'{wid}_o{j}', wall=wid, type='window', offset=round(0.6 + j * 2.2, 3),
                                          width=1.6, height=1.6, sill=0.9, confidence=1.0))
        area = 0.5 * abs(sum(pts[k][0] * pts[(k + 1) % len(pts)][1] - pts[(k + 1) % len(pts)][0] * pts[k][1] for k in range(len(pts))))
        cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
        L['rooms'].append(dict(id=f'{bid}_r', polygon=pts, centroid=[cx, cy], area=round(area, 2), kind='corridor',
                               name=br['name'], code='', confidence=1.0, boundary=[]))


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
        add_bridges(site, levels)
        doc = dict(version=1, source=dict(file='data/plans/sit-punggol', pixelsPerMetre=0.0, rectified=False),
                   building=dict(id='sit-punggol', name=site['name'], latitude=site['latitude'], longitude=site['longitude'],
                                 heading=0.0, unitsPerMetre=1.0),
                   levels=[levels[k] for k in sorted(levels)], links=[])
        merged = os.path.join(tmp, 'campus.wfb')
        json.dump(doc, open(merged, 'w', encoding='utf-8'))
        graphed = os.path.join(tmp, 'campus_graph.wfb')
        print('campus:', run([cli, 'graph', merged, '-o', graphed]).strip().splitlines()[-1])
        final = json.load(open(graphed, encoding='utf-8'))
    json.dump(final, open(out, 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
