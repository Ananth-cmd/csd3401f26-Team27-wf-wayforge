/*!
 * \file buildingDetails.ts
 * \brief W1 library facade bands, projecting soffits, roof-edge canopy and upper columns.
 *
 * Uses the existing floor outlines. Only the exterior rendering changes;
 * floor plans, room positions and routing are left untouched.
 * Band dimensions are visual estimates, not architectural measurements.
 * AI declaration: ChatGPT assisted with the implementation and comments.
 */
import * as THREE from 'three'
import type { MassBlock } from '../massing'
import type { Vec2 } from '../types'
import { FLOOR } from '../campusTextures'

const SLAT_STARTS = [0.3, 0.75, 1.2, 1.65, 2.1, 2.55]
const SLAT_HEIGHT = 0.22
// Visual prototype: vary the silhouette by storey, without altering floor plans.
const BASE_DEPTH = 0.85
const MID_DEPTH = 1.65
const UPPER_DEPTH = 1.15
const SOFFIT_HEIGHT = 0.32
const SOFFIT_EXTENSION = 0.12
// The existing Campus3D hub parapet is 0.9 m tall. The canopy caps it.
// These dimensions are visual estimates, not surveyed roof geometry.
const HUB_PARAPET = 0.9
const CANOPY_DEPTH = 2.2
const CANOPY_THICKNESS = 0.32
// Prototype columns sit behind the upper red bands. The longest outer
// wall is a provisional placement, not a surveyed column location.
const COLUMN_RADIUS = 0.42
const COLUMN_OFFSET = 0.68
const COLUMN_SPACING = 9
const MAX_COLUMNS = 4
const ARC_STEP = Math.PI / 16 // segments at most 11.25 degrees apart
const EPS = 1e-6

type Own = <T extends { dispose: () => void }>(resource: T) => T
type Join = { points: Vec2[] }
type Strip = { ring: Vec2[]; joins: Join[] }
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const length = (a: Vec2) => Math.hypot(a[0], a[1])
const offset = (p: Vec2, n: Vec2, d: number): Vec2 => [p[0] + n[0] * d, p[1] + n[1] * d]

function cleanRing(input: Vec2[]): Vec2[] {
  const ring: Vec2[] = []
  for (const p of input) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return []
    if (!ring.length || length(sub(p, ring[ring.length - 1])) > EPS) ring.push(p)
  }
  if (ring.length > 1 && length(sub(ring[0], ring[ring.length - 1])) <= EPS) ring.pop()
  return ring
}

// Check for crossings, including touching non-neighbouring segments.
function intersects(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const ab = sub(b, a), cd = sub(d, c)
  const p = cross(ab, sub(c, a)), q = cross(ab, sub(d, a))
  const r = cross(cd, sub(a, c)), s = cross(cd, sub(b, c))
  const on = (x: Vec2, u: Vec2, v: Vec2) =>
    x[0] >= Math.min(u[0], v[0]) - EPS && x[0] <= Math.max(u[0], v[0]) + EPS &&
    x[1] >= Math.min(u[1], v[1]) - EPS && x[1] <= Math.max(u[1], v[1]) + EPS
  if (Math.abs(p) <= EPS && on(c, a, b)) return true
  if (Math.abs(q) <= EPS && on(d, a, b)) return true
  if (Math.abs(r) <= EPS && on(a, c, d)) return true
  if (Math.abs(s) <= EPS && on(b, c, d)) return true
  return ((p > EPS && q < -EPS) || (p < -EPS && q > EPS)) &&
    ((r > EPS && s < -EPS) || (r < -EPS && s > EPS))
}

