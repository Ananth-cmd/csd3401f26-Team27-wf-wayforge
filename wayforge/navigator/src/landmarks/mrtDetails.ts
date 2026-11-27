/*!
 * \file mrtDetails.ts
 * \brief Physical MRT exit signage in the exterior campus scene.
 * Uses the existing site landmark positions and nearby building edges.
 * Placement and dimensions are approximate, not surveyed entrance geometry.
 * AI declaration: ChatGPT assisted with implementation and comments.
 */
import * as THREE from 'three'
import type { Building, Site, Vec2 } from '../types'

type Own = <T extends { dispose: () => void }>(resource: T) => T
type Placement = { exit: string; pos: Vec2; normal: Vec2; width: number; mounted: boolean }
const MAX_EDGE_DISTANCE = 10
const SIGN_WIDTH = 6
const SIGN_HEIGHT = 1.15

function inside(p: Vec2, poly: Vec2[]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit
  }
  return hit
}
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
}
function area(poly: Vec2[]) {
  return poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)
}
function onRoad(p: Vec2, site: Site) {
  return site.roads.some(r => r.kind === 'road' && r.points.some((q, i) => i > 0 && distanceToSegment(p, r.points[i - 1], q) < r.width / 2 + 0.45))
}

// Only explicit numbered MRT exits are decorated, not the generic station pin.
// Prefer a shallow facade-mounted sign; if no safe wall is nearby, use a
// small freestanding sign only on unobstructed land. Never move the map pin.
export function mrtPlacements(building: Building): Placement[] {
  const site = building.surroundings
  if (!site) return []
  const out: Placement[] = []
  const campus = building.levels.filter(l => Math.abs(l.elevation) < 0.5).flatMap(l => l.floors)
  const water = site.areas.filter(a => a.kind === 'water').map(a => a.polygon)
  const solid = [...campus, ...site.buildings.map(b => b.polygon)]
  const clear = (p: Vec2) => !onRoad(p, site) && !water.some(r => inside(p, r))
  const seen = new Set<string>()
  for (const m of site.landmarks) {
    const exit = /\bexit\s*([0-9]+[a-z]?)\b/i.exec(m.name)?.[1]?.toUpperCase()
    if (m.kind.toLowerCase() !== 'mrt' || !exit || seen.has(exit) || !m.pos.every(Number.isFinite)) continue
    const p = m.pos
    let best: Placement | undefined, bestDist = MAX_EDGE_DISTANCE
    for (const b of site.buildings) {
      const ring = b.polygon, winding = area(ring)
      if (ring.length < 3 || Math.abs(winding) < 0.01 || b.levels * 3.6 < 3.2) continue
      // Do not attach the station sign to an unrelated named neighbour.
      if (!/mrt|station|punggol coast|nexus|digital district/i.test(b.name) || /bus|interchange|hawker/i.test(b.name)) continue
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], q = ring[(i + 1) % ring.length]
        const dx = q[0] - a[0], dz = q[1] - a[1], len = Math.hypot(dx, dz)
        if (len < SIGN_WIDTH + 1) continue
        const ux = dx / len, uz = dz / len, sign = winding > 0 ? 1 : -1
        const normal: Vec2 = [sign * uz, -sign * ux]
        const margin = SIGN_WIDTH / 2 + 0.5
        const s = Math.max(margin, Math.min(len - margin, (p[0] - a[0]) * ux + (p[1] - a[1]) * uz))
        const pos: Vec2 = [a[0] + s * ux, a[1] + s * uz]
        const d = Math.hypot(p[0] - pos[0], p[1] - pos[1])
        if (d >= bestDist) continue
        const probes = [-SIGN_WIDTH / 2, 0, SIGN_WIDTH / 2].map(t => [pos[0] + ux * t + normal[0] * 0.45, pos[1] + uz * t + normal[1] * 0.45] as Vec2)
        if (probes.some(v => !clear(v) || solid.some(r => inside(v, r)))) continue
        best = { exit, pos, normal, width: SIGN_WIDTH, mounted: true }; bestDist = d
      }
    }
    if (!best) {
      // Compact freestanding model. Test its full approximate footprint.
      const probes: Vec2[] = [[p[0], p[1]], [p[0] - 1.8, p[1] - 0.6], [p[0] + 1.8, p[1] - 0.6], [p[0] - 1.8, p[1] + 0.6], [p[0] + 1.8, p[1] + 0.6]]
      if (probes.every(v => clear(v) && !solid.some(r => inside(v, r)) && v[0] >= site.bounds[0] && v[0] <= site.bounds[2] && v[1] >= site.bounds[1] && v[1] <= site.bounds[3])) best = { exit, pos: p, normal: [0, -1], width: 3.2, mounted: false }
    }
    if (best) { out.push(best); seen.add(exit) }
  }
  return out
}

function signTexture(exit: string, own: Own) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 160
  const g = c.getContext('2d')!
  g.fillStyle = '#183e48'; g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#843d99'; g.fillRect(20, 39, 132, 82)
  g.fillStyle = '#fff'; g.font = 'bold 45px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('NE18', 86, 81)
  g.font = 'bold 48px Arial'; g.fillText('Punggol Coast', 390, 81)
  g.fillStyle = '#f5d049'; g.fillRect(638, 39, 105, 82)
  g.fillStyle = '#24363a'; g.font = 'bold 58px Arial'; g.fillText(exit, 690, 81, 94)
  const texture = own(new THREE.CanvasTexture(c)); texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export function addMrtDetails(scene: THREE.Scene, building: Building, own: Own) {
  const placements = mrtPlacements(building)
  if (!placements.length) return
  const cube = own(new THREE.BoxGeometry(1, 1, 1))
  const concrete = own(new THREE.MeshStandardMaterial({ color: '#d9d9d1', roughness: 0.88 }))
  const metal = own(new THREE.MeshStandardMaterial({ color: '#484f51', roughness: 0.68 }))
  for (const p of placements) {
    const group = new THREE.Group()
    group.name = `MRT exit ${p.exit} - illustrative physical sign`
    group.position.set(p.pos[0], 0, -p.pos[1])
    // The sign's local positive Z points out of the wall in scene coordinates.
    group.rotation.y = Math.atan2(p.normal[0], -p.normal[1])
    const box = (mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) => {
      const mesh = new THREE.Mesh(cube, mat); mesh.position.set(x, y, z); mesh.scale.set(w, h, d)
      mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh)
    }
    const y = p.mounted ? 2.65 : 2.0, h = p.mounted ? SIGN_HEIGHT : 0.8
    if (p.mounted) {
      // Shallow architectural surround; does not pretend to cut a door into the wall.
      box(concrete, 0, y, 0.09, p.width + 0.6, h + 0.42, 0.18)
      box(metal, 0, y, 0.22, p.width + 0.12, h + 0.12, 0.12)
    } else {
      box(metal, 0, 0.9, 0, 0.20, 2.3, 0.20)
      box(metal, 0, y, 0, p.width + 0.12, h + 0.12, 0.20)
    }
    const face = own(new THREE.PlaneGeometry(p.width, h))
    const material = own(new THREE.MeshBasicMaterial({ map: signTexture(p.exit, own), side: THREE.FrontSide }))
    const front = new THREE.Mesh(face, material); front.position.set(0, y, p.mounted ? 0.29 : 0.11); group.add(front)
    if (!p.mounted) { const back = new THREE.Mesh(face, material); back.rotation.y = Math.PI; back.position.set(0, y, -0.11); group.add(back) }
    scene.add(group)
  }
}
