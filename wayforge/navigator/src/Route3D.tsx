/*!
 * \file Route3D.tsx
 * \brief Real 3D view of a route (three.js / WebGL), loaded only when a route is shown
 *
 * Whole route: the floors the route uses, pulled apart so you can see between
 * them, the route as a glowing line and lift / stair shafts joining the floors;
 * drag to orbit, "Walk me through" flies along the whole route. One stage
 * (navigation mode): that floor solid with the floors above and below
 * see-through; the camera walks the stage at eye level or follows from just
 * behind. Built from the same building data as the 2D map (rooms coloured by
 * type, walls, doors as gaps). Falls back to the 2D map if WebGL fails.
 * Floors and walls are textured (tiles, panels), exterior walls take the
 * finish of their block, windows are glass panes and each doorway has a
 * frame, a head and an open leaf. The surroundings (ground, water, roads,
 * neighbouring buildings, trees and landmark names) are placed under the
 * lowest level shown. Room and landmark names that overlap on screen are
 * hidden.
 *
 * Links: used by App.tsx (lazy loaded); stages from legs.ts; route line shape
 * from routeline.ts; trees from surroundings.ts; exterior wall colours from
 * facades.ts.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Kannan Shrinivasan, Ananthan Elangovan
 *   Kannan Shrinivasan
 *   - Floor, wall and shaft geometry from the building data
 *   - Route line, orbit camera and the walk-through / follow cameras
 *   - Stage view with see-through floors above and below
 *   Ananthan Elangovan
 *   - Floor and wall textures, outside wall and link bridge colours
 *   - Exterior walls in the finish of their block
 *   - Window glass, door frames, heads and leaves
 *   - Surroundings under the floors (ground, water, roads, buildings, trees, landmarks)
 *   - Screen-space declutter of room and landmark names
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-11-07
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Building, Vec2 } from './types'
import type { Leg } from './legs'
import { drawnRoute } from './routeline'
import { treesOf } from './surroundings'
import { wallFacades } from './facades'

type Props = {
  building: Building
  legs: Leg[]
  stage?: number // navigation mode: show this stage; undefined = whole route
  start?: { node: string; title: string }
  dest?: { node: string; title: string }
  names: Map<string, string> // node id -> what to call it
  captions: string[] // one line per leg (shown while flying the whole route)
  onFail: () => void // no WebGL: the caller shows the 2D map instead
}

const WALL_H = 2.7
const EYE = 1.6
const SPREAD = 2.6 // whole-route view: floors pulled apart this much
const DOOR_H = 2.1 // door height, metres; the wall continues above it
const LANDMARK_REACH = 120 // landmark names are shown up to this far from the route, metres
const LANDMARK_GAP = 40 // minimum distance between two landmarks that both get a name, metres
const LANDMARK_MAX = 6 // most landmark names shown at once
const LANDMARK_CHARS = 24 // longest landmark name shown; longer names end in an ellipsis
const AREA: Record<string, number> = { water: 0xa8d2e8, grass: 0xd2e5bf, park: 0xc4ddaf, trees: 0xb7d5a3, plaza: 0xefe8d9 } // ground colour per area kind, as on the map
const ROOM: Record<string, number> = { room: 0xfbf7ef, corr: 0xe9ece9, lobby: 0xf1ece0, toilet: 0xcfeae5, lift: 0xd2e1f3, stair: 0xf5e0c2, food: 0xf6e8c4, lib: 0xe1ead2, lab: 0xdde7f0, office: 0xe8e4f2, store: 0xe4e7e5 }
const roomType = (category: string, name: string) => {
  const n = name.toLowerCase(), c = category.toLowerCase()
  if (/\b(wc|toilet|restroom|washroom)/.test(n) || c === 'toilet') return 'toilet'
  if (/canteen|caf[eé]|food|dining|kiosk/.test(n) || c === 'food') return 'food'
  if (/library|bookshop/.test(n)) return 'lib'
  if (c === 'lift' || /\blift\b/.test(n)) return 'lift'
  if (c === 'stair' || c === 'stairs' || /\bstair/.test(n)) return 'stair'
  if (c === 'corridor' || /corridor|link bridge|walkway/.test(n)) return 'corr'
  if (c === 'lobby' || /lobby|foyer|entrance|atrium/.test(n)) return 'lobby'
  if (c === 'lab' || /\blab\b|laborator/.test(n)) return 'lab'
  if (c === 'office' || /office|services/.test(n)) return 'office'
  if (c === 'storage' || /store|storage/.test(n)) return 'store'
  return 'room'
}
const inPoly = (x: number, z: number, poly: Vec2[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// Floor tile and wall panel textures, drawn once on a 128 px canvas and repeated. Both are near white, so the vertex
// colour of each room and wall stays visible through them.
let texCache: { floor: THREE.Texture; wall: THREE.Texture } | null = null
function textures() {
  if (texCache) return texCache
  const make = (draw: (g: CanvasRenderingContext2D, n: number) => void) => {
    const c = document.createElement('canvas'), n = 128
    c.width = c.height = n
    const g = c.getContext('2d')!
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n)
    let seed = 7
    for (let i = 0; i < 90; i++) { // 90 faint specks from a fixed-seed generator: the texture is identical on every load
      seed = (seed * 1103515245 + 12345) % 2147483648
      const x = seed % n, y = Math.floor(seed / n) % n
      g.fillStyle = `rgba(60, 60, 50, ${0.02 + (seed % 5) * 0.006})`; g.fillRect(x, y, 5, 5)
    }
    draw(g, n)
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
    return t
  }
  texCache = {
    // one tile with a joint line on its border
    floor: make((g, n) => { g.strokeStyle = 'rgba(70, 80, 75, 0.2)'; g.lineWidth = 2; g.strokeRect(1, 1, n - 2, n - 2) }),
    // four vertical panels separated by joint lines, with a skirting line at the bottom
    wall: make((g, n) => { g.fillStyle = 'rgba(40, 30, 20, 0.13)'; for (let x = 0; x < n; x += n / 4) g.fillRect(x, 0, 2, n); g.fillStyle = 'rgba(40, 30, 20, 0.1)'; g.fillRect(0, n - 5, n, 5) }),
  }
  return texCache
}

// Builder for one mesh of upright boxes (walls, glass panes, door parts): position, normal, colour and uv per vertex.
function boxes() {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = []
  const quad = (v: number[][], n: number[], k: THREE.Color, u: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(v[i][0], v[i][1], v[i][2]); nor.push(n[0], n[1], n[2]); col.push(k.r, k.g, k.b); uv.push(u[i][0], u[i][1]) }
  }
  // Adds a box along a-b (scene x / z, metres) with half thickness t, from height y0 to y1. side and top are the
  // vertex colours of the vertical faces and of the top face.
  const add = (ax: number, az: number, bx: number, bz: number, t: number, y0: number, y1: number, side: THREE.Color, top: THREE.Color) => {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz)
    if (len < 0.02 || y1 <= y0) return
    const nx = (-dz / len) * t, nz = (dx / len) * t
    const q = [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]
    const v = (i: number, y: number) => [q[i][0], y, q[i][1]]
    const U = len / 2.4, T = (2 * t) / 2.4, V0 = y0 / WALL_H, V1 = y1 / WALL_H // uv: the wall texture spans 2.4 m horizontally and WALL_H vertically
    const long = [[0, V0], [U, V0], [U, V1], [0, V1]], end = [[0, V0], [T, V0], [T, V1], [0, V1]], flat = [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]
    quad([v(0, y0), v(1, y0), v(1, y1), v(0, y1)], [nx / t, 0, nz / t], side, long)
    quad([v(2, y0), v(3, y0), v(3, y1), v(2, y1)], [-nx / t, 0, -nz / t], side, long)
    quad([v(1, y0), v(2, y0), v(2, y1), v(1, y1)], [dx / len, 0, dz / len], side, end)
    quad([v(3, y0), v(0, y0), v(0, y1), v(3, y1)], [-dx / len, 0, -dz / len], side, end)
    quad([v(0, y1), v(1, y1), v(2, y1), v(3, y1)], [0, 1, 0], top, flat)
  }
  const geometry = () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    return g
  }
  return { add, geometry }
}

// One floor as four geometries (coloured room floors, walls, window glass, doors), cached per building and floor.
type FloorMesh = { floor: THREE.BufferGeometry; walls: THREE.BufferGeometry; glass: THREE.BufferGeometry; doors: THREE.BufferGeometry }
const floorCache = new WeakMap<Building, Map<number, FloorMesh>>()
function floorMesh(b: Building, li: number): FloorMesh {
  let m = floorCache.get(b)
  if (!m) { m = new Map(); floorCache.set(b, m) }
  const hit = m.get(li)
  if (hit) return hit
  const lvl = b.levels[li]
  // room colours from the places (each room has one), as in the 2D map
  // link bridges take the colour given in the surroundings
  const polys = lvl.floors
  const box = polys.map(f => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of f) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) } return [x0, x1, z0, z1] })
  const type: string[] = polys.map(() => (polys.length > 1 ? 'room' : 'corr'))
  const tint: (string | undefined)[] = polys.map(() => undefined)
  if (polys.length > 1) {
    const nodeAt = new Map(b.nodes.filter(n => n.level === li).map(n => [n.id, n.pos]))
    const bridge = new Map((b.surroundings?.bridges ?? []).map(x => [x.room, x.colour]))
    for (const p of b.pois) {
      const pos = nodeAt.get(p.node)
      if (!pos) continue
      for (let i = 0; i < polys.length; i++) { const q = box[i]; if ((type[i] === 'room' || bridge.has(p.id)) && pos[0] >= q[0] && pos[0] <= q[1] && pos[1] >= q[2] && pos[1] <= q[3] && inPoly(pos[0], pos[1], polys[i])) { if (type[i] === 'room') type[i] = roomType(p.category ?? '', p.name ?? ''); tint[i] ??= bridge.get(p.id); break } }
    }
  }
  const fp: number[] = [], fc: number[] = [], fu: number[] = [], col = new THREE.Color(), white = new THREE.Color(0xffffff)
  polys.forEach((f, i) => {
    const contour = f.map(([x, z]) => new THREE.Vector2(x, -z))
    let tris: number[][]
    try { tris = THREE.ShapeUtils.triangulateShape(contour, []) } catch { return }
    if (tint[i]) col.set(tint[i]!).lerp(white, 0.55); else col.setHex(ROOM[type[i]] ?? 0xffffff)
    for (const t of tris) for (const k of t) { fp.push(contour[k].x, 0, contour[k].y); fc.push(col.r, col.g, col.b); fu.push(contour[k].x / 1.2, contour[k].y / 1.2) } // uv: one tile per 1.2 m
  })
  const floor = new THREE.BufferGeometry()
  floor.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3))
  floor.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3))
  floor.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2))
  floor.computeVertexNormals()
  // walls as boxes (sides light, tops darker so the plan reads from above)
  const W = boxes(), G = boxes(), D = boxes()
  const side = new THREE.Color(0xf4f1ea), top = new THREE.Color(0x8aa39a), sideOut = new THREE.Color(0xc48f70), topOut = new THREE.Color(0x8d5e46)
  // exterior walls take the finish of their block (facades.ts); colours are shared between walls of the same finish
  const finish = wallFacades(b, li), tone = new Map<string, THREE.Color>()
  const colour = (hex: string | undefined, fallback: THREE.Color) => { if (!hex) return fallback; let c = tone.get(hex); if (!c) { c = new THREE.Color(hex); tone.set(hex, c) } return c }
  for (const [i, w] of lvl.walls.entries()) {
    const f = w.exterior ? finish[i] : undefined
    W.add(w.a[0], -w.a[1], w.b[0], -w.b[1], Math.max(0.12, w.thickness) / 2, 0, WALL_H, w.exterior ? colour(f?.[0], sideOut) : side, w.exterior ? colour(f?.[1], topOut) : top)
  }
  // Windows: a glass pane from sill to head, 0.03 m proud of both wall faces.
  const pane = new THREE.Color(0xffffff)
  for (const wn of lvl.windows ?? []) G.add(wn.a[0], -wn.a[1], wn.b[0], -wn.b[1], Math.max(0.12, wn.thickness) / 2 + 0.03, wn.sill, Math.min(WALL_H - 0.12, wn.sill + wn.height), pane, pane)
  // Doors: the wall continues above DOOR_H, a frame post stands at each end of the span, and each leaf is opened by
  // 72 degrees. A span wider than 1.5 m gets two leaves.
  const frame = new THREE.Color(0x6b4a2b), leaf = new THREE.Color(0xb07a45), open = (72 * Math.PI) / 180
  for (const d of lvl.doors ?? []) {
    const ax = d.a[0], az = -d.a[1], bx = d.b[0], bz = -d.b[1], dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz)
    if (len < 0.5) continue
    const ux = dx / len, uz = dz / len
    W.add(ax, az, bx, bz, 0.09, DOOR_H, WALL_H, side, top)
    D.add(ax - ux * 0.04, az - uz * 0.04, ax + ux * 0.05, az + uz * 0.05, 0.13, 0, DOOR_H, frame, frame)
    D.add(bx - ux * 0.05, bz - uz * 0.05, bx + ux * 0.04, bz + uz * 0.04, 0.13, 0, DOOR_H, frame, frame)
    const leaves: [number, number, number, number][] = len > 1.5 ? [[ax, az, 1, len / 2], [bx, bz, -1, len / 2]] : [[ax, az, 1, len]]
    for (const [hx, hz, dir, w] of leaves) {
      const lx = ux * dir * Math.cos(open) - uz * Math.sin(open), lz = uz * dir * Math.cos(open) + ux * Math.sin(open)
      D.add(hx, hz, hx + lx * (w - 0.04), hz + lz * (w - 0.04), 0.025, 0, DOOR_H - 0.05, leaf, leaf)
    }
  }
  const out = { floor, walls: W.geometry(), glass: G.geometry(), doors: D.geometry() }
  m.set(li, out)
  return out
}

// a text label that stays the same size on screen
function label(text: string, bg: string, fg: string, screen = true, px = 40) {
  const c = document.createElement('canvas'), g = c.getContext('2d')!
  g.font = `700 ${px}px Manrope, system-ui, sans-serif`
  const w = Math.ceil(g.measureText(text).width) + px, h = Math.ceil(px * 1.7)
  c.width = w; c.height = h
  g.font = `700 ${px}px Manrope, system-ui, sans-serif`
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, h / 2.6); g.fill()
  g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, px / 2, h / 2 + 1)
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  // screen = always on top (you, destination, floors); otherwise a room name, hidden behind walls. Both keep their size.
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: !screen, transparent: true, sizeAttenuation: false }))
  s.renderOrder = screen ? 10 : 1
  const k = screen ? 0.042 : 0.03
  s.scale.set((k * w) / h, k, 1)
  s.center.set(0.5, 0)
  return s
}

// a lift / stairs sign: the icon (and where it goes), always drawn on top at the same size on screen
const ICON_PATH = { lift: 'M4 9h16v12.5H4zM12 9v12.5M9 1.8 6.6 5h4.8zM15 5.4l2.4-3.2h-4.8z', stairs: 'M4 19h5v-5h5V9h6' }
function badge(kind: 'lift' | 'stairs', text: string) {
  const px = 36, h = Math.ceil(px * 1.9), c = document.createElement('canvas'), g = c.getContext('2d')!
  const bg = kind === 'lift' ? '#3c6fb0' : '#c9852f'
  g.font = `700 ${px}px Manrope, system-ui, sans-serif`
  const w = text ? h + Math.ceil(g.measureText(text).width) + px * 0.8 : h
  c.width = w; c.height = h
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, h, h / 4); g.fill()
  g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, h / 4 - 2); g.stroke()
  g.save(); g.translate(h * 0.16, h * 0.16); g.scale((h * 0.68) / 24, (h * 0.68) / 24)
  g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#ffffff'; g.fillStyle = '#ffffff'
  const path = new Path2D(ICON_PATH[kind]); g.stroke(path); if (kind === 'lift') g.fill(new Path2D('M9 1.8 6.6 5h4.8zM15 5.4l2.4-3.2h-4.8z'))
  g.restore()
  if (text) { g.font = `700 ${px}px Manrope, system-ui, sans-serif`; g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.fillText(text, h, h / 2 + 1) }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }))
  s.renderOrder = 11
  const k = text ? 0.05 : 0.045
  s.scale.set((k * w) / h, k, 1)
  s.center.set(0.5, 0)
  return s
}

export default function Route3D({ building, legs, stage, start, dest, names, captions, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const api = useRef<{ play: () => void; pause: (p: boolean) => void; view: (v: 'eye' | 'follow' | 'orbit') => void } | null>(null)
  const [mode, setMode] = useState<'eye' | 'follow' | 'orbit'>('orbit')
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false) // walk-through stopped part way (Resume carries on from there)
  const [caption, setCaption] = useState('')
  const failRef = useRef(onFail)
  failRef.current = onFail // eslint-disable-line react-hooks/refs -- latest callback

  const key = `${building.id}|${stage ?? 'all'}|${legs.map(l => l.nodes.join(',')).join('/')}`
  useEffect(() => {
    const el = host.current
    if (!el || !legs.length) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }) } catch { failRef.current(); return }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xdcebf2)
    scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d3ce, 2.6))
    const sun = new THREE.DirectionalLight(0xfff8ee, 1.1); sun.position.set(-40, 80, 30); scene.add(sun)
    const camera = new THREE.PerspectiveCamera(stage === undefined ? 45 : 70, 1, 0.1, 3000)
    const node = new Map(building.nodes.map(n => [n.id, n]))
    const whole = stage === undefined
    const liftStage = !whole && legs[stage!].kind !== 'walk'
    const spread = whole || liftStage ? SPREAD : 1
    const elev = (li: number) => (building.levels[li]?.elevation ?? li * building.floorHeight) * spread
    const P = (id: string, dy = 0) => { const n = node.get(id)!; return new THREE.Vector3(n.pos[0], elev(n.level) + dy, -n.pos[1]) }

    // which floors: the route's floors (whole route) or this stage's floor(s) plus the ones above and below
    const shown = new Map<number, boolean>() // level -> solid?
    const use = whole ? legs : [legs[stage!]]
    for (const l of use) { if (l.kind === 'walk') shown.set(l.level, true); else { shown.set(l.from, true); shown.set(l.to, true) } }
    if (!whole && !liftStage) for (const li of [...shown.keys()]) for (const d of [-1, 1]) if (building.levels[li + d] && !shown.has(li + d)) shown.set(li + d, false)
    const mats: THREE.Material[] = [], geos: THREE.BufferGeometry[] = [] // freed when the view closes (floors stay cached)
    const mat = <T extends THREE.Material>(m: T) => { mats.push(m); return m }
    const geo = <T extends THREE.BufferGeometry>(g: T) => { geos.push(g); return g }
    const tex = textures()
    const solidFloor = mat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map: tex.floor }))
    const solidWall = mat(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.wall }))
    const ghostFloor = mat(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.22, depthWrite: false }))
    const ghostWall = mat(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.12, depthWrite: false }))
    const glassMat = mat(new THREE.MeshLambertMaterial({ color: 0x9fd4ee, emissive: 0x4a90b8, emissiveIntensity: 0.35, transparent: true, opacity: 0.82 }))
    const doorMat = mat(new THREE.MeshLambertMaterial({ vertexColors: true }))
    const topSolid = Math.max(...[...shown].filter(([, v]) => v).map(([k]) => k))
    const above: THREE.Object3D[] = []
    for (const [li, solid] of shown) {
      const g = floorMesh(building, li), y = elev(li)
      const f = new THREE.Mesh(g.floor, solid ? solidFloor : ghostFloor); f.position.y = y; scene.add(f)
      const w = new THREE.Mesh(g.walls, solid ? solidWall : ghostWall); w.position.y = y; scene.add(w)
      if (li > topSolid) above.push(f, w)
      if (!solid) continue // ghost levels show the floor and the walls only
      const d = new THREE.Mesh(g.doors, doorMat); d.position.y = y; scene.add(d)
      const gl = new THREE.Mesh(g.glass, glassMat); gl.position.y = y; gl.renderOrder = 2; scene.add(gl)
      if (li > topSolid) above.push(d, gl)
    }

    // Surroundings, placed 0.6 m below the lowest level shown: ground and areas, roads, neighbouring buildings
    // and trees.
    const site = building.surroundings
    if (site) {
      const y0 = Math.min(...[...shown.keys()].map(elev)) - 0.6
      const gp: number[] = [], gc: number[] = [], tone = new THREE.Color()
      const flat = (poly: Vec2[], hex: number, y: number) => {
        const contour = poly.map(([x, z]) => new THREE.Vector2(x, -z))
        let tris: number[][]
        try { tris = THREE.ShapeUtils.triangulateShape(contour, []) } catch { return }
        tone.setHex(hex)
        for (const t of tris) for (const k of t) { gp.push(contour[k].x, y, contour[k].y); gc.push(tone.r, tone.g, tone.b) }
      }
      const [bx0, bz0, bx1, bz1] = site.bounds
      flat([[bx0, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1]], 0xe6eadf, y0 - 0.2)
      site.areas.forEach((a, i) => flat(a.polygon, AREA[a.kind] ?? AREA.grass, y0 - 0.16 + i * 0.004))
      for (const r of site.roads) { // roads and paths as flat strips; an octagon at each vertex closes the gap between two strips
        const hex = r.kind === 'road' ? 0xf7f7f3 : r.kind === 'cycle' ? 0xe6dcc3 : 0xf3ecdb, y = y0 - (r.kind === 'road' ? 0.06 : 0.03), h = r.width / 2
        for (let i = 1; i < r.points.length; i++) {
          const a = r.points[i - 1], c = r.points[i], dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz)
          if (len < 0.05) continue
          const nx = (-dz / len) * h, nz = (dx / len) * h
          flat([[a[0] + nx, a[1] + nz], [c[0] + nx, c[1] + nz], [c[0] - nx, c[1] - nz], [a[0] - nx, a[1] - nz]], hex, y)
          flat(Array.from({ length: 8 }, (_, j) => [c[0] + Math.cos((j * Math.PI) / 4) * h, c[1] + Math.sin((j * Math.PI) / 4) * h] as Vec2), hex, y)
        }
      }
      const ground = geo(new THREE.BufferGeometry())
      ground.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3))
      ground.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3))
      scene.add(new THREE.Mesh(ground, mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))))
      // Neighbouring buildings: grey prisms, height capped at 14 m to keep the levels shown in view.
      const N = boxes(), grey = new THREE.Color(0xd2d6cf), roofTone = new THREE.Color(0xe6e9e3), rp: number[] = [], rc: number[] = []
      for (const nb of site.buildings) {
        const h = Math.min(14, nb.levels * 3.2)
        nb.polygon.forEach((a, i) => { const c = nb.polygon[(i + 1) % nb.polygon.length]; N.add(a[0], -a[1], c[0], -c[1], 0.15, 0, h, grey, roofTone) })
        const contour = nb.polygon.map(([x, z]) => new THREE.Vector2(x, -z))
        try { for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) for (const k of t) { rp.push(contour[k].x, h, contour[k].y); rc.push(roofTone.r, roofTone.g, roofTone.b) } } catch { /* outline cannot be triangulated: no roof */ }
      }
      const nbWalls = new THREE.Mesh(geo(N.geometry()), doorMat); nbWalls.position.y = y0; scene.add(nbWalls)
      const roofs = geo(new THREE.BufferGeometry())
      roofs.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3))
      roofs.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3))
      const roofMesh = new THREE.Mesh(roofs, mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }))); roofMesh.position.y = y0; scene.add(roofMesh)
      // trees: one trunk and one crown instance per tree position
      const trees = treesOf(building)
      if (trees.length) {
        const crowns = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(2.7, 10, 7)), mat(new THREE.MeshLambertMaterial({ color: 0x6aa364 })), trees.length)
        const trunks = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.28, 0.4, 2.6, 6)), mat(new THREE.MeshLambertMaterial({ color: 0x8a6b4a })), trees.length)
        const tm = new THREE.Matrix4()
        trees.forEach(([x, z], i) => { crowns.setMatrixAt(i, tm.makeTranslation(x, y0 + 4.4, -z)); trunks.setMatrixAt(i, tm.makeTranslation(x, y0 + 1.3, -z)) })
        scene.add(crowns, trunks)
      }
    }

    // the route: one line through every stage (lifts / stairs go straight up between the floors)
    const pts: THREE.Vector3[] = [], legAt: number[] = []
    for (const [i, l] of use.entries()) {
      // walking: down the middle of the corridors and through the doorways (routeline.ts; the route is unchanged)
      const ps = l.kind === 'walk' && l.nodes.length > 1
        ? drawnRoute(building, l.level, l.nodes.map(id => node.get(id)!.pos), l.nodes.map(id => node.get(id)!.kind !== 'turn')).map(q => new THREE.Vector3(q[0], elev(l.level) + 0.35, -q[1]))
        : l.nodes.map(id => P(id, 0.35))
      for (const p of ps) if (!pts.length || pts[pts.length - 1].distanceTo(p) > 0.01) { pts.push(p); legAt.push(whole ? i : stage!) }
    }
    if (pts.length < 2) pts.push(pts[0].clone().add(new THREE.Vector3(0.01, 0, 0)))
    if (whole) {
      const byLevel = new Map<number, THREE.Box3>()
      for (const l of legs) if (l.kind === 'walk') { const bx = byLevel.get(l.level) ?? new THREE.Box3(); for (const id of l.nodes) bx.expandByPoint(P(id)); byLevel.set(l.level, bx) }
      for (const [li, bx] of byLevel) { const t = label(building.levels[li].name, '#12302c', '#ffffff'); t.position.set(bx.min.x - 6, elev(li) + WALL_H + 1, (bx.min.z + bx.max.z) / 2); t.center.set(1, 0.5); scene.add(t) }
    }
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const total = cum[cum.length - 1]
    const at = (s: number, out = new THREE.Vector3()) => {
      s = Math.max(0, Math.min(total, s))
      let i = 1; while (i < cum.length - 1 && cum[i] < s) i++
      const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])
      return out.copy(pts[i - 1]).lerp(pts[i], t)
    }
    const legOf = (s: number) => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; return legAt[i] }
    const path = new THREE.CurvePath<THREE.Vector3>()
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]))
    const bb = new THREE.Box3().setFromPoints(pts), centre = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3())
    // Landmark names near the route: within LANDMARK_REACH of the route's bounding box, nearest first, at most
    // LANDMARK_MAX, and none within LANDMARK_GAP of one already taken. Long names are cut to LANDMARK_CHARS.
    const landmarkLabels: THREE.Sprite[] = []
    if (site) {
      const gy = Math.min(...[...shown.keys()].map(elev)) + 6
      const near = site.landmarks.map(lm => {
        const dx = Math.max(bb.min.x - lm.pos[0], 0, lm.pos[0] - bb.max.x), dz = Math.max(bb.min.z + lm.pos[1], 0, -lm.pos[1] - bb.max.z)
        return { lm, d: Math.hypot(dx, dz) }
      }).filter(x => x.d <= LANDMARK_REACH).sort((p, q) => p.d - q.d)
      const taken: Vec2[] = []
      for (const { lm } of near) {
        if (taken.length >= LANDMARK_MAX || taken.some(q => Math.hypot(q[0] - lm.pos[0], q[1] - lm.pos[1]) < LANDMARK_GAP)) continue
        taken.push(lm.pos)
        const name = lm.name.length > LANDMARK_CHARS ? lm.name.slice(0, LANDMARK_CHARS - 1).trimEnd() + '\u2026' : lm.name
        const t = label(name, 'rgba(255,255,255,0.86)', '#52635d', false, 30)
        t.scale.multiplyScalar(0.8); t.position.set(lm.pos[0], gy, -lm.pos[1]); scene.add(t); landmarkLabels.push(t)
      }
    }
    const tubeR = 0.2, K = liftStage ? 2.5 : Math.max(1, Math.min(5, size.length() / 90)) // overview: everything K times bigger
    const routeMat = mat(new THREE.MeshLambertMaterial({ color: 0x0b7a6b, emissive: 0x0b7a6b, emissiveIntensity: 0.55 }))
    const thin = new THREE.Mesh(geo(new THREE.TubeGeometry(path, Math.min(2000, pts.length * 6), tubeR, 10, false)), routeMat)
    const thick = new THREE.Mesh(geo(new THREE.TubeGeometry(path, Math.min(2000, pts.length * 6), tubeR * K * 1.6, 10, false)), routeMat)
    scene.add(thin, thick)
    // lift / stair shafts (whole route)
    for (const l of use) if (l.kind !== 'walk') {
      const a = P(l.nodes[0]), top = Math.max(elev(l.from), elev(l.to)) + WALL_H, bot = Math.min(elev(l.from), elev(l.to))
      const shaft = new THREE.Mesh(geo(new THREE.BoxGeometry(3, top - bot, 3)), mat(new THREE.MeshLambertMaterial({ color: l.kind === 'lift' ? 0x3c6fb0 : 0xc9852f, transparent: true, opacity: 0.22, depthWrite: false })))
      shaft.position.set(a.x, (top + bot) / 2, a.z); scene.add(shaft)
    }
    // moving arrows along the route
    const arrowGeo = geo(new THREE.ConeGeometry(tubeR * 2.2, tubeR * 5, 12))
    const nArrows = Math.max(1, Math.min(160, Math.floor(total / (whole ? 9 : 3))))
    const arrows = new THREE.InstancedMesh(arrowGeo, mat(new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9ff0dc, emissiveIntensity: 0.6 })), nArrows)
    scene.add(arrows)
    // markers
    const ends: THREE.Object3D[] = [], scaled: THREE.Object3D[] = [], keep: THREE.Sprite[] = [] // keep = labels inside scaled markers
    const you = new THREE.Group()
    if (start && node.has(start.node)) {
      const ball = new THREE.Mesh(geo(new THREE.SphereGeometry(0.35, 24, 16)), mat(new THREE.MeshLambertMaterial({ color: 0x2563eb, emissive: 0x2563eb, emissiveIntensity: 0.35 })))
      ball.position.y = 0.6
      const ring = new THREE.Mesh(geo(new THREE.RingGeometry(0.5, 0.75, 32)), mat(new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.35, side: THREE.DoubleSide })))
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05
      const t = label(whole ? `You · ${start.title}` : 'You', '#2563eb', '#ffffff'); t.position.y = 1.2; keep.push(t)
      you.add(ball, ring, t); you.position.copy(P(start.node)); scene.add(you); scaled.push(you)
    }
    const endNode = whole ? dest?.node : legs[stage!].nodes[legs[stage!].nodes.length - 1]
    const nextV = whole ? undefined : legs[stage! + 1], goes = !!nextV && nextV.kind !== 'walk' && legs[stage!].kind === 'walk'
    const endName = whole ? dest?.title : legs[stage!].kind === 'walk' && (legs[stage!] as Extract<Leg, { kind: 'walk' }>).final ? dest?.title : goes ? undefined : names.get(endNode ?? '') // walking to a lift / stairs: its sign says it
    if (endNode && node.has(endNode)) {
      const pin = new THREE.Group(), r = 0.5
      const pm = mat(new THREE.MeshLambertMaterial({ color: 0xf2a15a, emissive: 0xe8892f, emissiveIntensity: 0.4 }))
      const head = new THREE.Mesh(geo(new THREE.SphereGeometry(r, 24, 16)), pm); head.position.y = r * 3.2
      const stem = new THREE.Mesh(geo(new THREE.ConeGeometry(r * 0.8, r * 2.6, 16)), pm); stem.rotation.x = Math.PI; stem.position.y = r * 1.4
      pin.add(head, stem)
      if (endName) { const t = label(endName, '#ffffff', '#0b5f53'); t.position.y = r * 4.6; keep.push(t); pin.add(t) }
      pin.position.copy(P(endNode)); scene.add(pin); ends.push(head); scaled.push(pin)
    }
    // lifts / stairs on the way: a lift / stairs sign (always on top, so nothing pokes through walls) saying where it
    // goes, and a pulsing ring on the floor at the one you're heading for / taking
    const rings: THREE.Mesh[] = [], labelled = new Set<string>()
    const vNear = whole ? [...legs.keys()] : [stage! - 1, stage!, stage! + 1]
    for (const j of vNear) {
      const l = legs[j]
      if (!l || l.kind === 'walk') continue
      const up = l.to > l.from, live = whole || j === stage || j === stage! + 1
      for (const [id, side] of [[l.nodes[0], -1], [l.nodes[l.nodes.length - 1], 1]] as const) {
        const nd = node.get(id)
        if (!nd || !shown.get(nd.level)) continue
        const g = new THREE.Group()
        g.position.copy(P(id))
        if (side < 0 && live) {
          const ring = new THREE.Mesh(geo(new THREE.RingGeometry(0.9, 1.25, 40)), mat(new THREE.MeshBasicMaterial({ color: l.kind === 'lift' ? 0x3c6fb0 : 0xe0902e, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })))
          ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; g.add(ring); rings.push(ring)
        }
        if (side < 0) labelled.add(id)
        const t = badge(l.kind, side < 0 ? `${names.get(id) ?? (l.kind === 'lift' ? 'Lift' : 'Stairs')} · ${up ? '↑' : '↓'} ${building.levels[l.to]?.name ?? ''}` : '')
        t.position.y = side < 0 ? 3.0 : 2.2; keep.push(t); g.add(t)
        scene.add(g); scaled.push(g)
      }
    }
    // room names near the route (only on solid floors, at most 40); the whole-route view only names the lifts / stairs used
    const roomLabels: THREE.Sprite[] = []
    const changes = new Set(legs.filter(l => l.kind !== 'walk').flatMap(l => [l.nodes[0], l.nodes[l.nodes.length - 1]]))
    if (whole) for (const id of changes) { const title = names.get(id); if (title && node.has(id) && !labelled.has(id)) { const t = label(title, 'rgba(255,255,255,0.92)', '#3b4f4a', false, 34); t.position.copy(P(id, WALL_H + 0.3)); scene.add(t) } }
    if (!whole) {
      let n = 0
      const seen = new Set<string>()
      for (const nd of building.nodes) {
        if (n >= 40 || !shown.get(nd.level)) continue
        const title = names.get(nd.id)
        if (!title || seen.has(title + nd.level) || nd.id === endNode || labelled.has(nd.id)) continue
        const p = P(nd.id)
        let near = false
        for (let i = 0; i < pts.length && !near; i += Math.max(1, Math.floor(pts.length / 200))) near = Math.abs(pts[i].y - p.y - 0.35) < 1 && Math.hypot(pts[i].x - p.x, pts[i].z - p.z) < (whole ? 14 : 9)
        if (!near) continue
        seen.add(title + nd.level); n++
        const t = label(title, 'rgba(255,255,255,0.92)', '#3b4f4a', false, 34); t.position.copy(P(nd.id, WALL_H + 0.3)); scene.add(t); roomLabels.push(t)
      }
    }

    // camera: orbit around the route, or travel along it
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.49; controls.screenSpacePanning = false
    // same as the 2D map: left-drag / one finger moves, right-drag rotates, two fingers zoom + turn
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault())
    const orbitHome = () => {
      const aspect = (el.clientWidth || 300) / (el.clientHeight || 200)
      const r = (liftStage ? Math.max(45, size.y * 2.2) : Math.max(30, size.length() * 1.05)) * Math.max(1, 1.25 / aspect) // tall phone screens: step back
      controls.target.copy(centre)
      camera.position.copy(centre).add(new THREE.Vector3(r * 0.55, r * 0.75, r * 0.65))
      controls.update()
    }
    let view: 'eye' | 'follow' | 'orbit' = 'orbit'
    let s = 0, speed = 0, flying = false, held = false, arrowK = 1
    const hold = (p: boolean) => { held = p && flying; setPaused(held); if (!held) speed = 0 } // resume eases back up to speed
    const look = new THREE.Vector3(), want = new THREE.Vector3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3()
    const place = (snap: boolean) => {
      const p = at(s, tmp)
      // look ahead along the route, level with the eye (so going up a lift you still look where you'll come out)
      let a = s + 6
      at(Math.min(total, a), tmp2)
      while (a < total && Math.hypot(tmp2.x - p.x, tmp2.z - p.z) < 2.5) { a += 1; at(Math.min(total, a), tmp2) }
      let dx = tmp2.x - p.x, dz = tmp2.z - p.z
      const d = Math.hypot(dx, dz)
      if (d < 0.01) { dx = look.x - camera.position.x; dz = look.z - camera.position.z }
      const k = 1 / (Math.hypot(dx, dz) || 1); dx *= k; dz *= k
      if (view === 'eye') { want.set(p.x, p.y - 0.35 + EYE, p.z); look.lerp(tmp2.set(p.x + dx * 8, want.y - 0.25, p.z + dz * 8), snap ? 1 : 0.1) }
      else { want.set(p.x - dx * 5.5, p.y + 6, p.z - dz * 5.5); look.lerp(tmp2.set(p.x + dx * 5, p.y - 0.2, p.z + dz * 5), snap ? 1 : 0.12) }
      you.position.set(p.x, p.y - 0.35, p.z)
      camera.position.lerp(want, snap ? 1 : 0.12)
      camera.lookAt(look)
    }
    const setView = (v: 'eye' | 'follow' | 'orbit') => {
      view = v; setMode(v)
      controls.enabled = v === 'orbit'
      const big = v === 'orbit' && (whole || liftStage)
      thick.visible = big; thin.visible = !big
      for (const o of scaled) o.scale.setScalar(big ? K : 1)
      for (const t of keep) { const b0 = (t.userData.base ??= t.scale.clone()) as THREE.Vector3; t.scale.set(b0.x / (big ? K : 1), b0.y / (big ? K : 1), 1) }
      arrowK = big ? K : 1
      you.visible = v !== 'eye' // at eye level you are the camera
      for (const o of above) o.visible = v !== 'follow' // the floor above would block the view from behind you
      if (v === 'orbit') { s = 0; const p0 = at(0, tmp); you.position.set(p0.x, p0.y - 0.35, p0.z) }
      if (v === 'orbit') { flying = false; hold(false); setPlaying(false); setCaption(''); camera.fov = 45; camera.updateProjectionMatrix(); orbitHome() }
      else { camera.fov = v === 'eye' ? 72 : 60; camera.updateProjectionMatrix(); place(true) }
    }
    const play = () => {
      if (view === 'orbit') setView('follow')
      s = 0; flying = true; hold(false); setPlaying(true); place(true)
    }
    api.current = { play, pause: hold, view: setView }
    const walkStage = !whole && legs[stage!].kind === 'walk'
    if (!walkStage) setView('orbit'); else { setView('follow'); setTimeout(() => { if (api.current) play() }, 700) }

    // size
    const resize = () => { const w = el.clientWidth || 300, h = el.clientHeight || 200; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
    const ro = new ResizeObserver(resize); ro.observe(el); resize()

    // Label declutter in screen space. Route signs (you, destination, level, lift and stair signs) are always drawn.
    // A room or landmark name is hidden while its rectangle overlaps a route sign or a name placed before it;
    // room names are placed before landmark names.
    const signs: THREE.Sprite[] = []
    scene.traverse(o => { if (o instanceof THREE.Sprite && o.renderOrder >= 10) signs.push(o) })
    const at3 = new THREE.Vector3(), size3 = new THREE.Vector3()
    // rectangle of a fixed-size sprite in normalised device coordinates [x0, y0, x1, y1]; null when outside the depth range
    const rectOf = (sp: THREE.Sprite): number[] | null => {
      sp.getWorldPosition(at3).project(camera)
      if (at3.z < -1 || at3.z > 1) return null
      sp.getWorldScale(size3)
      const w = size3.x * camera.projectionMatrix.elements[0], h = size3.y * camera.projectionMatrix.elements[5]
      const x0 = at3.x - sp.center.x * w, y0 = at3.y - sp.center.y * h
      return [x0, y0, x0 + w, y0 + h]
    }
    const declutter = () => {
      const used: number[][] = []
      for (const sp of signs) { if (!sp.visible || sp.parent?.visible === false) continue; const r = rectOf(sp); if (r) used.push(r) }
      const place = (sp: THREE.Sprite) => {
        const r = rectOf(sp)
        sp.visible = !!r && !used.some(q => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])
        if (sp.visible) used.push(r!)
      }
      for (const sp of roomLabels) if (sp.visible) place(sp) // room names already hidden by distance stay hidden
      for (const sp of landmarkLabels) place(sp)
    }

    // loop
    let raf = 0, last = performance.now(), phase = 0, shownCap = '', frame = 0
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1)
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      if (document.hidden) return
      phase = (phase + dt * (whole ? 9 : 3.5)) % (total / nArrows)
      for (let i = 0; i < nArrows; i++) {
        const sa = (phase + (i * total) / nArrows) % total
        at(sa, tmp); at(Math.min(total, sa + 0.5), tmp2); dir.subVectors(tmp2, tmp)
        if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0)
        q.setFromUnitVectors(up, dir.normalize()); m4.compose(tmp, q, one.setScalar(arrowK)); arrows.setMatrixAt(i, m4)
      }
      arrows.instanceMatrix.needsUpdate = true
      for (const e of ends) e.rotation.y += dt * 0.8
      const pz = ((now / 1000) % 1.6) / 1.6
      for (const r of rings) { r.scale.setScalar(1 + pz * 0.9); (r.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - pz) }
      if (++frame % 10 === 0) for (const t of roomLabels) t.visible = view === 'orbit' || t.position.distanceTo(camera.position) < 28
      if (frame % 10 === 0) declutter()
      if (flying && held) place(false) // paused: stay put (Eye level / Follow still switch)
      else if (flying) {
        at(s, tmp); at(Math.min(total, s + 1), tmp2)
        const vertical = Math.abs(tmp2.y - tmp.y) > 0.5
        const target = vertical ? 4 : view === 'eye' ? 4.2 : 7
        speed += (target - speed) * Math.min(1, dt * 2)
        s += speed * dt
        if (whole) { const c = captions[legOf(s)] ?? ''; if (c !== shownCap) { shownCap = c; setCaption(c) } }
        if (s >= total) { s = total; flying = false; setPlaying(false); if (whole) setTimeout(() => api.current?.view('orbit'), 1200) }
        place(false)
      } else if (view === 'orbit') controls.update()
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); api.current = null
      scene.traverse(o => { if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose() } })
      for (const g of geos) g.dispose()
      for (const m of mats) m.dispose()
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="r3d" ref={host}>
      {caption && <div className="r3d-cap" aria-live="polite">{caption}</div>}
      <div className="r3d-bar" role="group" aria-label="3D view">
        {playing
          ? <button className="r3d-play" onClick={() => api.current?.pause(!paused)} aria-pressed={!paused} aria-label={paused ? 'Resume walk-through' : 'Pause walk-through'}>{paused ? '▶ Play' : '❚❚ Stop'}</button>
          : <button className="r3d-play" onClick={() => api.current?.play()}>{stage === undefined ? '▶ Walk me through' : '▶ Replay'}</button>}
        {playing && paused && <button className="r3d-restart" onClick={() => api.current?.play()} aria-label="Start the walk-through again">↺ Restart</button>}
        <div className="r3d-seg">
          <button className={mode === 'eye' ? 'on' : ''} aria-pressed={mode === 'eye'} onClick={() => api.current?.view('eye')}>Eye level</button>
          <button className={mode === 'follow' ? 'on' : ''} aria-pressed={mode === 'follow'} onClick={() => api.current?.view('follow')}>Follow</button>
          <button className={mode === 'orbit' ? 'on' : ''} aria-pressed={mode === 'orbit'} onClick={() => api.current?.view('orbit')}>Overview</button>
        </div>
      </div>
    </div>
  )
}