// A convex corner gets an arc; a concave corner gets a miter join.
// Reject tight/invalid offsets and retry with a shallower band.
function makeStrip(ring: Vec2[], depth: number): Strip | null {
  const n = ring.length
  const dirs = ring.map((p, i) => {
    const d = sub(ring[(i + 1) % n], p), len = length(d)
    return [d[0] / len, d[1] / len] as Vec2
  })
  const joins: Join[] = []
  for (let i = 0; i < n; i++) {
    const p = ring[i], a = dirs[(i + n - 1) % n], b = dirs[i]
    const na: Vec2 = [a[1], -a[0]], nb: Vec2 = [b[1], -b[0]]
    const turn = Math.atan2(cross(a, b), dot(a, b))
    if (Math.abs(turn) > Math.PI - 1e-4) return null
    if (turn > EPS) {
      const count = Math.max(1, Math.ceil(turn / ARC_STEP))
      const start = Math.atan2(na[1], na[0])
      const points = Array.from({ length: count + 1 }, (_, j) => {
        const t = start + turn * j / count
        return offset(p, [Math.cos(t), Math.sin(t)], depth)
      })
      joins.push({ points })
    } else {
      const den = 1 + dot(na, nb)
      if (den <= EPS) return null
      const miter: Vec2 = [(na[0] + nb[0]) / den, (na[1] + nb[1]) / den]
      if (length(miter) > 4) return null
      joins.push({ points: [offset(p, miter, depth)] })
    }
  }
  // The straight band on every edge must still run forwards.
  for (let i = 0; i < n; i++) {
    const a = joins[i].points, b = joins[(i + 1) % n].points
    if (dot(sub(b[0], a[a.length - 1]), dirs[i]) <= EPS) return null
  }
  const outer = joins.flatMap(j => j.points)
  for (let i = 0; i < outer.length; i++) {
    for (let j = i + 2; j < outer.length; j++) {
      if (i === 0 && j === outer.length - 1) continue
      if (intersects(outer[i], outer[(i + 1) % outer.length], outer[j], outer[(j + 1) % outer.length])) return null
    }
    // Offset must not cross the original wall ring.
    for (let j = 0; j < n; j++) {
      if (intersects(outer[i], outer[(i + 1) % outer.length], ring[j], ring[(j + 1) % n])) return null
    }
  }
  return { ring, joins }
}

