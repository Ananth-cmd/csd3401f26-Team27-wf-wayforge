// 3D campus view: each block as a building, one slab per floor, worked out from the room outlines the backend already
// sends (each level's `floors` are the room polygons). For every block and floor the rooms are drawn onto a 0.5 m grid
// (turned to line up with the block, so angled blocks stay crisp), small gaps between rooms are closed, and the outline
// is traced and simplified. Done once per building.
import type { Building, Vec2 } from './types'

// what the outline work needs (small enough to hand to a background worker)
export type MassInput = { floorHeight: number; levels: { floors: Vec2[][]; elevation: number }[]; places: { x: number; z: number; level: number; bl: string }[] }

export type MassLevel = { level: number; elev: number; h: number; rings: Vec2[][] } // outer rings + holes (courtyards)
export type MassBlock = { name: string; levels: MassLevel[]; centre: Vec2; box: [number, number, number, number]; top: number }

const CELL = 1 // metres per grid cell (plenty for a whole-building outline)
export const blockOf = (s: string) => /^([A-Za-z]{1,2}\d{1,2})[-_]/.exec(s.trim())?.[1]?.toUpperCase()

const inPoly = (x: number, z: number, poly: Vec2[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// main direction of a block's walls (0..90°), so the grid lines up with it
function mainAngle(polys: Vec2[][]) {
  const bins = new Float64Array(90)
  for (const f of polys) for (let i = 0; i < f.length; i++) {
    const p = f[i], q = f[(i + 1) % f.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz)
    if (len < 0.5) continue
    let a = (Math.atan2(dz, dx) * 180) / Math.PI
    a = ((a % 90) + 90) % 90
    bins[Math.floor(a) % 90] += len
  }
  let best = 0
  for (let i = 1; i < 90; i++) if (bins[i] > bins[best]) best = i
  return ((best + 0.5) * Math.PI) / 180
}

// outline of the filled cells as closed rings (filled side on the left), in grid units
function trace(grid: Uint8Array, w: number, h: number): Vec2[][] {
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && grid[y * w + x] === 1
  const out = new Map<string, Vec2[]>() // vertex -> outgoing edge ends
  const add = (a: Vec2, b: Vec2) => { const k = `${a[0]},${a[1]}`; const l = out.get(k); if (l) l.push(b); else out.set(k, [b]) }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!filled(x, y)) continue
    if (!filled(x, y - 1)) add([x, y], [x + 1, y]) // edges run with the filled cell on the left (y down)
    if (!filled(x + 1, y)) add([x + 1, y], [x + 1, y + 1])
    if (!filled(x, y + 1)) add([x + 1, y + 1], [x, y + 1])
    if (!filled(x - 1, y)) add([x, y + 1], [x, y])
  }
  const rings: Vec2[][] = []
  for (const [k0, list] of out) {
    while (list.length) {
      const start = k0.split(',').map(Number) as Vec2, ring: Vec2[] = [start]
      let cur = list.pop()!
      while (`${cur[0]},${cur[1]}` !== k0) {
        ring.push(cur)
        const next = out.get(`${cur[0]},${cur[1]}`)
        if (!next || !next.length) break
        cur = next.pop()!
      }
      if (ring.length >= 4) rings.push(ring)
    }
  }
  return rings
}

