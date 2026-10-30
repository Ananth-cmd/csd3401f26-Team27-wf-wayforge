// 3D / 2D floor map (orthographic camera, tilt 48° in 3D, straight down in 2D). North is up in both until you rotate;
// the compass shows where north is and puts it back up. Fills its parent.
// Left-drag / 1 finger = move, right-drag (or Shift + left-drag) = rotate, 2 fingers = move + pinch zoom + twist to
// rotate, wheel = zoom, tap a room = pick it.
// Labels: far away only the block names (E1, W1...), closer in the room names, never on top of each other.
// Speed for large buildings (Ananth): shapes are projected around the floor centre, so panning and zooming only move
// the SVG viewBox; slabs, zones and walls are rebuilt only when the floor or the rotation changes.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Building, Vec2 } from './types'
import { buildMassing, massInput } from './massing'
import type { MassBlock } from './massing'

const WALL_H = 1.2 // low walls: reads like a floor plan, and nearer walls hide less of the rooms behind them
const SLAB_T = 0.45
const ROOM_LABELS_FROM = 4.5 // px per metre at which room names start to show
const MASS_ZOOM = 0.5 // zoomed out at least this far (1 = whole floor): the campus shows as 3D buildings
const ICONS_FROM = 2.2 // px per metre at which toilet / lift / stairs / food icons show
// room colour by type (each room's place says what it is); classes are styled in index.css
const roomClass = (category: string, name: string) => {
  const n = name.toLowerCase(), c = category.toLowerCase()
  if (/\b(wc|toilet|restroom|washroom)/.test(n) || c === 'toilet') return 'r-toilet'
  if (/canteen|caf[eé]|food|dining|kiosk/.test(n) || c === 'food') return 'r-food'
  if (/library|bookshop/.test(n)) return 'r-lib'
  if (c === 'lift' || /\blift\b/.test(n)) return 'r-lift'
  if (c === 'stair' || c === 'stairs' || /\bstair/.test(n)) return 'r-stair'
  if (c === 'corridor' || /corridor|link bridge|walkway/.test(n)) return 'r-corr'
  if (c === 'lobby' || /lobby|foyer|entrance|atrium/.test(n)) return 'r-lobby'
  if (c === 'lab' || /\blab\b|laborator/.test(n)) return 'r-lab'
  if (c === 'office' || /office|services/.test(n)) return 'r-office'
  if (c === 'storage' || /store|storage/.test(n)) return 'r-store'
  return 'r-room'
}
const ICON_OF: Record<string, string> = { 'r-toilet': 'wf-i-toilet', 'r-lift': 'wf-i-lift', 'r-stair': 'wf-i-stair', 'r-food': 'wf-i-food' }
// 3D campus buildings, worked out once per building in a background worker (massing.ts)
const massCache = new WeakMap<Building, Promise<MassBlock[]>>()
function loadMassing(b: Building, node: Map<string, { level: number; pos: Vec2 }>): Promise<MassBlock[]> {
  let p = massCache.get(b)
  if (p) return p
  const input = massInput(b, node)
  p = new Promise<MassBlock[]>(resolve => {
    const fallback = () => setTimeout(() => resolve(buildMassing(input)), 50)
    try {
      const w = new Worker(new URL('./massing.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = e => { resolve(e.data as MassBlock[]); w.terminate() }
      w.onerror = () => { w.terminate(); fallback() }
      w.postMessage(input)
    } catch { fallback() }
  })
  massCache.set(b, p)
  return p
}
const inPoly = (x: number, z: number, poly: Vec2[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
const MAX_PIECES = 2500 // wall pieces per floor in 3D (more = better overlap, slower)
const PIECE_M = 6 // shortest piece, metres
type V3 = [number, number, number]

export type MapProps = {
  building: Building
  floor: number
  topDown?: boolean
  onTopDown?: (v: boolean) => void // shows the 3D / 2D switch on the map
  lines?: string[][] // node-id paths to draw on this floor
  done?: string[][] // paths already walked (drawn grey)
  here?: string | null // "you are here" node (blue)
  pin?: { node: string; label: string } | null // destination / next landmark (orange)
  focus?: string[] // node ids to zoom in on (e.g. the current stretch of the route)
  names?: Map<string, string> // node id -> name to show (only these get room labels; corridors etc. stay unlabelled)
  onPick?: (node: string) => void // tap on a named point
}

const short = (s: string) => s.replace(/\s*\(Level \d+\)/, '')
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
// block name from a room code or id: "W1-01-15" / "W1_r185" -> "W1"
const blockOf = (s: string) => /^([A-Za-z]{1,2}\d{1,2})[-_]/.exec(s.trim())?.[1]?.toUpperCase()

function MapView({ building, floor, topDown = false, onTopDown, lines = [], done = [], here, pin, focus, names, onPick }: MapProps) {
  const pickRef = useRef(onPick)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref / one-off sync, intentional
  pickRef.current = onPick
  const lvl = building.levels[floor]
  const node = useMemo(() => new Map(building.nodes.map(n => [n.id, n])), [building])
  const floorNodes = useMemo(() => building.nodes.filter(n => n.level === floor), [building, floor])
  // which block (E1, W1...) each point belongs to, from the place codes / names / ids
  const blocks = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of building.pois) { const bl = blockOf(p.code) ?? blockOf(p.name.replace(/^Room\s+/, '')); if (bl) m.set(p.node, bl) }
    for (const n of building.nodes) if (!m.has(n.id)) { const bl = blockOf(n.id.replace(/^[^:]*:/, '')) ?? blockOf(n.label.replace(/^Room\s+/, '')); if (bl) m.set(n.id, bl) }
    return m
  }, [building])

  // container size
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 300, h: 200, ready: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.max(50, el.clientWidth), h: Math.max(50, el.clientHeight), ready: true }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const centre = useMemo<V3>(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const f of lvl.floors) for (const p of f) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]) }
    return [(x0 + x1) / 2, 0, (z0 + z1) / 2]
  }, [lvl])

  const defYaw = 0 // north up in 3D and 2D
  const pitch = ((topDown ? 90 : 48) * Math.PI) / 180
  const basis = (yawDeg: number) => {
    const psi = (yawDeg * Math.PI) / 180
    const right: V3 = [Math.cos(psi), 0, -Math.sin(psi)]
    const fwdH: V3 = [Math.sin(psi), 0, Math.cos(psi)]
    const fwd: V3 = [Math.cos(pitch) * fwdH[0], -Math.sin(pitch), Math.cos(pitch) * fwdH[2]]
    const up: V3 = [Math.sin(pitch) * fwdH[0], Math.cos(pitch), Math.sin(pitch) * fwdH[2]]
    return { right, fwdH, fwd, up }
  }

  // 3D campus buildings (only when the backend sent room outlines; otherwise the floor plan as before)
  const hasRooms = building.levels.some(l => l.floors.length > 1)
  const [mass, setMass] = useState<MassBlock[] | null>(null)
  useEffect(() => {
    let live = true
    setMass(null) // eslint-disable-line react-hooks/set-state-in-effect -- a new building: drop the old outlines
    if (hasRooms) void loadMassing(building, node).then(m => { if (live) setMass(m) })
    return () => { live = false }
  }, [building, hasRooms, node])
  const massTop = mass ? Math.max(...mass.map(m => m.top)) : 0

  // whole floor fits at zoom 1 (worked out at the default rotation, so rotating never changes the zoom)
  const fit = useMemo(() => {
    const { right: r0, up: u0 } = basis(defYaw)
    let mx = 1, my = 1
    for (const f of lvl.floors) for (const p of f) for (const y of [-SLAB_T, Math.max(WALL_H, massTop * 0.8)]) {
      const r: V3 = [p[0] - centre[0], y, p[1] - centre[2]]
      mx = Math.max(mx, Math.abs(dot(r, r0))); my = Math.max(my, Math.abs(dot(r, u0)))
    }
    return { mx: mx * 1.08, my: my * 1.12 }
  }, [lvl, centre, topDown, massTop]) // eslint-disable-line
  const aspect = size.w / size.h
  const baseVh = Math.max(fit.my * 2, (fit.mx * 2) / aspect)

  // view that frames the focus points (or the whole floor)
  const focusKey = (focus ?? []).filter(id => node.get(id)?.level === floor).join('|')
  const framed = () => {
    const ids = focusKey ? focusKey.split('|') : []
    if (!ids.length) return { t: centre, zoom: 1, yaw: defYaw }
    const { right: r0, up: u0 } = basis(defYaw)
    const ps = ids.map(id => node.get(id)!.pos)
    const c: V3 = [ps.reduce((s, p) => s + p[0], 0) / ps.length, 0, ps.reduce((s, p) => s + p[1], 0) / ps.length]
    let mx = 10, my = 10 // at least ~20 m across
    for (const p of ps) { const r: V3 = [p[0] - c[0], 0, p[1] - c[2]]; mx = Math.max(mx, Math.abs(dot(r, r0))); my = Math.max(my, Math.abs(dot(r, u0))) }
    const vh = Math.max(my * 2 * 1.5, (mx * 2 * 1.35) / aspect)
    return { t: c, zoom: Math.min(1, Math.max(0.02, vh / baseVh)), yaw: defYaw }
  }
  const [cam, setCam] = useState<{ t: V3; zoom: number; yaw: number }>(framed)
  const reset = () => setCam(framed())
  useEffect(reset, [centre, topDown, focusKey, size.ready]) // eslint-disable-line
  const { t: target, zoom, yaw } = cam

  const { right, fwdH, fwd, up } = basis(yaw)
  const projAt = (p: V3, t: V3): Vec2 => { const r: V3 = [p[0] - t[0], p[1] - t[1], p[2] - t[2]]; return [dot(r, right), -dot(r, up)] }
  const proj = (p: V3) => projAt(p, centre) // fixed around the floor centre
  const view = projAt(target, centre) // where the camera looks, in the same units (moves the viewBox only)
  const pt = (p: V3) => proj(p).join(',')
  const at = (id: string, y = 0): Vec2 => { const n = node.get(id)!; return proj([n.pos[0], y, n.pos[1]]) }

  const vh = baseVh * zoom
  const vw = vh * aspect
  const k = vh / size.h // metres per screen pixel
  const pxPerM = 1 / k
  const massMode = !!mass && mass.length > 0 && !topDown && zoom >= MASS_ZOOM
  const lift = (id: string) => (massMode ? building.levels[node.get(id)?.level ?? floor]?.elevation ?? 0 : 0) // markers sit on their floor

  // floor slab (top + visible edges)
  const slab = useMemo(() => lvl.floors.map(f => {
    const sides: V3[][] = []
    if (!topDown) for (let i = 0; i < f.length; i++) {
      const p = f[i], q = f[(i + 1) % f.length]
      const cx = (p[0] + q[0]) / 2 - centre[0], cz = (p[1] + q[1]) / 2 - centre[2]
      if (dot([cx, 0, cz], fwd) >= 0) continue
      sides.push([[p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], -SLAB_T, q[1]], [p[0], -SLAB_T, p[1]]])
    }
    return { top: f.map(p => [p[0], 0, p[1]] as V3), sides }
  }), [lvl, centre, yaw, topDown]) // eslint-disable-line

  // walls as boxes, far to near. In 3D long walls are cut into short pieces first: sorting whole walls by their
  // middle drew long walls over the short walls they cross (angled blocks looked like floors stacked on each other).
  // The number of pieces is capped (MAX_PIECES) so big floors stay quick to draw, and while you're turning the map
  // whole walls are used (as fast as before); the pieces come back when you let go.
  const [turning, setTurning] = useState(false)
  const walls = useMemo(() => {
    const out: { depth: number; polys: { pts: V3[]; shade: number }[] }[] = []
    let total = 0
    for (const wl of lvl.walls) total += Math.hypot(wl.b[0] - wl.a[0], wl.b[1] - wl.a[1])
    const piece = topDown || turning ? Infinity : Math.max(PIECE_M, total / MAX_PIECES)
    for (const wl of lvl.walls) {
      const dx = wl.b[0] - wl.a[0], dz = wl.b[1] - wl.a[1], len = Math.hypot(dx, dz) || 1
      const ux = dx / len, uz = dz / len, t = wl.thickness / 2, nx = -uz * t, nz = ux * t
      const n = Math.max(1, Math.ceil(len / piece))
      for (let k = 0; k < n; k++) {
        // piece from s0 to s1 along the wall (the real ends stick out by half the thickness, like before)
        const s0 = k === 0 ? -t : (k * len) / n - 0.01, s1 = k === n - 1 ? len + t : ((k + 1) * len) / n + 0.01
        const A: Vec2 = [wl.a[0] + ux * s0, wl.a[1] + uz * s0], B: Vec2 = [wl.a[0] + ux * s1, wl.a[1] + uz * s1]
        const c: Vec2[] = [[A[0] + nx, A[1] + nz], [B[0] + nx, B[1] + nz], [B[0] - nx, B[1] - nz], [A[0] - nx, A[1] - nz]]
        const mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]
        const polys: { pts: V3[]; shade: number }[] = []
        if (!topDown) for (let i = 0; i < 4; i++) {
          if ((i === 1 && k < n - 1) || (i === 3 && k > 0)) continue // inner cut ends are hidden by the next piece
          const p = c[i], q = c[(i + 1) % 4]
          const mx = (p[0] + q[0]) / 2 - mid[0], mz = (p[1] + q[1]) / 2 - mid[1]
          if (dot([mx, 0, mz], fwd) >= 0) continue
          polys.push({ pts: [[p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], WALL_H, q[1]], [p[0], WALL_H, p[1]]], shade: dot([mx, 0, mz], right) < 0 ? 1 : 2 })
        }
        polys.push({ pts: c.map(p => [p[0], WALL_H, p[1]] as V3), shade: n > 1 ? 3 : 0 }) // 3 = top of a cut piece (no outline, so no seams)
        out.push({ depth: dot([mid[0], 0, mid[1]], fwd), polys })
      }
    }
    return out.sort((a, b) => b.depth - a.depth)
  }, [lvl, topDown, yaw, turning]) // eslint-disable-line

  const zone = (id: string, half: number, cls: string) => {
    const n = node.get(id)!, [x, z] = n.pos
    return <polygon key={`z-${id}`} className={cls} points={[[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]].map(p => pt([p[0], 0.02, p[1]])).join(' ')} />
  }
  // slabs, stair / lift zones and walls: rebuilt only when the floor or the rotation changes (not on pan / zoom)
  const under = useMemo(() => <>
    {slab.map((s, i) => <g key={i}>
      {s.sides.map((sd, j) => <polygon key={j} className="m-slab-side" points={sd.map(pt).join(' ')} />)}
      <polygon className="m-slab" points={s.top.map(pt).join(' ')} />
    </g>)}
    {floorNodes.filter(n => n.kind === 'stairs').map(n => zone(n.id, 2.2, 'm-zone stairs'))}
    {floorNodes.filter(n => n.kind === 'lift').map(n => zone(n.id, 2.2, 'm-zone lift'))}
  </>, [slab, floorNodes]) // eslint-disable-line
  const wallShapes = useMemo(() => walls.map((w, i) => w.polys.map((p, j) => <polygon key={`${i}-${j}`} className={`m-wall s${p.shade}`} points={p.pts.map(pt).join(' ')} />)),
    [walls, centre]) // eslint-disable-line
  // ---- rooms coloured by type: the backend sends each room's outline as a floor polygon, and each room has a place ----
  const rooms = useMemo(() => {
    const polys = lvl.floors
    if (polys.length < 2) return null // one big slab: nothing to colour
    const box = polys.map(f => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of f) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) } return [x0, x1, z0, z1] })
    const which = (x: number, z: number) => { for (let i = 0; i < polys.length; i++) { const b = box[i]; if (x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3] && inPoly(x, z, polys[i])) return i } return -1 }
    const cls: string[] = polys.map(() => 'r-room')
    const icons: { id: string; icon: string }[] = []
    for (const p of building.pois) {
      const n = node.get(p.node)
      if (!n || n.level !== floor) continue
      const c = roomClass(p.category ?? '', p.name ?? ''), i = which(n.pos[0], n.pos[1])
      if (i >= 0 && cls[i] === 'r-room') cls[i] = c
      if (ICON_OF[c]) icons.push({ id: p.node, icon: ICON_OF[c] })
    }
    return { cls, which, icons }
  }, [building, floor, lvl, node])
  const roomShapes = useMemo(() => rooms && lvl.floors.map((f, i) => <polygon key={`rm-${i}`} className={`m-room ${rooms.cls[i]}`} points={f.map(p => pt([p[0], 0.01, p[1]])).join(' ')} />),
    [rooms, lvl, centre, yaw, topDown]) // eslint-disable-line
  // ---- 3D campus: blocks far to near, each floor a slab with walls, window bands and a roof ----
  const massShapes = useMemo(() => {
    if (!massMode || !mass) return null
    const out: React.ReactElement[] = []
    const blocks = [...mass].sort((a, b) => dot([b.centre[0], 0, b.centre[1]], fwd) - dot([a.centre[0], 0, a.centre[1]], fwd))
    for (const m of blocks) for (const L of m.levels) {
      const y0 = L.elev, y1 = L.elev + L.h - 0.15
      const faces: { d: number; el: React.ReactElement }[] = []
      L.rings.forEach((r, ri) => r.forEach((p, i) => {
        const q = r[(i + 1) % r.length], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz)
        if (len < 0.3) return
        const nx = dz / len, nz = -dx / len // outward (the filled side is on the left)
        if (dot([nx, 0, nz], fwd) >= 0) return // faces away from the camera
        const shade = dot([nx, 0, nz], right) < 0 ? 'a' : 'b'
        const d = dot([(p[0] + q[0]) / 2, 0, (p[1] + q[1]) / 2], fwd)
        const pts = [pt([p[0], y0, p[1]]), pt([q[0], y0, q[1]]), pt([q[0], y1, q[1]]), pt([p[0], y1, p[1]])].join(' ')
        const win = len >= 3 && L.h >= 2.5 ? (() => { const ux = dx / len, uz = dz / len, a = 0.6, b = len - 0.6, wy0 = y0 + 1.1, wy1 = y1 - 0.7
          return <polygon className="m-win" points={[pt([p[0] + ux * a, wy0, p[1] + uz * a]), pt([p[0] + ux * b, wy0, p[1] + uz * b]), pt([p[0] + ux * b, wy1, p[1] + uz * b]), pt([p[0] + ux * a, wy1, p[1] + uz * a])].join(' ')} /> })() : null
        faces.push({ d, el: <g key={`${ri}-${i}`}><polygon className={`m-face ${shade}`} points={pts} />{win}</g> })
      }))
      faces.sort((a, b) => b.d - a.d)
      const roof = L.rings.map(r => 'M' + r.map(p => pt([p[0], y1, p[1]])).join('L') + 'Z').join('')
      const state = L.level === floor ? ' cur' : L.level > floor ? ' above' : ''
      out.push(<g key={`${m.name}-${L.level}`} className={`m-mass${state}`}>{faces.map(f => f.el)}<path className="m-roof" d={roof} fillRule="evenodd" /></g>)
    }
    return out
  }, [massMode, mass, yaw, centre, floor]) // eslint-disable-line
  const pinNode = pin && node.get(pin.node)?.level === floor ? pin : null
  const pinRoom = pinNode && rooms ? rooms.which(node.get(pinNode.node)!.pos[0], node.get(pinNode.node)!.pos[1]) : -1
  const entrances = useMemo(() => floorNodes.filter(n => /\bentrance\b/i.test(names?.get(n.id) ?? n.label)), [floorNodes, names])
  const hereNode = here && node.get(here)?.level === floor ? here : null

  // ---- labels: never overlapping; block names when far, room names when close ----
  type Lab = { x: number; y: number; text: string; cls: string; size: number }
  const labels: Lab[] = []
  {
    const taken: [number, number, number, number][] = [] // boxes in px around the centre
    const free = (cx: number, cy: number, w: number, h: number) => {
      for (const [x0, y0, x1, y1] of taken) if (cx - w / 2 < x1 && cx + w / 2 > x0 && cy - h / 2 < y1 && cy + h / 2 > y0) return false
      return true
    }
    const tryAdd = (sx: number, sy: number, text: string, cls: string, size: number) => {
      const px = (sx - view[0]) / k, py = (sy - view[1]) / k, w = text.length * size * 0.56 + 8, h = size + 6
      if (Math.abs(px) > size_w2 + w || Math.abs(py) > size_h2 + h) return // off screen
      if (!free(px, py, w, h)) return
      taken.push([px - w / 2, py - h / 2, px + w / 2, py + h / 2])
      labels.push({ x: sx, y: sy, text, cls, size })
    }
    const size_w2 = size.w / 2, size_h2 = size.h / 2
    // keep the space around the pin / you markers clear
    for (const id of [pinNode?.node, hereNode]) if (id) { const [x, y] = at(id, 0.15), X = (x - view[0]) / k, Y = (y - view[1]) / k; taken.push([X - 16, Y - 16, X + 16, Y + 16]) }
    if (pinNode) { const [x, y] = at(pinNode.node, 0.15), X = (x - view[0]) / k, Y = (y - view[1]) / k; const w = short(pinNode.label).length * 6.6 + 24; taken.push([X + 14, Y - 16, X + 18 + w, Y + 16]) }
    // keep the toilet / lift / stairs / food icons clear
    const iconAt = new Set<string>()
    if (rooms && pxPerM >= ICONS_FROM) for (const { id } of rooms.icons) { iconAt.add(id); const [x, y] = at(id, 0.1), X = (x - view[0]) / k, Y = (y - view[1]) / k; taken.push([X - 10, Y - 10, X + 10, Y + 10]) }
    const nameOf = (id: string) => names ? names.get(id) : node.get(id)!.kind !== 'turn' ? node.get(id)!.label : undefined
    // entrances always get a label (people orient by them)
    // (only once zoomed in to a block; far out the block names come first and the diamonds mark the entrances)
    if (pxPerM >= ICONS_FROM) for (const n of entrances) { const [sx, sy] = proj([n.pos[0], 0.1, n.pos[1]]); tryAdd(sx, sy + 16 * k, short(nameOf(n.id) ?? 'Entrance'), 'm-label ent', 11) }
    if (pxPerM >= ROOM_LABELS_FROM) {
      const named = floorNodes.filter(n => nameOf(n.id) && !entrances.includes(n))
      // nearest to the middle of the view first, so the labels you're looking at win
      const scored = named.map(n => { const [sx, sy] = proj([n.pos[0], 0.1, n.pos[1]]); return { n, sx, sy, d: (sx - view[0]) ** 2 + (sy - view[1]) ** 2 } }).sort((a, b) => a.d - b.d)
      for (const { n, sx, sy } of scored.slice(0, 400)) tryAdd(sx, sy + (iconAt.has(n.id) ? 19 : 12) * k, short(nameOf(n.id)!), n.kind === 'room' ? 'm-label' : 'm-label vert', 10.5)
    } else if (massMode) {
      // 3D campus: block names on the roofs (raised link bridges stay unlabelled)
      for (const m of mass!) if (!(m.levels.length === 1 && m.levels[0].elev > 0)) { const [sx, sy] = proj([m.centre[0], m.top + 1, m.centre[1]]); tryAdd(sx, sy, m.name, 'm-block', 15) }
    } else {
      // far away: one label per block, at the middle of its rooms
      const groups = new Map<string, [number, number, number]>()
      for (const n of floorNodes) { const bl = blocks.get(n.id); if (!bl) continue; const g = groups.get(bl) ?? [0, 0, 0]; g[0] += n.pos[0]; g[1] += n.pos[1]; g[2]++; groups.set(bl, g) }
      for (const [bl, [x, z, c]] of groups) { const [sx, sy] = proj([x / c, WALL_H, z / c]); tryAdd(sx, sy, bl, 'm-block', 15) }
    }
  }

  // ---- gestures ----
  const svgRef = useRef<SVGSVGElement>(null)
  const sinp = Math.sin(pitch)
  const live = useRef({ k, sinp, right, fwdH })
  // eslint-disable-next-line react-hooks/refs -- latest-value ref / one-off sync, intentional
  live.current = { k, sinp, right, fwdH }
  const clampZoom = (z: number) => Math.min(2.5, Math.max(0.02, z))
  const panBy = (dx: number, dy: number) => setCam(c => {
    const { k, sinp, right, fwdH } = live.current
    const a = -dx * k, b = (dy * k) / sinp
    return { ...c, t: [c.t[0] + right[0] * a + fwdH[0] * b, 0, c.t[2] + right[2] * a + fwdH[2] * b] }
  })
  const zoomAt = (factor: number, px = 0, py = 0) => setCam(c => {
    const { k, sinp, right, fwdH } = live.current
    const z = clampZoom(c.zoom * factor), r = z / c.zoom
    const a = px * k * (1 - r), b = (py * k * (r - 1)) / sinp
    return { yaw: c.yaw, zoom: z, t: [c.t[0] + right[0] * a + fwdH[0] * b, 0, c.t[2] + right[2] * a + fwdH[2] * b] }
  })
  const fromCentre = (x: number, y: number) => {
    const r = svgRef.current!.getBoundingClientRect()
    return [x - r.left - r.width / 2, y - r.top - r.height / 2] as Vec2
  }
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = fromCentre(e.clientX, e.clientY)
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomAt(Math.exp(Math.max(-60, Math.min(60, dy)) * (e.ctrlKey ? 0.01 : 0.002)), px, py)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line

  const ptrs = useRef(new Map<number, Vec2>())
  const pinch = useRef<{ d: number; m: Vec2; a: number } | null>(null)
  const panMode = useRef(false)
  const tap = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    tap.current = ptrs.current.size === 1 && e.button === 0 ? { x: e.clientX, y: e.clientY, moved: false } : null // right-click never picks a room
    panMode.current = !(e.button === 2 || (e.button === 0 && e.shiftKey && e.pointerType === 'mouse')) // right mouse rotates, left moves
    pinch.current = null
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId); pinch.current = null
    if (ptrs.current.size === 0) setTurning(false)
    const t = tap.current; tap.current = null
    if (!t || t.moved || e.type !== 'pointerup') return
    if (massMode && mass) { // tap a building: zoom in to its floor plan
      const [px, py] = fromCentre(e.clientX, e.clientY)
      let hit: MassBlock | null = null, hd = Infinity
      for (const m of mass) {
        if (m.levels.length === 1 && m.levels[0].elev > 0) continue
        const [sx, sy] = proj([m.centre[0], m.top / 2, m.centre[1]]), d = ((sx - view[0]) / k - px) ** 2 + ((sy - view[1]) / k - py) ** 2
        const reach = Math.max(m.box[1] - m.box[0], m.box[3] - m.box[2]) / 2 / k + 20
        if (d < reach * reach && d < hd) { hd = d; hit = m }
      }
      if (hit) { const span = Math.max(hit.box[1] - hit.box[0], hit.box[3] - hit.box[2]) * 1.25; setCam(c => ({ ...c, t: [hit!.centre[0], 0, hit!.centre[1]], zoom: Math.min(MASS_ZOOM * 0.8, Math.max(0.02, span / aspect / baseVh)) })) }
      return
    }
    if (!pickRef.current) return
    // nearest named point within ~22 px of the tap
    const [px, py] = fromCentre(e.clientX, e.clientY)
    let best = '', bd = 22 * 22
    for (const n of floorNodes) {
      if (!(names ? names.has(n.id) : n.kind !== 'turn')) continue
      const [sx, sy] = at(n.id, 0.1), dx = (sx - view[0]) / k - px, dy = (sy - view[1]) / k - py, d = dx * dx + dy * dy
      if (d < bd) { bd = d; best = n.id }
    }
    if (best) pickRef.current(best)
  }
  const onMove = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId)
    if (!prev) return
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size >= 2) {
      tap.current = null
      const [a, b] = [...ptrs.current.values()]
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ang = Math.atan2(b[1] - a[1], b[0] - a[0])
      if (pinch.current && d > 10) {
        panBy(m[0] - pinch.current.m[0], m[1] - pinch.current.m[1])
        const [px, py] = fromCentre(m[0], m[1])
        zoomAt(pinch.current.d / d, px, py)
        // twist two fingers to rotate (the map turns with your fingers)
        let da = ang - pinch.current.a
        if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI
        if (Math.abs(da) > 0.002) { setTurning(true); setCam(c => ({ ...c, yaw: c.yaw - (da * 180) / Math.PI })) }
      }
      pinch.current = { d, m, a: ang }
      return
    }
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1]
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 6) tap.current.moved = true
    if (tap.current && !tap.current.moved) return
    if (panMode.current) panBy(dx, dy)
    else { setTurning(true); setCam(c => ({ ...c, yaw: c.yaw + dx * 0.4 })) } // drag right = turn the building right
  }

  return (
    <div className={`mapview${topDown ? ' flat' : ''}`} ref={ref}>
      <svg ref={svgRef} className={[onPick ? 'pickable' : '', rooms ? 'has-rooms' : '', pxPerM < 2 ? 'far' : '', massMode ? 'mass' : ''].filter(Boolean).join(' ') || undefined} viewBox={`${view[0] - vw / 2} ${view[1] - vh / 2} ${vw} ${vh}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onContextMenu={e => e.preventDefault()} onDoubleClick={e => { const [px, py] = fromCentre(e.clientX, e.clientY); zoomAt(0.6, px, py) }} role="img" aria-label={`${lvl.name} map`}>
        <defs>
          <symbol id="wf-i-toilet" viewBox="0 0 24 24"><g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="5" r="1.6" /><circle cx="16" cy="5" r="1.6" /><path d="M8 9v11M16 9l-3 7h6zM16 16v4" /></g></symbol>
          <symbol id="wf-i-lift" viewBox="0 0 24 24"><g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></g></symbol>
          <symbol id="wf-i-stair" viewBox="0 0 24 24"><g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19h5v-5h5V9h6" /></g></symbol>
          <symbol id="wf-i-food" viewBox="0 0 24 24"><g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2.5 1.5-3.5 4-3.5 7.5H17" /></g></symbol>
        </defs>
        {under}
        {!massMode && roomShapes}
        {massShapes}
        {pinRoom >= 0 ? <polygon className="m-room r-dest" points={lvl.floors[pinRoom].map(p => pt([p[0], 0.02, p[1]])).join(' ')} strokeWidth={2 * k} />
          : pinNode && node.get(pinNode.node)!.kind === 'room' && zone(pinNode.node, 2.6, 'm-zone dest')}
        {wallShapes}
        {done.map((ids, i) => {
          const ps = ids.filter(id => node.get(id)?.level === floor).map(id => at(id, 0.15 + lift(id)).join(','))
          return ps.length > 1 && <polyline key={`d-${i}`} className="m-done" points={ps.join(' ')} strokeWidth={6 * k} />
        })}
        {lines.map((ids, i) => {
          const ps = ids.filter(id => node.get(id)?.level === floor).map(id => at(id, 0.15 + lift(id)).join(','))
          return ps.length > 1 && <g key={`r-${i}`}>
            <polyline className="m-route-casing" points={ps.join(' ')} strokeWidth={9 * k} />
            <polyline className="m-route" points={ps.join(' ')} strokeWidth={6 * k} />
          </g>
        })}
        {rooms && pxPerM >= ICONS_FROM && rooms.icons.map(({ id, icon }) => { const [x, y] = at(id, 0.1), r = 9 * k; return <g key={`ic-${id}`} className={`m-icon ${icon}`}><circle cx={x} cy={y} r={r} strokeWidth={1.5 * k} /><use href={`#${icon}`} x={x - r * 0.62} y={y - r * 0.62} width={r * 1.24} height={r * 1.24} /></g> })}
        {entrances.map(n => { const [x, y] = at(n.id, 0.15); return <rect key={`e-${n.id}`} x={x - 6 * k} y={y - 6 * k} width={12 * k} height={12 * k} rx={3 * k} className="m-entrance" strokeWidth={2 * k} transform={`rotate(45 ${x} ${y})`} /> })}
        {labels.map((l, i) => <text key={`l-${i}`} x={l.x} y={l.y} fontSize={l.size * k} className={l.cls}>{l.text}</text>)}
        {hereNode && (() => { const [x, y] = at(hereNode, 0.15 + lift(hereNode)); return <g><circle cx={x} cy={y} r={15 * k} className="m-here-halo" /><circle cx={x} cy={y} r={8 * k} className="m-here" strokeWidth={2.5 * k} /></g> })()}
        {pinNode && (() => {
          const [x, y] = at(pinNode.node, 0.15 + lift(pinNode.node)), label = short(pinNode.label), w = (label.length * 6.6 + 24) * k
          const left = x - view[0] + 16 * k + w > vw / 2 - 64 * k // flip the callout so it stays clear of the edge and the zoom buttons
          const rx = left ? x - 16 * k - w : x + 16 * k
          return <g>
            <rect x={rx} y={y - 15 * k} width={w} height={30 * k} rx={8 * k} className="m-callout" />
            <text x={rx + 12 * k} y={y + 4 * k} fontSize={12 * k} className="m-callout-t">{label}</text>
            <circle cx={x} cy={y} r={12 * k} className="m-pin" />
            <circle cx={x} cy={y - 1 * k} r={3.5 * k} className="m-pin-dot" />
          </g>
        })()}
      </svg>
      <button className="compass" onClick={() => setCam(c => ({ ...c, yaw: 0 }))} aria-label="North up" title="North up">
        <svg viewBox="0 0 32 32" style={{ transform: `rotate(${-yaw}deg)` }}><text x="16" y="9" className="t">N</text><path d="M16 10.5 20 18h-8z" className="n" /><path d="M16 26 12 18h8z" className="s" /></svg>
      </button>
      {onTopDown && (
        <div className="view-toggle" role="group" aria-label="Map view">
          <button className={!topDown ? 'on' : ''} aria-pressed={!topDown} onClick={() => onTopDown(false)}>3D</button>
          <button className={topDown ? 'on' : ''} aria-pressed={topDown} onClick={() => onTopDown(true)}>2D</button>
        </div>
      )}
      <div className="map-ctrl">
        <button aria-label="Zoom in" onClick={() => zoomAt(1 / 1.5)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomAt(1.5)}>−</button>
        <button aria-label="Reset view" onClick={reset} title="Reset view">⟲</button>
      </div>
    </div>
  )
}

// Don't redraw the map while typing elsewhere on the page: only when what it shows changes.
const same = (a: MapProps, b: MapProps) =>
  a.building === b.building && a.floor === b.floor && !!a.topDown === !!b.topDown && !!a.onTopDown === !!b.onTopDown &&
  a.here === b.here && a.pin?.node === b.pin?.node && a.pin?.label === b.pin?.label && a.names === b.names && !!a.onPick === !!b.onPick &&
  (a.focus ?? []).join('|') === (b.focus ?? []).join('|') &&
  (a.lines ?? []).map(l => l.join(',')).join('|') === (b.lines ?? []).map(l => l.join(',')).join('|') &&
  (a.done ?? []).map(l => l.join(',')).join('|') === (b.done ?? []).map(l => l.join(',')).join('|')

export default memo(MapView, same)
