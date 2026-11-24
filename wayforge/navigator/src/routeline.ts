// How the route LINE is drawn (the route itself comes from findRoute and is never changed).
// The graph's points can sit close to a wall, so a straight line between them hugs or clips walls, worst at corners.
// For drawing, each point in a corridor is moved to the middle between the walls on either side (and at a turn, the
// middle of the junction); points at doors stay in the doorway; nothing is moved if the line would then cross a wall.
// Corners are then rounded off a little. Cached per building, floor and route.
import type { Building, Vec2 } from './types'

type Seg = { ax: number; az: number; bx: number; bz: number; t: number }
const CELL = 8
const gridCache = new WeakMap<Building, Map<number, Map<string, Seg[]>>>()
function wallGrid(b: Building, li: number) {
  let byLevel = gridCache.get(b)
  if (!byLevel) { byLevel = new Map(); gridCache.set(b, byLevel) }
  let g = byLevel.get(li)
  if (g) return g
  g = new Map()
  for (const w of b.levels[li]?.walls ?? []) {
    const s: Seg = { ax: w.a[0], az: w.a[1], bx: w.b[0], bz: w.b[1], t: (w.thickness || 0.2) / 2 }
    const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL), x1 = Math.floor(Math.max(s.ax, s.bx) / CELL)
    const z0 = Math.floor(Math.min(s.az, s.bz) / CELL), z1 = Math.floor(Math.max(s.az, s.bz) / CELL)
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = `${x},${z}`; const l = g.get(k); if (l) l.push(s); else g.set(k, [s]) }
  }
  byLevel.set(li, g)
  return g
}
function near(g: Map<string, Seg[]>, x0: number, z0: number, x1: number, z1: number) {
  const out = new Set<Seg>()
  for (let x = Math.floor(Math.min(x0, x1) / CELL); x <= Math.floor(Math.max(x0, x1) / CELL); x++)
    for (let z = Math.floor(Math.min(z0, z1) / CELL); z <= Math.floor(Math.max(z0, z1) / CELL); z++) for (const s of g.get(`${x},${z}`) ?? []) out.add(s)
  return out
}
// distance along a ray to the nearest wall face (Infinity if none within max), and that wall
let lastHit: Seg | null = null
function ray(g: Map<string, Seg[]>, px: number, pz: number, dx: number, dz: number, max: number) {
  let best = Infinity
  lastHit = null
  for (const s of near(g, px - max, pz - max, px + max, pz + max)) {
    const ex = s.bx - s.ax, ez = s.bz - s.az, den = dx * ez - dz * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((s.ax - px) * ez - (s.az - pz) * ex) / den, u = ((s.ax - px) * dz - (s.az - pz) * dx) / den
    if (t > 0 && t < max && u >= -0.02 && u <= 1.02) { const d = Math.max(0, t - s.t); if (d < best) { best = d; lastHit = s } }
  }
  return best
}
// does the segment p-q cross a wall?
function crosses(g: Map<string, Seg[]>, p: Vec2, q: Vec2) {
  for (const s of near(g, p[0], p[1], q[0], q[1])) {
    const dx = q[0] - p[0], dz = q[1] - p[1], ex = s.bx - s.ax, ez = s.bz - s.az, den = dx * ez - dz * ex
    if (Math.abs(den) < 1e-9) continue
    const t = ((s.ax - p[0]) * ez - (s.az - p[1]) * ex) / den, u = ((s.ax - p[0]) * dz - (s.az - p[1]) * dx) / den
    if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) return true
  }
  return false
}
// doorways: the gap between the ends of two walls that carry on in the same line (0.6–3 m apart)
type Gap = { x: number; z: number; w: number; ux: number; uz: number } // middle, width, direction of the wall
const gapCache = new WeakMap<Building, Map<number, Map<string, Gap[]>>>()
function doorGaps(b: Building, li: number) {
  let byLevel = gapCache.get(b)
  if (!byLevel) { byLevel = new Map(); gapCache.set(b, byLevel) }
  let gg = byLevel.get(li)
  if (gg) return gg
  gg = new Map()
  const g = wallGrid(b, li)
  const ends: { x: number; z: number; ux: number; uz: number; s: Seg }[] = [] // wall end + direction pointing out of the wall
  for (const w of b.levels[li]?.walls ?? []) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
    if (L < 0.05) continue
    const ux = (w.b[0] - w.a[0]) / L, uz = (w.b[1] - w.a[1]) / L
    const s = { ax: w.a[0], az: w.a[1], bx: w.b[0], bz: w.b[1], t: 0 }
    ends.push({ x: w.a[0], z: w.a[1], ux: -ux, uz: -uz, s }, { x: w.b[0], z: w.b[1], ux, uz, s })
  }
  const endGrid = new Map<string, typeof ends>()
  for (const e of ends) { const k = `${Math.floor(e.x / CELL)},${Math.floor(e.z / CELL)}`; const l = endGrid.get(k); if (l) l.push(e); else endGrid.set(k, [e]) }
  const seen = new Set<string>()
  for (const e of ends) {
    const cx = Math.floor(e.x / CELL), cz = Math.floor(e.z / CELL)
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) for (const f of endGrid.get(`${x},${z}`) ?? []) {
      if (f.s === e.s) continue
      const dx = f.x - e.x, dz = f.z - e.z, d = Math.hypot(dx, dz)
      if (d < 0.6 || d > 3) continue
      // f lies straight ahead of e's wall, and the two walls face each other
      if ((dx * e.ux + dz * e.uz) / d < 0.97 || (-dx * f.ux - dz * f.uz) / d < 0.97) continue
      const mx = (e.x + f.x) / 2, mz = (e.z + f.z) / 2, key = `${mx.toFixed(1)},${mz.toFixed(1)}`
      if (seen.has(key) || crosses(g, [e.x + e.ux * 0.02, e.z + e.uz * 0.02], [f.x - f.ux * 0.02, f.z - f.uz * 0.02])) continue
      seen.add(key)
      const k = `${Math.floor(mx / CELL)},${Math.floor(mz / CELL)}`, gap = { x: mx, z: mz, w: d, ux: dx / d, uz: dz / d }
      const l = gg.get(k); if (l) l.push(gap); else gg.set(k, [gap])
    }
  }
  byLevel.set(li, gg)
  return gg
}
// a line drawn straight from a room to the corridor can cut through the room's wall: send it through the nearest doorway
function viaDoors(b: Building, li: number, pts: Vec2[], fixed: Set<Vec2>, doors: Map<Vec2, Vec2>): Vec2[] {
  const g = wallGrid(b, li), gaps = doorGaps(b, li)
  const out: Vec2[] = [pts[0]]
  const near = (p: Vec2, q: Vec2, r: number) => {
    const res: Gap[] = []
    for (let x = Math.floor((Math.min(p[0], q[0]) - r) / CELL); x <= Math.floor((Math.max(p[0], q[0]) + r) / CELL); x++)
      for (let z = Math.floor((Math.min(p[1], q[1]) - r) / CELL); z <= Math.floor((Math.max(p[1], q[1]) + r) / CELL); z++) res.push(...(gaps.get(`${x},${z}`) ?? []))
    return res
  }
  const D = (a: Vec2, c: Vec2) => Math.hypot(a[0] - c[0], a[1] - c[1])
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1], q = pts[i]
    if (crosses(g, p, q)) {
      const gs = near(p, q, 10), cand = gs.map(c => [c.x, c.z] as Vec2)
      let best: Vec2[] | null = null, bestL = D(p, q) * 3 + 25
      for (const a of cand) {
        const pa = D(p, a)
        if (pa + D(a, q) >= bestL || crosses(g, p, a)) continue
        if (!crosses(g, a, q)) { best = [a]; bestL = pa + D(a, q); continue }
        for (const c of cand) { // room -> door -> door -> corridor (e.g. through a lobby)
          if (c === a) continue
          const L = pa + D(a, c) + D(c, q)
          if (L < bestL && !crosses(g, a, c) && !crosses(g, c, q)) { best = [a, c]; bestL = L }
        }
      }
      if (best) for (const a of best) { out.push(a); fixed.add(a); const c = gs[cand.indexOf(a)]; doors.set(a, [-c.uz, c.ux]) }
    }
    out.push(q)
  }
  return out
}