// Douglas-Peucker on a closed ring
function simplify(ring: Vec2[], tol: number): Vec2[] {
  if (ring.length < 5) return ring
  // split at the two points farthest apart so the ring becomes two open lines
  let far = 0, fd = -1
  for (let i = 1; i < ring.length; i++) { const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2; if (d > fd) { fd = d; far = i } }
  const line = (pts: Vec2[]): Vec2[] => {
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
    const stack: [number, number][] = [[0, pts.length - 1]]
    while (stack.length) {
      const [i, j] = stack.pop()!, [ax, az] = pts[i], [bx, bz] = pts[j], L = Math.hypot(bx - ax, bz - az) || 1
      let best = -1, bi = -1
      for (let k = i + 1; k < j; k++) { const d = Math.abs((bx - ax) * (az - pts[k][1]) - (ax - pts[k][0]) * (bz - az)) / L; if (d > best) { best = d; bi = k } }
      if (best > tol) { keep[bi] = 1; stack.push([i, bi], [bi, j]) }
    }
    return pts.filter((_, i) => keep[i])
  }
  const a = line(ring.slice(0, far + 1)), b = line([...ring.slice(far), ring[0]])
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

export function massInput(b: Building, node: Map<string, { level: number; pos: Vec2 }>): MassInput {
  const places: MassInput['places'] = []
  for (const p of b.pois) {
    const n = node.get(p.node)
    const bl = n && (blockOf(p.code) ?? blockOf(p.name.replace(/^Room\s+/i, '')) ?? blockOf(p.id.replace(/^[^:]*:/, '')))
    if (n && bl) places.push({ x: n.pos[0], z: n.pos[1], level: n.level, bl })
  }
  return { floorHeight: b.floorHeight, levels: b.levels.map(l => ({ floors: l.floors, elevation: l.elevation })), places }
}

export function buildMassing(b: MassInput): MassBlock[] {
  const byBlock = new Map<string, Map<number, Vec2[][]>>()
  // places grouped by floor, with their block
  const placesOn = b.levels.map(() => [] as { x: number; z: number; bl: string }[])
  for (const p of b.places) placesOn[p.level]?.push(p)
  b.levels.forEach((lvl, li) => {
    const polys = lvl.floors
    if (polys.length < 2) return
    const box = polys.map(f => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of f) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) } return [x0, x1, z0, z1] })
    const owner: (string | undefined)[] = polys.map(() => undefined)
    for (const { x, z, bl } of placesOn[li]) {
      for (let i = 0; i < polys.length; i++) { const q = box[i]; if (!owner[i] && x >= q[0] && x <= q[1] && z >= q[2] && z <= q[3] && inPoly(x, z, polys[i])) { owner[i] = bl; break } }
    }
    // rooms without a place: the block of the nearest room that has one (within 15 m)
    const mx = box.map(q => (q[0] + q[1]) / 2), mz = box.map(q => (q[2] + q[3]) / 2)
    const known = owner.map((o, i) => (o ? i : -1)).filter(i => i >= 0)
    for (let i = 0; i < polys.length; i++) {
      if (owner[i]) continue
      let bd = 15 * 15
      for (const j of known) { const d = (mx[i] - mx[j]) ** 2 + (mz[i] - mz[j]) ** 2; if (d < bd) { bd = d; owner[i] = owner[j] } }
    }
    polys.forEach((f, i) => {
      const bl = owner[i]; if (!bl) return
      const m = byBlock.get(bl) ?? new Map<number, Vec2[][]>(); byBlock.set(bl, m)
      const l = m.get(li) ?? []; l.push(f); m.set(li, l)
    })
  })

  const elevs = b.levels.map(l => l.elevation)
  const out: MassBlock[] = []
  for (const [name, levels] of byBlock) {
    const all = [...levels.values()].flat()
    const ang = mainAngle(all), c = Math.cos(ang), s = Math.sin(ang)
    const rot = ([x, z]: Vec2): Vec2 => [x * c + z * s, -x * s + z * c] // into the block's own frame
    const unrot = ([u, v]: Vec2): Vec2 => [u * c - v * s, u * s + v * c]
    const mass: MassLevel[] = []
    for (const [li, polys] of [...levels].sort((p, q) => p[0] - q[0])) {
      const rp = polys.map(f => f.map(rot))
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
      for (const f of rp) for (const [u, v] of f) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v) }
      u0 -= 2; v0 -= 2; u1 += 2; v1 += 2
      const w = Math.ceil((u1 - u0) / CELL), h = Math.ceil((v1 - v0) / CELL)
      if (w * h > 4e6) continue // something odd in the data; skip rather than hang
      let grid = new Uint8Array(w * h)
      // scanline fill: per grid row, where the row's centre line crosses the room outline
      const xs: number[] = []
      for (const f of rp) {
        const n = f.length, U = new Float64Array(n), V = new Float64Array(n)
        let b0 = Infinity, b1 = -Infinity
        for (let i = 0; i < n; i++) { U[i] = f[i][0]; V[i] = f[i][1]; if (V[i] < b0) b0 = V[i]; if (V[i] > b1) b1 = V[i] }
        for (let y = Math.max(0, Math.floor((b0 - v0) / CELL)); y <= Math.min(h - 1, Math.ceil((b1 - v0) / CELL)); y++) {
          const cv = v0 + (y + 0.5) * CELL
          xs.length = 0
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const vi = V[i], vj = V[j]
            if ((vi > cv) !== (vj > cv)) xs.push(U[i] + ((cv - vi) * (U[j] - U[i])) / (vj - vi))
          }
          xs.sort((p, q) => p - q)
          for (let k = 0; k + 1 < xs.length; k += 2) {
            const xa = Math.max(0, Math.round((xs[k] - u0) / CELL - 0.5)), xb = Math.min(w - 1, Math.round((xs[k + 1] - u0) / CELL - 0.5))
            for (let x = xa; x <= xb; x++) grid[y * w + x] = 1
          }
        }
      }
      // close the gaps the walls leave between rooms (grow by a cell, then shrink by one)
      const step = (src: Uint8Array, grow: boolean) => {
        const dst = new Uint8Array(w * h)
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let v = grow ? 0 : 1
          for (let dy = -1; dy <= 1 && v === (grow ? 0 : 1); dy++) for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx, Y = y + dy, on = X >= 0 && Y >= 0 && X < w && Y < h && src[Y * w + X] === 1
            if (grow ? on : !on) { v = grow ? 1 : 0; break }
          }
          dst[y * w + x] = v
        }
        return dst
      }
      grid = step(step(grid, true), false)
      const rings = trace(grid, w, h)
        .map(r => simplify(r, 1.2).map(([gx, gy]) => unrot([u0 + gx * CELL, v0 + gy * CELL])))
        .filter(r => r.length >= 3 && Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0)) / 2 > 12) // drop specks
      if (!rings.length) continue
      const e = elevs[li] ?? li * b.floorHeight
      const next = elevs.filter(x => x > e).sort((p, q) => p - q)[0]
      mass.push({ level: li, elev: e, h: Math.min(6, (next ?? e + b.floorHeight) - e) || b.floorHeight, rings })
    }
    if (!mass.length) continue
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const m of mass) for (const r of m.rings) for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    const topL = mass[mass.length - 1]
    out.push({ name, levels: mass, centre: [(x0 + x1) / 2, (z0 + z1) / 2], box: [x0, x1, z0, z1], top: topL.elev + topL.h })
  }
  return out
}
