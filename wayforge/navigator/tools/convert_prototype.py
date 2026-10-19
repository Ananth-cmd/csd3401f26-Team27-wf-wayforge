"""Convert the Unity prototype (Level 1-3 .obj + Navigation.asset) into navigator/public/building.json.
Usage: python convert_prototype.py <folder with Level 1.obj, Level 2.obj, Level 3.obj, Navigation.asset> <out.json>
Unity import: x is mirrored, scale 0.05 (cm -> m * 5), plus each floor prefab's child offset."""
import re, json, sys, math, os
src, out = sys.argv[1], sys.argv[2]
OFFSET = [(0.32987022, -6.2412663), (0.3637104, -3.3745823), (0.28385544, -6.2602215)]  # from Level N.prefab
SCALE, FLOOR_H = 0.05, 4.0
def find(name):
    for f in os.listdir(src):
        if f.replace('_', ' ').endswith(name): return os.path.join(src, f)
    raise SystemExit('missing ' + name)
def boxes(path):
    vs = [tuple(map(float, l.split()[1:4])) for l in open(path) if l.startswith('v ')]
    return [vs[i:i + 8] for i in range(0, len(vs), 8)]
def r2(v): return round(v, 3)
nav = open(find('Navigation.asset')).read()
levels = []
for f in range(3):
    ox, oz = OFFSET[f]; walls = []; slabs = []
    for b in boxes(find(f'Level {f + 1}.obj')):
        xs = sorted(-v[0] * SCALE + ox for v in b); zs = sorted(v[2] * SCALE + oz for v in b)
        ys = [v[1] for v in b]
        x0, x1, z0, z1 = xs[0], xs[-1], zs[0], zs[-1]
        if max(ys) - min(ys) < 5:  # thin slab = floor
            slabs.append([[r2(x0), r2(z0)], [r2(x1), r2(z0)], [r2(x1), r2(z1)], [r2(x0), r2(z1)]]); continue
        if x1 - x0 >= z1 - z0:
            zc = (z0 + z1) / 2; walls.append({'a': [r2(x0), r2(zc)], 'b': [r2(x1), r2(zc)], 'thickness': r2(z1 - z0)})
        else:
            xc = (x0 + x1) / 2; walls.append({'a': [r2(xc), r2(z0)], 'b': [r2(xc), r2(z1)], 'thickness': r2(x1 - x0)})
    levels.append({'index': f, 'name': f'Level {f + 1}', 'elevation': f * FLOOR_H, 'height': FLOOR_H, 'floors': slabs, 'walls': walls})
nodes = []
for m in re.finditer(r'- id: (\S+)\n\s+label: (.+)\n\s+floor: (\d)\n\s+position: \{x: ([-\d.]+), y: [-\d.]+, z: ([-\d.]+)\}', nav):
    nid = m[1]; kind = 'stairs' if nid.endswith('stairs') else 'lift' if nid.endswith('lift') else 'turn' if '-turn-' in nid else 'room'
    nodes.append({'id': nid, 'label': m[2].strip(), 'level': int(m[3]), 'pos': [float(m[4]), float(m[5])], 'kind': kind})
lvl = {n['id']: n['level'] for n in nodes}
edges, links = [], []
PASS = {0: 'walk', 1: 'stairs', 2: 'lift'}
for m in re.finditer(r'- from: (\S+)\n\s+to: (\S+)\n\s+passage: (\d)\n\s+bidirectional: (\d)\n\s+blocked: (\d)\n\s+extraMetres: ([-\d.]+)', nav):
    e = {'from': m[1], 'to': m[2], 'kind': PASS[int(m[3])], 'bidirectional': m[4] == '1', 'blocked': m[5] == '1', 'extraCost': float(m[6])}
    (links if lvl[m[1]] != lvl[m[2]] else edges).append(e)
pois = []
for m in re.finditer(r'- id: (\S+)\n\s+name: (.+)\n\s+code: (\S+)\n\s+waypointId: (\S+)\n\s+category: (\S+)', nav):
    pois.append({'id': m[1], 'name': m[2].strip(), 'code': m[3], 'node': m[4], 'category': m[5]})
for n in nodes:  # stairs and lifts searchable as landmarks
    if n['kind'] in ('stairs', 'lift'):
        pois.append({'id': n['id'], 'name': f"{'Stairs' if n['kind'] == 'stairs' else 'Lift'} (Level {n['level'] + 1})", 'code': n['id'], 'node': n['id'], 'category': 'Landmarks'})
b = {'format': 'wfb-json', 'version': 1, 'id': 'sit-demo', 'name': 'SIT - supplied models', 'site': 'SIT · Campus navigation',
     'illustrative': True, 'units': 'm', 'levels': levels, 'nodes': nodes, 'edges': edges, 'links': links, 'pois': pois}
json.dump(b, open(out, 'w'), indent=1)
print(f"levels {len(levels)} walls {[len(l['walls']) for l in levels]} nodes {len(nodes)} edges {len(edges)} links {len(links)} pois {len(pois)}")
