/*!
 * \file roadDetails.ts
 * \brief Draw subtle road and pavement edges in the 3D campus view.
 * Uses the existing road centre lines and widths, in metres. The strips
 * are decorative surface edges, not surveyed kerbs or traffic markings.
 * AI declaration: ChatGPT assisted with implementation and comments.
 */
import * as THREE from 'three'
import type { Site, Vec2 } from '../types'

type Own = <T extends { dispose: () => void }>(resource: T) => T
type Segment = { a: Vec2; b: Vec2; length: number; half: number; kind: string }
type Strip = { corners: [Vec2, Vec2, Vec2, Vec2]; y: number; colour: string }
const ROAD_EDGE = '#929da1'
const PATH_EDGE = '#c9bea5'
const CYCLE_EDGE = '#bba98d'
const PIECE = 2 // Short pieces allow the edges to stop near junctions.

function distanceToSegment(p: Vec2, s: Segment): number {
  const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dz) / (s.length * s.length)))
  return Math.hypot(p[0] - s.a[0] - t * dx, p[1] - s.a[1] - t * dz)
}

// Pure geometry generation: independent of the camera and renderer.
export function roadEdgeStrips(roads: Site['roads']): Strip[] {
  const segments: Segment[] = []
  for (const r of roads) {
    if (!['road', 'path', 'cycle'].includes(r.kind) || !Number.isFinite(r.width) || r.width <= 0) continue
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i]
      if (![...a, ...b].every(Number.isFinite)) continue
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 0.05) continue
      segments.push({ a, b, length, half: r.width / 2, kind: r.kind })
    }
  }
  const strips: Strip[] = []
  for (const s of segments) {
    const road = s.kind === 'road'
    if (s.half < (road ? 1.5 : 0.55)) continue
    const ux = (s.b[0] - s.a[0]) / s.length, uz = (s.b[1] - s.a[1]) / s.length
    const nx = -uz, nz = ux
    const width = Math.min(road ? 0.44 : 0.22, s.half * 0.23)
    const inset = Math.min(road ? 0.16 : 0.08, s.half * 0.1)
    const offset = s.half - inset - width / 2
    const at = (t: number, d: number): Vec2 => [s.a[0] + ux * t + nx * d, s.a[1] + uz * t + nz * d]
    // Avoid square edge caps at road endpoints; overlapping road segments
    // are also excluded below so junctions do not acquire false lane lines.
    const trim = Math.min(road ? 0.6 : 0.25, s.length / 4)
    for (const sign of [-1, 1]) {
      const d = sign * offset
      for (let start = trim; start < s.length - trim - 0.05; start += PIECE) {
        const end = Math.min(start + PIECE, s.length - trim)
        const mid = at((start + end) / 2, d)
        // Bounding circle around the entire strip. Conservative: suppress
        // decoration anywhere it could overlap another road/path surface.
        const radius = Math.hypot((end - start) / 2, width / 2) + 0.12
        const blocked = segments.some(o => {
          if (o === s || (road && o.kind !== 'road')) return false
          const reach = o.half + radius
          if (mid[0] < Math.min(o.a[0], o.b[0]) - reach || mid[0] > Math.max(o.a[0], o.b[0]) + reach ||
              mid[1] < Math.min(o.a[1], o.b[1]) - reach || mid[1] > Math.max(o.a[1], o.b[1]) + reach) return false
          return distanceToSegment(mid, o) <= reach
        })
        if (blocked) continue
        strips.push({ corners: [at(start, d - width / 2), at(end, d - width / 2), at(end, d + width / 2), at(start, d + width / 2)],
          y: road ? -0.09 : -0.135, colour: road ? ROAD_EDGE : s.kind === 'cycle' ? CYCLE_EDGE : PATH_EDGE })
      }
    }
  }
  return strips
}

// Batch all edges into one mesh, using the original renderer's coordinate
// convention [x, z] -> (x, y, -z). No routing or floor-plan data is changed.
export function addRoadDetails(scene: THREE.Scene, site: Site, own: Own) {
  const strips = roadEdgeStrips(site.roads)
  if (!strips.length) return
  const positions: number[] = [], normals: number[] = [], colours: number[] = []
  const colour = new THREE.Color()
  for (const strip of strips) {
    colour.set(strip.colour)
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [x, z] = strip.corners[i]
      positions.push(x, strip.y, -z)
      normals.push(0, 1, 0)
      colours.push(colour.r, colour.g, colour.b)
    }
  }
  const geometry = own(new THREE.BufferGeometry())
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
  const material = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }))
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'Campus landmarks - road and pavement edges'
  mesh.receiveShadow = true
  scene.add(mesh)
}
