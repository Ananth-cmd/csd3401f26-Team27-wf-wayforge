#!/usr/bin/env python3
"""
\\file sit_surroundings.py
\\brief Build the SIT Punggol surroundings (ground, water, roads, landmarks) from OpenStreetMap

Usage:
    python tools/sit_surroundings.py [osm.json]

Without a file it downloads the area around the campus from the Overpass API;
with a file it reads a saved Overpass answer (out body geom). It writes
data/plans/sit-punggol/surroundings.json, which tools/build_sit_punggol.py
puts into the campus .wfb as "site" so the Navigator can draw what is around
the blocks.

Everything is in campus coordinates: metres east / north of the latitude /
longitude in site.json, the same frame as the block placements and bridges.
Shapes are cut to a box around the campus and simplified to 0.5 m.

Written:
    bounds     [x0, y0, x1, y1] of the box
    areas      water, park, grass, trees and plaza outlines (kind, name, polygon)
    roads      road, path and cycle lines (kind, name, width, points)
    buildings  neighbouring buildings (name, kind, levels, polygon)
    landmarks  named points to find your way by (name, kind, pos)

Exit codes:
    0  surroundings written
    1  download failed or the answer was not usable
    2  bad usage or missing files

Data: OpenStreetMap contributors, Open Database License (ODbL).

\\author Ananthan Elangovan (ananthan.e@digipen.edu)

Contribution: Ananthan Elangovan 100%
  - Overpass query, projection to campus metres, clipping and simplifying
  - Choice of areas, roads, buildings and landmarks to keep

AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.

\\date 2026-11-16
\\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
"""
import json
import math
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DIR = os.path.join(ROOT, 'data', 'plans', 'sit-punggol')
BOUNDS = (-460.0, -320.0, 470.0, 260.0)       # box around the campus, metres: includes the MRT station and the reservoir shore
EARTH = 6378137.0
OVERPASS = 'https://overpass-api.de/api/interpreter'

# highway value -> (kind, width in metres)
ROADS = {'secondary': ('road', 9.0), 'secondary_link': ('road', 6.0), 'tertiary': ('road', 8.0),
         'residential': ('road', 7.0), 'unclassified': ('road', 7.0), 'service': ('road', 4.5),
         'footway': ('path', 2.5), 'pedestrian': ('path', 4.0), 'path': ('path', 2.0), 'steps': ('path', 2.0),
         'track': ('path', 2.5), 'cycleway': ('cycle', 2.5)}
# building values that are part of the campus model or not worth drawing
SKIP_BUILDINGS = {'university', 'bridge', 'roof', 'construction', 'proposed'}


def query(site):
    """Overpass query for everything in the box around the campus."""
    lat0, lon0 = site['latitude'], site['longitude']
    k = 180.0 / math.pi / EARTH
    s, n = lat0 + BOUNDS[1] * k, lat0 + BOUNDS[3] * k
    w, e = lon0 + BOUNDS[0] * k / math.cos(math.radians(lat0)), lon0 + BOUNDS[2] * k / math.cos(math.radians(lat0))
    box = f'{s:.6f},{w:.6f},{n:.6f},{e:.6f}'
    return ('[out:json][timeout:60];(way(' + box + ');relation(' + box + ')[natural=water];'
            'node(' + box + ')[name];);out body geom;')


