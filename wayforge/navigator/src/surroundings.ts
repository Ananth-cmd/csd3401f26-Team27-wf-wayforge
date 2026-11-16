/*!
 * \file surroundings.ts
 * \brief Trees for the green areas around a building, shared by the map and the 3D route view
 *
 * Building.surroundings (supplied by the backend) lists the areas, roads,
 * neighbouring buildings and landmarks around the building. treesOf() places
 * trees in the areas of kind "trees" and "park": one candidate per cell of a
 * grid, offset inside the cell by a hash of the cell indices, so the result
 * is identical on every load. Candidates on the building, on a neighbouring
 * building or within CLEAR of a road are dropped. The result is cached per
 * building.
 *
 * Links: used by MapView.tsx (tree crowns on the map) and Route3D.tsx (trees
 * in the 3D view); data from types.ts (Site).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Tree placement over the green areas
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-11-16
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

import type { Building, Vec2 } from './types'

const inPoly = (x: number, z: number, poly: Vec2[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

const MAX_TREES = 450
const CLEAR = 3 // clearance around buildings and roads, metres
const cache = new WeakMap<Building, Vec2[]>()

// Tree positions as [x, z] in level coordinates, metres. At most MAX_TREES.
export function treesOf(b: Building): Vec2[] {
  const hit = cache.get(b)
  if (hit) return hit
  const site = b.surroundings, out: Vec2[] = []
  if (site) {
    const solid = [...(b.levels[0]?.floors ?? []), ...site.buildings.map(x => x.polygon)]
    const box = solid.map(f => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of f) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) } return [x0 - CLEAR, x1 + CLEAR, z0 - CLEAR, z1 + CLEAR] })
    const roads = site.roads.filter(r => r.kind === 'road')
    const blocked = (x: number, z: number) => {
      for (let i = 0; i < solid.length; i++) {
        const q = box[i]
        if (x < q[0] || x > q[1] || z < q[2] || z > q[3]) continue
        if (inPoly(x, z, solid[i]) || inPoly(x + CLEAR, z, solid[i]) || inPoly(x - CLEAR, z, solid[i]) || inPoly(x, z + CLEAR, solid[i]) || inPoly(x, z - CLEAR, solid[i])) return true
      }
      for (const r of roads) for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1], c = r.points[i], ex = c[0] - a[0], ez = c[1] - a[1]
        const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)))
        if (Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) < r.width / 2 + CLEAR) return true
      }
      return false
    }
    const frac = (v: number) => v - Math.floor(v)
    for (const a of site.areas) {
      const step = a.kind === 'trees' ? 13 : a.kind === 'park' ? 17 : 0 // grid cell size, metres
      if (!step) continue
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
      for (const [x, z] of a.polygon) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
      // one candidate per grid cell, offset inside the cell by a hash of the cell indices
      for (let gx = Math.floor(x0 / step); gx * step <= x1; gx++) for (let gz = Math.floor(z0 / step); gz * step <= z1; gz++) {
        const x = (gx + frac(Math.sin(gx * 127.1 + gz * 311.7) * 43758.5453) * 0.8) * step
        const z = (gz + frac(Math.sin(gx * 269.5 + gz * 183.3) * 43758.5453) * 0.8) * step
        if (out.length < MAX_TREES && inPoly(x, z, a.polygon) && !blocked(x, z)) out.push([x, z])
      }
    }
  }
  cache.set(b, out)
  return out
}