const lineCache = new WeakMap<Building, Map<string, Vec2[]>>()
// pts: the route's points on one floor, in order; pin[i] = keep that point where it is (rooms, stairs, lifts)
export function drawnRoute(b: Building, li: number, pts: Vec2[], pin?: boolean[]): Vec2[] {
  let c = lineCache.get(b)
  if (!c) { c = new Map(); lineCache.set(b, c) }
  const key = `${li}|${pts.map((p, i) => `${p[0].toFixed(2)},${p[1].toFixed(2)}${pin?.[i] ? '!' : ''}`).join(';')}`
  const hit = c.get(key)
  if (hit) return hit
  const out = smooth(b, li, centre(b, li, pts, pin))
  if (c.size > 400) c.clear()
  c.set(key, out)
  return out
}

const MAX_HALF = 4.5 // corridors up to ~9 m wide get centred; wider spaces (halls, lobbies) are left as they are
function centre(b: Building, li: number, src: Vec2[], pin?: boolean[]): Vec2[] {
  const g = wallGrid(b, li)
  // drop points that sit on top of each other
  const raw: Vec2[] = [], fixed = new Set<Vec2>(), doors = new Map<Vec2, Vec2>() // doorway point -> across the doorway
  src.forEach((p, i) => {
    if (raw.length && Math.hypot(p[0] - raw[raw.length - 1][0], p[1] - raw[raw.length - 1][1]) <= 0.05) return
    const q: Vec2 = [p[0], p[1]]
    raw.push(q)
    if (pin?.[i]) fixed.add(q)
  })
  if (raw.length < 3) return square(g, viaDoors(b, li, raw, fixed, doors), doors)
  const pts = raw
  const out = pts.map(p => [p[0], p[1]] as Vec2)
  // distance to the wall on one side: the nearest of a few parallel rays a little ahead and behind, so a doorway
  // opening on that side (where one ray would carry on into the room) doesn't count as "no wall"
  const side = (p: Vec2, d: Vec2, nx: number, nz: number) => {
    let best = Infinity, wall: Seg | null = null
    for (const o of [0, 0.6, -0.6, 1.2, -1.2]) {
      const s: Vec2 = [p[0] + d[0] * o, p[1] + d[1] * o]
      if (o && crosses(g, p, s)) continue
      const t = ray(g, s[0], s[1], nx, nz, MAX_HALF * 2)
      if (t < best) { best = t; wall = lastHit }
    }
    return { t: best, wall }
  }
  const across = (p: Vec2, d: Vec2) => { const nx = -d[1], nz = d[0], a = side(p, d, nx, nz), c = side(p, d, -nx, -nz); return { nx, nz, a, c } }
  const shiftFor = (p: Vec2, d: Vec2) => { // move across direction d to the middle between the walls
    let { nx, nz, a, c } = across(p, d)
    if (!isFinite(a.t) || !isFinite(c.t)) return null
    // measure square to the corridor's walls, not to the way the route happens to cross it
    const w = a.t <= c.t ? a.wall : c.wall
    if (w) {
      const L = Math.hypot(w.bx - w.ax, w.bz - w.az), wd: Vec2 = [(w.bx - w.ax) / L, (w.bz - w.az) / L]
      if (Math.abs(wd[0] * d[0] + wd[1] * d[1]) > 0.7) { // the wall runs roughly along the way we're going
        const dd: Vec2 = wd[0] * d[0] + wd[1] * d[1] > 0 ? wd : [-wd[0], -wd[1]]
        const m = across(p, dd)
        if (isFinite(m.a.t) && isFinite(m.c.t)) ({ nx, nz, a, c } = m)
      }
    }
    if (a.t + c.t > MAX_HALF * 2) return null
    const s = (a.t - c.t) / 2
    return Math.abs(s) > 3 ? null : ([nx * s, nz * s] as Vec2)
  }
  const gaps = doorGaps(b, li)
  const doorAt = (a: Vec2, p: Vec2, n: Vec2): Gap | null => { // the doorway the route walks through at p, if any
    let best: Gap | null = null, d = Infinity
    for (let x = Math.floor((p[0] - 2) / CELL); x <= Math.floor((p[0] + 2) / CELL); x++)
      for (let z = Math.floor((p[1] - 2) / CELL); z <= Math.floor((p[1] + 2) / CELL); z++)
        for (const c of gaps.get(`${x},${z}`) ?? []) {
          const e = Math.hypot(c.x - p[0], c.z - p[1])
          if (e >= Math.max(0.8, c.w * 0.6) || e >= d) continue
          const sa = (a[0] - c.x) * c.uz - (a[1] - c.z) * c.ux, sn = (n[0] - c.x) * c.uz - (n[1] - c.z) * c.ux
          if (sa * sn < 0) { d = e; best = c } // the points before and after are on either side of that wall
        }
    return best
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]
    if (fixed.has(p)) continue
    const door = doorAt(pts[i - 1], p, pts[i + 1])
    if (door) { const m: Vec2 = [door.x, door.z]; if (!crosses(g, p, m)) { out[i] = m; doors.set(m, [-door.uz, door.ux]) } continue } // in a doorway: the middle of it
    const dIn = norm([p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]]), dOut = norm([pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]])
    if (!dIn || !dOut) continue
    const turn = dIn[0] * dOut[0] + dIn[1] * dOut[1] < 0.87 // more than ~30°
    let q: Vec2 | null = null
    if (!turn) { const d = norm([dIn[0] + dOut[0], dIn[1] + dOut[1]]) ?? dIn; const s = shiftFor(p, d); if (s) q = [p[0] + s[0], p[1] + s[1]] }
    else { // a turn: the middle of both corridors (shift across one, then the other, a few times: that settles on the junction's centre)
      let c: Vec2 = [p[0], p[1]], any = false
      for (let k = 0; k < 4; k++) for (const d of [dOut, dIn]) {
        const s = shiftFor(c, d)
        if (s && Math.hypot(s[0], s[1]) > 0.01) { c = [c[0] + s[0], c[1] + s[1]]; any = true }
      }
      if (any && Math.hypot(c[0] - p[0], c[1] - p[1]) <= 3) q = c
    }
    if (q && !crosses(g, p, q)) out[i] = q
  }
  // never draw through a wall: put back any point whose new line crosses one where the old one didn't
  for (let pass = 0; pass < 3; pass++) {
    let changed = false
    for (let i = 1; i < out.length - 1; i++) {
      if (out[i] === pts[i]) continue
      const bad = (crosses(g, out[i - 1], out[i]) && !crosses(g, pts[i - 1], pts[i])) || (crosses(g, out[i], out[i + 1]) && !crosses(g, pts[i], pts[i + 1]))
      if (bad) { out[i] = pts[i]; changed = true }
    }
    if (!changed) break
  }
  const via = square(g, viaDoors(b, li, out, fixed, doors), doors) // rooms: in and out through the doorway, not through the wall
  // straight runs: points that are now (almost) in line add nothing
  const keep: Vec2[] = [via[0]]
  for (let i = 1; i < via.length - 1; i++) {
    const a = keep[keep.length - 1], p = via[i], n = via[i + 1]
    const L = Math.hypot(n[0] - a[0], n[1] - a[1]) || 1, off = Math.abs((n[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (n[1] - a[1])) / L
    if (off > 0.12 || crosses(g, a, n)) keep.push(p)
  }
  keep.push(via[via.length - 1])
  return keep
}

// walk straight through a doorway (a short straight bit either side of it), not diagonally across it
function square(g: Map<string, Seg[]>, pts: Vec2[], doors: Map<Vec2, Vec2>): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], n = doors.get(p)
    if (!n || i === 0 || i === pts.length - 1) { out.push(p); continue }
    const a = pts[i - 1], c = pts[i + 1]
    const sg = (a[0] - p[0]) * n[0] + (a[1] - p[1]) * n[1] > 0 ? 1 : -1
    // no further than half way across the corridor / room on that side
    const k1 = Math.min(0.9, Math.hypot(a[0] - p[0], a[1] - p[1]) * 0.4, ray(g, p[0], p[1], n[0] * sg, n[1] * sg, 4) * 0.45)
    const k2 = Math.min(0.9, Math.hypot(c[0] - p[0], c[1] - p[1]) * 0.4, ray(g, p[0], p[1], -n[0] * sg, -n[1] * sg, 4) * 0.45)
    const pre: Vec2 = [p[0] + n[0] * k1 * sg, p[1] + n[1] * k1 * sg], post: Vec2 = [p[0] - n[0] * k2 * sg, p[1] - n[1] * k2 * sg]
    if (Math.min(k1, k2) > 0.2 && !crosses(g, out[out.length - 1], pre) && !crosses(g, pre, p) && !crosses(g, p, post) && !crosses(g, post, c)) out.push(pre, p, post)
    else out.push(p)
  }
  return out
}

