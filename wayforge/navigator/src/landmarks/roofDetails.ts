/*!
 * \file roofDetails.ts
 * \brief Projecting white roof-edge caps for W3, W5 and W6.
 * Extends the existing 0.9 m parapet, preserving the original roof and solar panels.
 * Dimensions are visual estimates, not surveyed geometry.
 * AI declaration: ChatGPT assisted with implementation and comments.
 */
import * as THREE from 'three'
import type { MassBlock } from '../massing'
import type { Vec2 } from '../types'

const HEART_BLOCKS = new Set(['W3', 'W5', 'W6'])
const PARAPET_HEIGHT = 0.9 // matches Campus3D's CANOPY constant
const CAP_DEPTH = 1.6
const CAP_THICKNESS = 0.28
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

// Pure triangle generation in the renderer's world coordinates (x, y, -z).
// Only exterior rings of the top storey receive a cap. Tight corners retry
// with a smaller projection; if no valid offset exists, keep the original rim.
export function heartRoofPositions(mass: MassBlock[]) {
  const result: { block: string; positions: number[] }[] = []
  for (const block of mass) {
    if (!HEART_BLOCKS.has(block.name.toUpperCase())) continue
    const level = block.levels[block.levels.length - 1]
    if (!level || !Number.isFinite(level.elev) || !Number.isFinite(level.h) || level.h <= 0) continue
    const lo = level.elev + level.h + PARAPET_HEIGHT - 0.04
    const hi = lo + CAP_THICKNESS
    const positions: number[] = []
    const vertex = (p: Vec2, y: number) => positions.push(p[0], y, -p[1])
    const flat = (a: Vec2, b: Vec2, c: Vec2) => {
      const area = cross(sub(b, a), sub(c, a))
      if (Math.abs(area) <= EPS) return
      // +Y normal for the upper surface, -Y for the underside.
      if (area < 0) [b, c] = [c, b]
      vertex(a, hi); vertex(b, hi); vertex(c, hi)
      vertex(c, lo); vertex(b, lo); vertex(a, lo)
    }
    const side = (a: Vec2, b: Vec2) => {
      if (length(sub(b, a)) <= EPS) return
      vertex(a, lo); vertex(b, lo); vertex(b, hi)
      vertex(a, lo); vertex(b, hi); vertex(a, hi)
    }
    for (const raw of level.rings) {
      const ring = cleanRing(raw)
      if (ring.length < 3 || ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0) <= EPS) continue
      let strip: Strip | null = null
      for (const depth of [CAP_DEPTH, CAP_DEPTH / 2, CAP_DEPTH / 4]) {
        strip = makeStrip(ring, depth)
        if (strip) break
      }
      if (!strip) continue
      const { joins } = strip
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length
        const p = ring[i], q = ring[j], arc = joins[i].points
        const a = arc[arc.length - 1], b = joins[j].points[0]
        flat(p, a, b); flat(p, b, q)
        side(a, b); side(q, p)
        for (let k = 1; k < arc.length; k++) {
          flat(p, arc[k - 1], arc[k]); side(arc[k - 1], arc[k])
        }
      }
    }
    if (positions.length) result.push({ block: block.name, positions })
  }
  return result
}

export function addHeartRoofDetails(
  scene: THREE.Scene,
  mass: MassBlock[],
  blockColours: Record<string, string> | undefined,
  own: Own,
) {
  const positions: number[] = [], colours: number[] = []
  for (const part of heartRoofPositions(mass)) {
    const colour = new THREE.Color(blockColours?.[part.block] ?? '#f4f2ec')
    // Use a loop rather than spreading potentially large geometry arrays.
    for (let i = 0; i < part.positions.length; i += 3) {
      positions.push(part.positions[i], part.positions[i + 1], part.positions[i + 2])
      colours.push(colour.r, colour.g, colour.b)
    }
  }
  if (!positions.length) return
  const geometry = own(new THREE.BufferGeometry())
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  const material = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 }))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'Campus Heart projecting roof edges'
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
}