// Pure geometry generator: position triples in Three.js world coordinates.
// No rendering context is needed to check the generated triangles.
export function w1FacadePositions(mass: MassBlock[]) {
  const bands: number[] = [], soffits: number[] = [], canopy: number[] = []
  let pos = bands
  const vertex = (p: Vec2, y: number) => { pos.push(p[0], y, -p[1]) }
  const flat = (a: Vec2, b: Vec2, c: Vec2, lo: number, hi: number) => {
    if (Math.abs(cross(sub(b, a), sub(c, a))) <= EPS) return
    vertex(a, hi); vertex(b, hi); vertex(c, hi)
    vertex(c, lo); vertex(b, lo); vertex(a, lo)
  }
  const side = (a: Vec2, b: Vec2, lo: number, hi: number) => {
    vertex(a, lo); vertex(b, lo); vertex(b, hi)
    vertex(a, lo); vertex(b, hi); vertex(a, hi)
  }
  const band = (strip: Strip, lo: number, hi: number, closeInner = false) => {
    const { ring, joins } = strip
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length
      const p = ring[i], q = ring[j], arc = joins[i].points
      const a = arc[arc.length - 1], b = joins[j].points[0]
      // Top/bottom of the straight strip plus its outward vertical face.
      flat(p, a, b, lo, hi); flat(p, b, q, lo, hi)
      side(a, b, lo, hi)
      if (closeInner) side(q, p, lo, hi)
      // Close the rounded corner with a small triangle fan.
      for (let k = 1; k < arc.length; k++) {
        flat(p, arc[k - 1], arc[k], lo, hi)
        side(arc[k - 1], arc[k], lo, hi)
      }
    }
  }
  for (const block of mass) {
    if (block.name.toUpperCase() !== 'W1') continue
    const levels = [...block.levels].sort((a, b) => a.elev - b.elev)
    for (const [index, level] of levels.entries()) {
      const relative = levels.length > 1 ? index / (levels.length - 1) : 0
      const depth = relative < 0.25 ? BASE_DEPTH : relative < 0.75 ? MID_DEPTH : UPPER_DEPTH
      const low = level.elev, high = low + level.h
      if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) continue
      for (const raw of level.rings) {
        const ring = cleanRing(raw)
        if (ring.length < 3) continue
        // Massing outer rings are counterclockwise; skip courtyard holes.
        const area = ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0)
        if (area <= EPS) continue
        // Cap only the top storey's exterior outline, leaving the solar-panel roof open.
        if (index === levels.length - 1) {
          for (const candidate of [CANOPY_DEPTH, CANOPY_DEPTH / 2, CANOPY_DEPTH / 4]) {
            const eave = makeStrip(ring, candidate)
            if (!eave) continue
            pos = canopy
            band(eave, high + HUB_PARAPET, high + HUB_PARAPET + CANOPY_THICKNESS, true)
            pos = bands
            break
          }
        }
        let strip: Strip | null = null
        let usedDepth = depth
        for (const candidate of [depth, depth / 2, depth / 4, depth / 8]) {
          strip = makeStrip(ring, candidate)
          if (strip) { usedDepth = candidate; break }
        }
        if (!strip) continue // leave the original glass wall if a ring is too complex
        // A pale horizontal soffit marks the underside of each upper storey.
        // Use the same validated outline; fall back to the red band's depth.
        if (index > 0 && low >= 0 && level.h >= SOFFIT_HEIGHT) {
          const ledge = makeStrip(ring, usedDepth + SOFFIT_EXTENSION) ?? strip
          pos = soffits
          band(ledge, low, low + SOFFIT_HEIGHT)
          pos = bands
        }
        for (let cycle = Math.floor(low / FLOOR); cycle * FLOOR < high; cycle++) {
          for (const start of SLAT_STARTS) {
            const y0 = Math.max(low + (index > 0 && low >= 0 && level.h >= SOFFIT_HEIGHT ? SOFFIT_HEIGHT : 0), cycle * FLOOR + start)
            const y1 = Math.min(high, cycle * FLOOR + start + SLAT_HEIGHT)
            if (y1 - y0 >= 0.02) band(strip, y0, y1)
          }
        }
      }
    }
  }
  return { bands, soffits, canopy }
}

export function w1BandPositions(mass: MassBlock[]): number[] {
  return w1FacadePositions(mass).bands
}

export type W1Column = { x: number; z: number; bottom: number; top: number }

function insideRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) &&
        p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

function distanceToEdge(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a), ap = sub(p, a), len2 = dot(ab, ab)
  const t = len2 > EPS ? Math.max(0, Math.min(1, dot(ap, ab) / len2)) : 0
  return length(sub(p, offset(a, ab, t)))
}

// Keep columns outside the original walls and away from neighbouring mass
// (including bridges). This is a geometric clearance check, not a route test.
function overlapsMass(p: Vec2, bottom: number, top: number, mass: MassBlock[]): boolean {
  for (const block of mass) for (const level of block.levels) {
    if (level.elev >= top || level.elev + level.h <= bottom) continue
    let inSolid = false
    for (const raw of level.rings) {
      const ring = cleanRing(raw)
      if (ring.length < 3) continue
      if (insideRing(p, ring)) inSolid = !inSolid
      for (let i = 0; i < ring.length; i++) {
        if (distanceToEdge(p, ring[i], ring[(i + 1) % ring.length]) < COLUMN_RADIUS + 0.05) return true
      }
    }
    if (inSolid) return true
  }
  return false
}