// round the corners (a short curve instead of a sharp turn), only where the curve stays clear of walls
function smooth(b: Building, li: number, pts: Vec2[]): Vec2[] {
  if (pts.length < 3) return pts
  const g = wallGrid(b, li)
  const out: Vec2[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = pts[i - 1], n = pts[i + 1]
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]), ln = Math.hypot(n[0] - p[0], n[1] - p[1])
    let room = Infinity // tighter corners where it's tight (a doorway)
    for (let k = 0; k < 8; k++) room = Math.min(room, ray(g, p[0], p[1], Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4), 3))
    const r = Math.min(1.6, la * 0.45, ln * 0.45, Math.max(0.3, room * 1.2))
    if (r < 0.25) { out.push(p); continue }
    const s: Vec2 = [p[0] + ((a[0] - p[0]) * r) / la, p[1] + ((a[1] - p[1]) * r) / la], e: Vec2 = [p[0] + ((n[0] - p[0]) * r) / ln, p[1] + ((n[1] - p[1]) * r) / ln]
    const curve: Vec2[] = []
    for (let k = 0; k <= 4; k++) { const t = k / 4, u = 1 - t; curve.push([u * u * s[0] + 2 * u * t * p[0] + t * t * e[0], u * u * s[1] + 2 * u * t * p[1] + t * t * e[1]]) }
    let ok = true
    for (let k = 1; k < curve.length && ok; k++) if (crosses(g, curve[k - 1], curve[k])) ok = false
    if (ok) out.push(...curve); else out.push(p)
  }
  out.push(pts[pts.length - 1])
  return out
}

const norm = (v: Vec2): Vec2 | null => { const l = Math.hypot(v[0], v[1]); return l < 1e-6 ? null : [v[0] / l, v[1] / l] }

// how far a line stays from the walls (for checking): average and smallest clearance along it, and wall crossings
export function clearance(b: Building, li: number, pts: Vec2[]) {
  const g = wallGrid(b, li)
  let sum = 0, n = 0, min = Infinity, cross = 0
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i], L = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (crosses(g, p, q)) cross++
    for (let s = 0; s < L; s += 0.5) {
      const x = p[0] + ((q[0] - p[0]) * s) / L, z = p[1] + ((q[1] - p[1]) * s) / L
      let d = Infinity
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; d = Math.min(d, ray(g, x, z, Math.cos(a), Math.sin(a), 6)) }
      if (isFinite(d)) { sum += d; n++; min = Math.min(min, d) }
    }
  }
  return { mean: n ? sum / n : 0, min, cross }
}
