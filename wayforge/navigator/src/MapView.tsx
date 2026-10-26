// 3D / 2D floor map (orthographic camera, tilt 48° in 3D, straight down in 2D). North is up in both until you rotate;
// the compass shows where north is and puts it back up. Fills its parent.
// Drag = rotate (3D) or move (2D), Shift/right-drag or 2 fingers = move, wheel / pinch = zoom, tap a room = pick it.
// Labels: far away only the block names (E1, W1...), closer in the room names, never on top of each other.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Building, Vec2 } from './types'

const WALL_H = 1.9
const SLAB_T = 0.45
const ROOM_LABELS_FROM = 4.5 // px per metre at which room names start to show
type V3 = [number, number, number]

export type MapProps = {
  building: Building
  floor: number
  topDown?: boolean
  onTopDown?: (v: boolean) => void // shows the 3D / 2D switch on the map
  lines?: string[][] // node-id paths to draw on this floor
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

function MapView({ building, floor, topDown = false, onTopDown, lines = [], here, pin, focus, names, onPick }: MapProps) {
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

  // whole floor fits at zoom 1 (worked out at the default rotation, so rotating never changes the zoom)
  const fit = useMemo(() => {
    const { right: r0, up: u0 } = basis(defYaw)
    let mx = 1, my = 1
    for (const f of lvl.floors) for (const p of f) for (const y of [-SLAB_T, WALL_H]) {
      const r: V3 = [p[0] - centre[0], y, p[1] - centre[2]]
      mx = Math.max(mx, Math.abs(dot(r, r0))); my = Math.max(my, Math.abs(dot(r, u0)))
    }
    return { mx: mx * 1.08, my: my * 1.12 }
  }, [lvl, centre, topDown]) // eslint-disable-line
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
  const proj = (p: V3): Vec2 => { const r: V3 = [p[0] - target[0], p[1] - target[1], p[2] - target[2]]; return [dot(r, right), -dot(r, up)] }
  const pt = (p: V3) => proj(p).join(',')
  const at = (id: string, y = 0): Vec2 => { const n = node.get(id)!; return proj([n.pos[0], y, n.pos[1]]) }

  const vh = baseVh * zoom
  const vw = vh * aspect
  const k = vh / size.h // metres per screen pixel
  const pxPerM = 1 / k

  // floor slab (top + visible edges)
  const slab = lvl.floors.map(f => {
    const sides: V3[][] = []
    if (!topDown) for (let i = 0; i < f.length; i++) {
      const p = f[i], q = f[(i + 1) % f.length]
      const cx = (p[0] + q[0]) / 2 - centre[0], cz = (p[1] + q[1]) / 2 - centre[2]
      if (dot([cx, 0, cz], fwd) >= 0) continue
      sides.push([[p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], -SLAB_T, q[1]], [p[0], -SLAB_T, p[1]]])
    }
    return { top: f.map(p => [p[0], 0, p[1]] as V3), sides }
  })

  // walls as boxes, far to near
  const walls = useMemo(() => {
    const out: { depth: number; polys: { pts: V3[]; shade: number }[] }[] = []
    for (const wl of lvl.walls) {
      const dx = wl.b[0] - wl.a[0], dz = wl.b[1] - wl.a[1], len = Math.hypot(dx, dz) || 1
      const t = wl.thickness / 2, nx = (-dz / len) * t, nz = (dx / len) * t, ex = (dx / len) * t, ez = (dz / len) * t
      const c: Vec2[] = [
        [wl.a[0] - ex + nx, wl.a[1] - ez + nz], [wl.b[0] + ex + nx, wl.b[1] + ez + nz],
        [wl.b[0] + ex - nx, wl.b[1] + ez - nz], [wl.a[0] - ex - nx, wl.a[1] - ez - nz],
      ]
      const polys: { pts: V3[]; shade: number }[] = []
      if (!topDown) for (let i = 0; i < 4; i++) {
        const p = c[i], q = c[(i + 1) % 4]
        const mx = (p[0] + q[0]) / 2 - (wl.a[0] + wl.b[0]) / 2, mz = (p[1] + q[1]) / 2 - (wl.a[1] + wl.b[1]) / 2
        if (dot([mx, 0, mz], fwd) >= 0) continue
        polys.push({ pts: [[p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], WALL_H, q[1]], [p[0], WALL_H, p[1]]], shade: dot([mx, 0, mz], right) < 0 ? 1 : 2 })
      }
      polys.push({ pts: c.map(p => [p[0], WALL_H, p[1]] as V3), shade: 0 })
      out.push({ depth: dot([(wl.a[0] + wl.b[0]) / 2, 0, (wl.a[1] + wl.b[1]) / 2], fwd), polys })
    }
    return out.sort((a, b) => b.depth - a.depth)
  }, [lvl, topDown, yaw]) // eslint-disable-line

  const zone = (id: string, half: number, cls: string) => {
    const n = node.get(id)!, [x, z] = n.pos
    return <polygon key={`z-${id}`} className={cls} points={[[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]].map(p => pt([p[0], 0.02, p[1]])).join(' ')} />
  }
  const pinNode = pin && node.get(pin.node)?.level === floor ? pin : null
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
      const px = sx / k, py = sy / k, w = text.length * size * 0.56 + 8, h = size + 6
      if (Math.abs(px) > size_w2 + w || Math.abs(py) > size_h2 + h) return // off screen
      if (!free(px, py, w, h)) return
      taken.push([px - w / 2, py - h / 2, px + w / 2, py + h / 2])
      labels.push({ x: sx, y: sy, text, cls, size })
    }
    const size_w2 = size.w / 2, size_h2 = size.h / 2
    // keep the space around the pin / you markers clear
    for (const id of [pinNode?.node, hereNode]) if (id) { const [x, y] = at(id, 0.15); taken.push([x / k - 16, y / k - 16, x / k + 16, y / k + 16]) }
    if (pinNode) { const [x, y] = at(pinNode.node, 0.15); const w = short(pinNode.label).length * 6.6 + 24; taken.push([x / k + 14, y / k - 16, x / k + 18 + w, y / k + 16]) }
    const nameOf = (id: string) => names ? names.get(id) : node.get(id)!.kind !== 'turn' ? node.get(id)!.label : undefined
    // entrances always get a label (people orient by them)
    for (const n of entrances) { const [sx, sy] = proj([n.pos[0], 0.1, n.pos[1]]); tryAdd(sx, sy + 16 * k, short(nameOf(n.id) ?? 'Entrance'), 'm-label ent', 11) }
    if (pxPerM >= ROOM_LABELS_FROM) {
      const named = floorNodes.filter(n => nameOf(n.id) && !entrances.includes(n))
      // nearest to the middle of the view first, so the labels you're looking at win
      const scored = named.map(n => { const [sx, sy] = proj([n.pos[0], 0.1, n.pos[1]]); return { n, sx, sy, d: sx * sx + sy * sy } }).sort((a, b) => a.d - b.d)
      for (const { n, sx, sy } of scored.slice(0, 400)) tryAdd(sx, sy + 12 * k, short(nameOf(n.id)!), n.kind === 'room' ? 'm-label' : 'm-label vert', 10.5)
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
  const pinch = useRef<{ d: number; m: Vec2 } | null>(null)
  const panMode = useRef(false)
  const tap = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent) => {
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    tap.current = ptrs.current.size === 1 ? { x: e.clientX, y: e.clientY, moved: false } : null
    panMode.current = topDown || e.button === 2 || e.shiftKey
    pinch.current = null
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onUp = (e: React.PointerEvent) => {
    ptrs.current.delete(e.pointerId); pinch.current = null
    const t = tap.current; tap.current = null
    if (!t || t.moved || e.type !== 'pointerup' || !pickRef.current) return
    // nearest named point within ~22 px of the tap
    const [px, py] = fromCentre(e.clientX, e.clientY)
    let best = '', bd = 22 * 22
    for (const n of floorNodes) {
      if (!(names ? names.has(n.id) : n.kind !== 'turn')) continue
      const [sx, sy] = at(n.id, 0.1), dx = sx / k - px, dy = sy / k - py, d = dx * dx + dy * dy
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
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      if (pinch.current && d > 10) {
        panBy(m[0] - pinch.current.m[0], m[1] - pinch.current.m[1])
        const [px, py] = fromCentre(m[0], m[1])
        zoomAt(pinch.current.d / d, px, py)
      }
      pinch.current = { d, m }
      return
    }
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1]
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 6) tap.current.moved = true
    if (tap.current && !tap.current.moved) return
    if (panMode.current) panBy(dx, dy)
    else setCam(c => ({ ...c, yaw: c.yaw + dx * 0.4 })) // drag right = turn the building right
  }

  return (
    <div className={`mapview${topDown ? ' flat' : ''}`} ref={ref}>
      <svg ref={svgRef} className={onPick ? 'pickable' : undefined} viewBox={`${-vw / 2} ${-vh / 2} ${vw} ${vh}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onContextMenu={e => e.preventDefault()} onDoubleClick={e => { const [px, py] = fromCentre(e.clientX, e.clientY); zoomAt(0.6, px, py) }} role="img" aria-label={`${lvl.name} map`}>
        {slab.map((s, i) => <g key={i}>
          {s.sides.map((sd, j) => <polygon key={j} className="m-slab-side" points={sd.map(pt).join(' ')} />)}
          <polygon className="m-slab" points={s.top.map(pt).join(' ')} />
        </g>)}
        {floorNodes.filter(n => n.kind === 'stairs').map(n => zone(n.id, 2.2, 'm-zone stairs'))}
        {floorNodes.filter(n => n.kind === 'lift').map(n => zone(n.id, 2.2, 'm-zone lift'))}
        {pinNode && node.get(pinNode.node)!.kind === 'room' && zone(pinNode.node, 2.6, 'm-zone dest')}
        {walls.map((w, i) => w.polys.map((p, j) => <polygon key={`${i}-${j}`} className={`m-wall s${p.shade}`} points={p.pts.map(pt).join(' ')} />))}
        {lines.map((ids, i) => {
          const ps = ids.filter(id => node.get(id)?.level === floor).map(id => at(id, 0.15).join(','))
          return ps.length > 1 && <g key={`r-${i}`}>
            <polyline className="m-route-casing" points={ps.join(' ')} strokeWidth={9 * k} />
            <polyline className="m-route" points={ps.join(' ')} strokeWidth={6 * k} />
          </g>
        })}
        {entrances.map(n => { const [x, y] = at(n.id, 0.15); return <rect key={`e-${n.id}`} x={x - 6 * k} y={y - 6 * k} width={12 * k} height={12 * k} rx={3 * k} className="m-entrance" strokeWidth={2 * k} transform={`rotate(45 ${x} ${y})`} /> })}
        {labels.map((l, i) => <text key={`l-${i}`} x={l.x} y={l.y} fontSize={l.size * k} className={l.cls}>{l.text}</text>)}
        {hereNode && (() => { const [x, y] = at(hereNode, 0.15); return <g><circle cx={x} cy={y} r={15 * k} className="m-here-halo" /><circle cx={x} cy={y} r={8 * k} className="m-here" strokeWidth={2.5 * k} /></g> })()}
        {pinNode && (() => {
          const [x, y] = at(pinNode.node, 0.15), label = short(pinNode.label), w = (label.length * 6.6 + 24) * k
          const left = x + 16 * k + w > vw / 2 - 64 * k // flip the callout so it stays clear of the edge and the zoom buttons
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
  (a.lines ?? []).map(l => l.join(',')).join('|') === (b.lines ?? []).map(l => l.join(',')).join('|')

export default memo(MapView, same)
