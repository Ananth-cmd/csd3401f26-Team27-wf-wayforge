/*!
 * \file facades.ts
 * \brief Exterior finish of each SIT Punggol block, shared by the map, the rendered campus and the 3D route view
 *
 * One Facade per block, taken from photographs of the built campus (WOHA and
 * RSP project photographs). The key names the block's wall texture
 * (campusTextures.ts for the rendered campus, facadePatterns.tsx for the SVG
 * drawing); the colours here are for the roof, the outlines and the exterior
 * walls on the floor plan and in the route view:
 *   - W3, W5, W6 (Campus Heart, WOHA): fluted beige precast, a red hood over
 *     each window, green walls on the end faces, white curved roof canopy
 *   - W1 (library, the Campus Heart landmark): stacked red slats with light
 *     soffits between them
 *   - E2, E5, E6 (Campus Court, RSP): white slab bands, dark ribbon windows and
 *     planted terrace edges
 *   - E1 (Kwek Leng Beng University Tower): blue glass curtain wall in a white
 *     frame, with the SIT sign at the top
 *   - E3 (Ho Bee Auditorium): dark bronze with vertical fins and a red edge
 *   - E4 (sports hall): low timber pavilion with a dark metal roof
 * All roofs carry photovoltaic panels. Blocks not listed take the finish of
 * their half of the campus.
 *
 * wallBlocks() finds the block of every wall on a level from the nearest
 * place with a block code; wallFacades() gives the exterior walls the colours
 * of their block.
 *
 * Links: used by MapView.tsx (campus drawing, exterior walls on the floor
 * plan), Campus3D.tsx (rendered campus) and Route3D.tsx (exterior walls);
 * textures in campusTextures.ts and facadePatterns.tsx; block codes from
 * massing.ts (blockOf).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Per-block exterior finishes and the wall to block assignment
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-11-24
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

import type { Building } from './types'
import { blockOf } from './massing'

export type Facade = {
  key: string         // texture name: campusTextures.ts entry, wf-fc-<key> pattern in facadePatterns.tsx
  edge: string        // wall outline
  roof: string        // roof surface around the solar panels
  rim: string         // roof edge
  rimWidth: number    // roof edge width in the SVG drawing, metres (a wide white edge represents the roof canopy)
  greenEnds?: boolean // green walls on the end faces (walls 6 to 32 m long)
  frame?: string      // frame colour at both ends of each wall (curtain wall)
  edgeStripe?: string // vertical stripe colour near the end of each wall
  sign?: boolean      // SIT sign at the top of the block
  wall: [string, string] // exterior walls on the floor plan and in the route view: [side, top]
}

const RED = '#c9402e'
const HUB: Facade = { key: 'hub', edge: '#2b3438', roof: '#f2f1ec', rim: '#f4f2ec', rimWidth: 0.9, wall: [RED, '#8f2e22'] }
const HEART: Facade = { key: 'heart', edge: '#bdb6a8', roof: '#f3f1ec', rim: '#ffffff', rimWidth: 1.2, greenEnds: true, wall: ['#e3ddd0', RED] }
const COURT: Facade = { key: 'court', edge: '#b8bab5', roof: '#eceeea', rim: '#d6d8d3', rimWidth: 0.5, sign: true, wall: ['#e6e6e2', '#7d807a'] }
const TOWER: Facade = { key: 'tower', edge: '#3e5d75', roof: '#e3e7ea', rim: '#f1f3f4', rimWidth: 0.6, frame: '#f1f3f4', sign: true, wall: ['#5f84a2', '#f1f3f4'] }
const AUDITORIUM: Facade = { key: 'auditorium', edge: '#33281f', roof: '#e0ddd6', rim: '#3a2e25', rimWidth: 0.5, edgeStripe: RED, wall: ['#5c4838', '#33281f'] }
const SPORTS: Facade = { key: 'sports', edge: '#6f5034', roof: '#7b8186', rim: '#5f6569', rimWidth: 0.6, wall: ['#b98a5c', '#6f5034'] }

const BY_BLOCK: Record<string, Facade> = {
  W1: HUB, W3: HEART, W5: HEART, W6: HEART,
  E1: TOWER, E2: COURT, E3: AUDITORIUM, E4: SPORTS, E5: { ...COURT, sign: false }, E6: { ...COURT, sign: false },
}

// Finish of a block by its code ("W1", "E3"). Link bridges ("BR1") and unknown codes return undefined;
// other west and east blocks take the Campus Heart and Campus Court finish.
export function facadeOf(block: string | undefined): Facade | undefined {
  if (!block || /^BR/i.test(block)) return undefined
  return BY_BLOCK[block.toUpperCase()] ?? (/^W/i.test(block) ? HEART : /^E/i.test(block) ? { ...COURT, sign: false } : undefined)
}

const CELL = 10      // grid cell for the place lookup, metres
const REACH = 12     // a wall further than this from every place has no block, metres
const cache = new WeakMap<Building, Map<number, (string | undefined)[]>>()

// Block code of every wall of a level, in the order of level.walls: the block of the nearest place within REACH of
// the wall's midpoint. Places take their block from the place id ("L1:W1_r185" -> "W1"), which every room has.
export function wallBlocks(b: Building, li: number): (string | undefined)[] {
  let m = cache.get(b)
  if (!m) { m = new Map(); cache.set(b, m) }
  const hit = m.get(li)
  if (hit) return hit
  const pos = new Map(b.nodes.filter(n => n.level === li).map(n => [n.id, n.pos]))
  const grid = new Map<string, { x: number; z: number; bl: string }[]>()
  for (const p of b.pois) {
    const at = pos.get(p.node)
    const bl = at && (blockOf(p.code) ?? blockOf(p.id.replace(/^[^:]*:/, '')))
    if (!at || !bl) continue
    const k = `${Math.floor(at[0] / CELL)},${Math.floor(at[1] / CELL)}`
    const list = grid.get(k) ?? []
    list.push({ x: at[0], z: at[1], bl })
    grid.set(k, list)
  }
  const reachCells = Math.ceil(REACH / CELL)
  const out = (b.levels[li]?.walls ?? []).map(w => {
    const x = (w.a[0] + w.b[0]) / 2, z = (w.a[1] + w.b[1]) / 2, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
    let best: string | undefined, bd = REACH * REACH
    for (let i = -reachCells; i <= reachCells; i++) for (let j = -reachCells; j <= reachCells; j++)
      for (const p of grid.get(`${cx + i},${cz + j}`) ?? []) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p.bl } }
    return best
  })
  m.set(li, out)
  return out
}

// Exterior wall colours [side, top] of every wall of a level, in the order of level.walls. Link bridge walls take
// the bridge colour from the surroundings when one is given. Interior walls and walls without a block are undefined.
export function wallFacades(b: Building, li: number): ([string, string] | undefined)[] {
  const blocks = wallBlocks(b, li)
  const bridge = new Map<string, string>()
  for (const x of b.surroundings?.bridges ?? []) { const bl = blockOf(x.room.replace(/^[^:]*:/, '')); if (bl) bridge.set(bl, x.colour) }
  return (b.levels[li]?.walls ?? []).map((w, i) => {
    if (!w.exterior) return undefined
    const bl = blocks[i]
    const bc = bl ? bridge.get(bl) : undefined
    return bc ? [bc, bc] : facadeOf(bl)?.wall
  })
}
