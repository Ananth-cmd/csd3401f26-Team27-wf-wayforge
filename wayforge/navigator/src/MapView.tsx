// Port of BuildingMap.cs + MapGestures.cs + the MapPanel prefab.
// Orthographic camera tilted 48° (3D) or 90° (2D top-down), yaw -35°, drawn as SVG.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Building, Route, Vec2 } from './types'

const WALL_H = 2.87 // 57.4 cm in the OBJ * 0.05 import scale
type V3 = [number, number, number]

type Props = {
  building: Building
  floor: number
  onFloor: (f: number) => void
  topDown: boolean
  onToggleView: () => void
  route?: Route | null
  progress?: number // route step the user is on (line is drawn from here on)
  place?: string | null // node id to mark (ShowPlace)
  x: number; y: number; w: number; h: number // position in the 390x844 frame
}

export default function MapView({ building, floor, onFloor, topDown, onToggleView, route, progress = 0, place, x, y, w, h }: Props) {
  const lvl = building.levels[floor]
  const node = useMemo(() => new Map(building.nodes.map(n => [n.id, n])), [building])

  // bounds of this floor's model (BuildingMap.SetFloor)
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const wl of lvl.walls) for (const p of [wl.a, wl.b]) {
      x0 = Math.min(x0, p[0] - wl.thickness); x1 = Math.max(x1, p[0] + wl.thickness)
      z0 = Math.min(z0, p[1] - wl.thickness); z1 = Math.max(z1, p[1] + wl.thickness)
    }
    const centre: V3 = [(x0 + x1) / 2, WALL_H / 2, (z0 + z1) / 2]
    const radius = Math.max(5, Math.hypot((x1 - x0) / 2, WALL_H / 2, (z1 - z0) / 2))
    return { centre, radius }
  }, [lvl])

  const [target, setTarget] = useState<V3>(bounds.centre)
  const [zoom, setZoom] = useState(1)
  const [yaw, setYaw] = useState(-35)
  const recenter = () => { setTarget(bounds.centre); setZoom(1); setYaw(-35) }
  useEffect(recenter, [bounds]) // SetFloor -> Recenter

  // camera basis (Unity Quaternion.Euler(pitch, yaw, 0))
  const pitch = ((topDown ? 90 : 48) * Math.PI) / 180, psi = (yaw * Math.PI) / 180
  const right: V3 = [Math.cos(psi), 0, -Math.sin(psi)]
  const fwdH: V3 = [Math.sin(psi), 0, Math.cos(psi)]
  const fwd: V3 = [Math.cos(pitch) * fwdH[0], -Math.sin(pitch), Math.cos(pitch) * fwdH[2]]
  const up: V3 = [Math.sin(pitch) * fwdH[0], Math.cos(pitch), Math.sin(pitch) * fwdH[2]]
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const rel = (p: V3): V3 => [p[0] - target[0], p[1] - target[1], p[2] - target[2]]
  const proj = (p: V3) => { const r = rel(p); return [dot(r, right), -dot(r, up)] as Vec2 }
  const pt = (p: V3) => proj(p).join(',')

  const aspect = Math.min(3, Math.max(0.3, w / h))
  const ortho = (bounds.radius * 1.05 * zoom) / Math.min(1, aspect)
  const vh = ortho * 2, vw = vh * aspect

  // walls as boxes, painter's algorithm (far first)
  const faces = useMemo(() => {
    const out: { depth: number; polys: { pts: V3[]; shade: number }[] }[] = []
    for (const wl of lvl.walls) {
      const dx = wl.b[0] - wl.a[0], dz = wl.b[1] - wl.a[1], len = Math.hypot(dx, dz) || 1
      const nx = (-dz / len) * wl.thickness / 2, nz = (dx / len) * wl.thickness / 2
      const ex = (dx / len) * wl.thickness / 2, ez = (dz / len) * wl.thickness / 2 // extend ends (box length includes thickness)
      const c: Vec2[] = [
        [wl.a[0] - ex + nx, wl.a[1] - ez + nz], [wl.b[0] + ex + nx, wl.b[1] + ez + nz],
        [wl.b[0] + ex - nx, wl.b[1] + ez - nz], [wl.a[0] - ex - nx, wl.a[1] - ez - nz],
      ]
      const polys: { pts: V3[]; shade: number }[] = []
      if (!topDown) for (let i = 0; i < 4; i++) {
        const p = c[i], q = c[(i + 1) % 4]
        const mx = (p[0] + q[0]) / 2 - (wl.a[0] + wl.b[0]) / 2, mz = (p[1] + q[1]) / 2 - (wl.a[1] + wl.b[1]) / 2
        const nrm: V3 = [mx, 0, mz]
        if (dot(nrm, fwd) >= 0) continue // facing away
        polys.push({ pts: [[p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], WALL_H, q[1]], [p[0], WALL_H, p[1]]], shade: Math.abs(mx) > Math.abs(mz) ? 1 : 2 })
      }
      polys.push({ pts: c.map(p => [p[0], WALL_H, p[1]] as V3), shade: 0 })
      const mid: V3 = [(wl.a[0] + wl.b[0]) / 2, WALL_H / 2, (wl.a[1] + wl.b[1]) / 2]
      out.push({ depth: dot(mid, fwd), polys })
    }
    return out.sort((a, b) => b.depth - a.depth)
  }, [lvl, topDown, yaw])

  // route legs on this floor from the current step (BuildingMap.DrawRoute)
  const legs: [Vec2, Vec2][] = []
  let here: Vec2 | null = null, dest: Vec2 | null = null
  if (route && route.nodes.length) {
    const ns = route.nodes.map(id => node.get(id)!)
    const cur = ns[Math.min(Math.max(progress, 0), ns.length - 1)]
    if (cur.level === floor) here = cur.pos
    const last = ns[ns.length - 1]
    if (last.level === floor) dest = last.pos
    for (let i = progress; i < ns.length - 1; i++) if (ns[i].level === floor && ns[i + 1].level === floor) legs.push([ns[i].pos, ns[i + 1].pos])
  } else if (place) {
    const n = node.get(place)
    if (n && n.level === floor) dest = n.pos
  }

  // gestures (MapGestures.cs): drag = orbit in 3D, pan in 2D; wheel / pinch = zoom
  const ptrs = useRef(new Map<number, Vec2>())
  const pinch = useRef(0)
  const clampZoom = (z: number) => Math.min(2.2, Math.max(0.4, z))
  const onDown = (e: React.PointerEvent) => { ptrs.current.set(e.pointerId, [e.clientX, e.clientY]); (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const onUp = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); pinch.current = 0 }
  const onMove = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId)
    if (!prev) return
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1])
      if (pinch.current > 10 && d > 10) setZoom(z => clampZoom(z * (pinch.current / d)))
      pinch.current = d
      return
    }
    const rect = (e.currentTarget as Element).getBoundingClientRect()
    const k = vh / rect.height, dx = e.clientX - prev[0], dy = e.clientY - prev[1]
    if (topDown) setTarget(t => [t[0] - right[0] * dx * k + fwdH[0] * dy * k, t[1], t[2] - right[2] * dx * k + fwdH[2] * dy * k])
    else setYaw(v => v - dx * 0.3)
  }

  const r = 0.6 // marker radius in metres (world size, like the Unity marker objects)
  return (
    <div className="map" style={{ left: x, top: y, width: w, height: h }}>
      <svg
        viewBox={`${-vw / 2} ${-vh / 2} ${vw} ${vh}`}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={e => setZoom(z => clampZoom(z * (e.deltaY < 0 ? 0.9 : 1.1)))}
      >
        {lvl.floors.map((f, i) => <polygon key={i} className="m-floor" points={f.map(p => pt([p[0], 0, p[1]])).join(' ')} />)}
        {faces.map((b, i) => b.polys.map((p, j) => <polygon key={`${i}-${j}`} className={`m-wall s${p.shade}`} points={p.pts.map(pt).join(' ')} />))}
        {legs.map(([a, b], i) => {
          const [ax, ay] = proj([a[0], 0.13, a[1]]), [bx, by] = proj([b[0], 0.13, b[1]])
          return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} className="m-route" strokeWidth={0.32} />
        })}
        {dest && <circle cx={proj([dest[0], 0.5, dest[1]])[0]} cy={proj([dest[0], 0.5, dest[1]])[1]} r={r} className="m-dest" />}
        {here && <circle cx={proj([here[0], 0.45, here[1]])[0]} cy={proj([here[0], 0.45, here[1]])[1]} r={r} className="m-here" />}
      </svg>
      {/* MapPanel prefab controls */}
      <button className="sec chip" style={{ left: 12, top: 12, width: 102, height: 40 }} onClick={() => onFloor((floor + 1) % building.levels.length)}>{lvl.name}</button>
      <button className="sec chip" style={{ left: w - 56, top: 12, width: 44, height: 40 }} onClick={recenter}>N ↑</button>
      <button className="sec chip" style={{ left: w - 180, top: h - 52, width: 52, height: 40 }} onClick={onToggleView}>{topDown ? '3D' : '2D'}</button>
      <button className="sec chip" style={{ left: w - 122, top: h - 52, width: 52, height: 40 }} onClick={() => setZoom(z => clampZoom(z * 1.15))}>−</button>
      <button className="sec chip" style={{ left: w - 64, top: h - 52, width: 52, height: 40 }} onClick={() => setZoom(z => clampZoom(z * 0.85))}>+</button>
    </div>
  )
}