// Pure placement function. Only the uppermost exterior storey is decorated;
// do not add columns to the ground floor or across pedestrian entrances.
export function w1ColumnPlacements(mass: MassBlock[]): W1Column[] {
  const out: W1Column[] = []
  for (const block of mass) {
    if (block.name.toUpperCase() !== 'W1') continue
    const levels = [...block.levels].sort((a, b) => a.elev - b.elev)
    if (levels.length < 2) continue
    const level = levels[levels.length - 1]
    if (!Number.isFinite(level.elev) || !Number.isFinite(level.h) || level.elev <= 0 || level.h < 2.5) continue
    const bottom = level.elev + SOFFIT_HEIGHT
    const top = level.elev + level.h + HUB_PARAPET
    const edges: { a: Vec2; b: Vec2; len: number }[] = []
    for (const raw of level.rings) {
      const ring = cleanRing(raw)
      if (ring.length < 3 || ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0) <= EPS) continue
      // Only place columns when the eave and floor ledge can reach them.
      // Use the same fallback depths as the existing canopy and soffit.
      const eaveDepth = [CANOPY_DEPTH, CANOPY_DEPTH / 2, CANOPY_DEPTH / 4].find(d => makeStrip(ring, d))
      const redDepth = [UPPER_DEPTH, UPPER_DEPTH / 2, UPPER_DEPTH / 4, UPPER_DEPTH / 8].find(d => makeStrip(ring, d))
      if (eaveDepth === undefined || redDepth === undefined) continue
      const ledgeDepth = makeStrip(ring, redDepth + SOFFIT_EXTENSION) ? redDepth + SOFFIT_EXTENSION : redDepth
      if (Math.min(eaveDepth, ledgeDepth) < COLUMN_OFFSET + COLUMN_RADIUS) continue
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length], len = length(sub(b, a))
        if (len >= 12) edges.push({ a, b, len })
      }
    }
    // One face for the initial visual prototype; tune against actual photos.
    edges.sort((a, b) => b.len - a.len)
    for (const { a, b, len } of edges) {
      const dir = sub(b, a).map(v => v / len) as Vec2
      const normal: Vec2 = [dir[1], -dir[0]]
      const count = Math.min(MAX_COLUMNS, Math.max(2, Math.floor(len / COLUMN_SPACING)))
      const placements: W1Column[] = []
      for (let i = 0; i < count; i++) {
        const p = offset(offset(a, dir, len * (i + 1) / (count + 1)), normal, COLUMN_OFFSET)
        if (!overlapsMass(p, bottom, top, mass)) placements.push({ x: p[0], z: p[1], bottom, top })
      }
      if (placements.length >= 2) { out.push(...placements); break }
    }
  }
  return out
}

export function addW1BuildingDetails(scene: THREE.Scene, mass: MassBlock[], tint: string | undefined, own: Own) {
  const { bands, soffits, canopy } = w1FacadePositions(mass)
  const red = new THREE.Color('#d95740')
  const pale = new THREE.Color('#e5dfd3')
  if (tint) { red.multiply(new THREE.Color(tint)); pale.multiply(new THREE.Color(tint)) }

  const addMesh = (positions: number[], colour: THREE.Color, name: string) => {
    if (!positions.length) return
    const geometry = own(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    const material = own(new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85, metalness: 0 }))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = name
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  }

  addMesh(bands, red, 'W1 landmark - layered red facade bands')
  addMesh(soffits, pale, 'W1 landmark - projecting pale soffits')
  addMesh(canopy, pale, 'W1 landmark - white roof-edge canopy')

  const columns = w1ColumnPlacements(mass)
  if (columns.length) {
    const geometry = own(new THREE.CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS, 1, 16))
    const material = own(new THREE.MeshStandardMaterial({ color: pale, roughness: 0.85, metalness: 0 }))
    const mesh = new THREE.InstancedMesh(geometry, material, columns.length)
    const transform = new THREE.Matrix4()
    columns.forEach((c, i) => {
      transform.makeScale(1, c.top - c.bottom, 1).setPosition(c.x, (c.top + c.bottom) / 2, -c.z)
      mesh.setMatrixAt(i, transform)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.name = 'W1 landmark - upper concrete columns'
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
  }
}