def download(site):
    data = urllib.parse.urlencode({'data': query(site)}).encode()
    req = urllib.request.Request(OVERPASS, data=data, headers={'User-Agent': 'wayforge-campus-build/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def simplify(pts, tol):
    """Douglas-Peucker on an open line."""
    if len(pts) < 3: return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (ax, ay), (bx, by) = pts[i], pts[j]
        ln = math.hypot(bx - ax, by - ay) or 1.0
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            d = abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / ln
            if d > best: best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack += [(i, bi), (bi, j)]
    return [p for p, k in zip(pts, keep) if k]


def simplify_ring(ring, tol):
    """Douglas-Peucker on a closed ring: split at the point farthest from the start, simplify both halves."""
    pts = ring[:-1] if math.dist(ring[0], ring[-1]) < 0.01 else ring
    if len(pts) < 5: return pts
    far = max(range(len(pts)), key=lambda i: math.dist(pts[i], pts[0]))
    return simplify(pts[:far + 1], tol)[:-1] + simplify(pts[far:] + [pts[0]], tol)[:-1]


def clip_polygon(poly):
    """Sutherland-Hodgman: the part of a polygon inside BOUNDS."""
    x0, y0, x1, y1 = BOUNDS
    sides = [(0, x0, 1), (0, x1, -1), (1, y0, 1), (1, y1, -1)]      # axis, limit, sign of the inside
    for axis, lim, sign in sides:
        out = []
        for i, p in enumerate(poly):
            q = poly[i - 1]
            pin, qin = (p[axis] - lim) * sign >= 0, (q[axis] - lim) * sign >= 0
            if pin != qin:
                t = (lim - q[axis]) / (p[axis] - q[axis])
                out.append((q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t))
            if pin: out.append(p)
        poly = out
        if len(poly) < 3: return []
    return poly


def clip_line(pts):
    """Pieces of a line inside BOUNDS (Liang-Barsky per segment)."""
    x0, y0, x1, y1 = BOUNDS
    pieces, cur = [], []
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t0, t1, ok = 0.0, 1.0, True
        for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
            if p == 0:
                if q < 0: ok = False
            else:
                t = q / p
                if p < 0: t0 = max(t0, t)
                else: t1 = min(t1, t)
        if not ok or t0 > t1:
            if len(cur) > 1: pieces.append(cur)
            cur = []
            continue
        s, e = (a[0] + dx * t0, a[1] + dy * t0), (a[0] + dx * t1, a[1] + dy * t1)
        if not cur or math.dist(cur[-1], s) > 1e-6:
            if len(cur) > 1: pieces.append(cur)
            cur = [s]
        cur.append(e)
        if t1 < 1.0:
            if len(cur) > 1: pieces.append(cur)
            cur = []
    if len(cur) > 1: pieces.append(cur)
    return pieces


def rings_of(relation, xy):
    """Outer rings of a multipolygon relation, joined from its member ways."""
    parts = [[xy(g) for g in m['geometry']] for m in relation['members']
             if m['type'] == 'way' and m.get('role') in ('outer', '') and m.get('geometry')]
    rings = []
    while parts:
        ring = parts.pop()
        while math.dist(ring[0], ring[-1]) > 0.01:
            for i, p in enumerate(parts):
                if math.dist(p[0], ring[-1]) < 0.01: ring += p[1:]; break
                if math.dist(p[-1], ring[-1]) < 0.01: ring += p[-2::-1]; break
            else:
                break                                   # open ring: the rest lies outside the download
            parts.pop(i)
        if len(ring) >= 4: rings.append(ring)
    return rings


def rounded(pts):
    return [[round(x, 1), round(y, 1)] for x, y in pts]


def area_of(poly):
    return abs(sum(poly[i - 1][0] * p[1] - p[0] * poly[i - 1][1] for i, p in enumerate(poly))) / 2


def main():
    site = json.load(open(os.path.join(SITE_DIR, 'site.json'), encoding='utf-8'))
    if len(sys.argv) > 1:
        if not os.path.exists(sys.argv[1]):
            sys.stderr.write(f'file not found: {sys.argv[1]}\n')
            return 2
        osm = json.load(open(sys.argv[1], encoding='utf-8'))
    else:
        try:
            osm = download(site)
        except Exception as e:                          # network errors, bad JSON
            sys.stderr.write(f'download failed: {e}\n')
            return 1
    lat0, lon0 = site['latitude'], site['longitude']
    kx = math.pi / 180 * EARTH * math.cos(math.radians(lat0))
    ky = math.pi / 180 * EARTH

    def xy(g):
        return ((g['lon'] - lon0) * kx, (g['lat'] - lat0) * ky)

    def inside(p):
        return BOUNDS[0] <= p[0] <= BOUNDS[2] and BOUNDS[1] <= p[1] <= BOUNDS[3]

    areas, roads, buildings, landmarks = [], [], [], []

    def add_area(kind, name, ring):
        poly = clip_polygon(simplify_ring(ring, 0.5))
        if len(poly) >= 3 and area_of(poly) > 30: areas.append(dict(kind=kind, name=name, polygon=rounded(poly)))

    def add_landmark(name, kind, p):
        if not name or not inside(p): return
        for m in landmarks:                              # one mark per name within 60 m (both platforms of a station)
            if m['name'] == name and math.dist(m['pos'], p) < 60: return
        landmarks.append(dict(name=name, kind=kind, pos=[round(p[0], 1), round(p[1], 1)]))

    for e in osm.get('elements', []):
        t = e.get('tags', {})
        name = t.get('name', '')
        if e['type'] == 'relation':
            if t.get('natural') == 'water':
                for ring in rings_of(e, xy): add_area('water', name, ring)
            continue
        if e['type'] == 'node':
            p = xy(e)
            if t.get('railway') in ('stop', 'station') or t.get('station') == 'subway': add_landmark(name + ' MRT', 'mrt', p)
            elif t.get('railway') == 'subway_entrance': add_landmark(name or 'MRT exit ' + t.get('ref', ''), 'mrt', p)
            elif t.get('highway') == 'bus_stop': add_landmark(name, 'bus', p)
            elif t.get('amenity') == 'food_court': add_landmark(name, 'food', p)
            elif t.get('shop') == 'supermarket': add_landmark(name, 'shop', p)
            continue
        pts = [xy(g) for g in e.get('geometry', [])]
        if len(pts) < 2: continue
        closed = len(pts) >= 4 and math.dist(pts[0], pts[-1]) < 0.01
        centre = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        if 'building' in t:
            if t['building'] in SKIP_BUILDINGS or not closed: continue
            poly = clip_polygon(simplify_ring(pts, 0.5))
            if len(poly) < 3 or area_of(poly) < 40: continue
            try: levels = int(float(t.get('building:levels', 3)))
            except ValueError: levels = 3
            buildings.append(dict(name=name, kind=t['building'], levels=max(1, levels), polygon=rounded(poly)))
            if t['building'] in ('train_station', 'transportation', 'retail') and name:
                add_landmark(name, 'bus' if 'Bus' in name else 'mrt' if t['building'] == 'train_station' else 'shop', centre)
            continue
        if closed and (t.get('natural') == 'water' or t.get('waterway') == 'riverbank'):
            add_area('water', name, pts)
        elif closed and t.get('leisure') == 'park':
            add_area('park', name, pts)
            if name: add_landmark(name, 'park', centre)
        elif closed and (t.get('landuse') == 'grass' or t.get('natural') == 'grassland'):
            add_area('grass', name, pts)
        elif closed and (t.get('landuse') == 'forest' or t.get('natural') in ('scrub', 'wood')):
            add_area('trees', name, pts)
        elif closed and t.get('highway') == 'pedestrian' and t.get('area') == 'yes':
            add_area('plaza', name, pts)
        elif t.get('highway') in ROADS and t.get('tunnel') != 'yes':
            kind, width = ROADS[t['highway']]
            for piece in clip_line(simplify(pts, 0.5)):
                roads.append(dict(kind=kind, name=name, width=width, bridge=t.get('bridge') == 'yes', points=rounded(piece)))
        elif t.get('waterway') == 'canal' and name:
            mid = pts[len(pts) // 2]
            near = min(pts, key=lambda p: math.dist(p, (0.0, BOUNDS[1] + 60)))
            add_landmark(name, 'water', near if inside(near) else mid)

    if not areas and not roads:
        sys.stderr.write('nothing usable in the OpenStreetMap answer\n')
        return 1
    order = {'water': 0, 'trees': 1, 'grass': 2, 'park': 3, 'plaza': 4}
    areas.sort(key=lambda a: (order[a['kind']], -area_of(a['polygon'])))      # draw order: by kind, larger areas first
    roads.sort(key=lambda r: (r['kind'] != 'road', -r['width']))
    out = dict(source='OpenStreetMap contributors (ODbL)', bounds=list(BOUNDS), areas=areas, roads=roads,
               buildings=buildings, landmarks=landmarks)
    path = os.path.join(SITE_DIR, 'surroundings.json')
    json.dump(out, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'areas {len(areas)}, roads {len(roads)}, buildings {len(buildings)}, landmarks {len(landmarks)}')
    print(f'wrote {path} ({os.path.getsize(path) / 1e3:.0f} kB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
