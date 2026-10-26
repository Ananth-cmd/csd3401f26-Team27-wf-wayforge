// Illustrative 3D / 2D floor map (camera from the prototype's BuildingMap.cs: orthographic, tilt 48°, yaw -35°).
// Fills its parent. Drag = rotate (3D) or pan (2D), wheel / pinch = zoom.
// Shapes are projected around the floor centre, so panning and zooming only move the SVG viewBox;
// the walls, slabs and zones are rebuilt only when the floor or the rotation changes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Building, Vec2 } from './types'

const WALL_H = 1.9
const SLAB_T = 0.45
type V3 = [number, number, number]

export type MapProps = {
  building: Building
  floor: number
  topDown?: boolean
  lines?: string[][] // node-id paths to draw on this floor
  here?: string | null // "you are here" node
  pin?: { node: string; label: string } | null // destination / next landmark
}

const short = (s: string) => s.replace(/\s*\(Level \d+\)/, '')
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export default function MapView({ building, floor, topDown = false, lines = [], here, pin }: MapProps) {
  const lvl = building.levels[floor]
  const node = useMemo(() => new Map(building.nodes.map(n => [n.id, n])), [building])

  // container size
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 300, h: 200 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: Math.max(50, el.clientWidth), h: Math.max(50, el.clientHeight) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const centre = useMemo<V3>(() => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const f of lvl.floors) for (const p of f) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]) }
    return [(x0 + x1) / 2, 0, (z0 + z1) / 2]
  }, [lvl])

  const [target, setTarget] = useState<V3>(centre)
  const [zoom, setZoom] = useState(1)
  const [yaw, setYaw] = useState(topDown ? 0 : -35)
  useEffect(() => { setTarget(centre); setZoom(1); setYaw(topDown ? 0 : -35) }, [centre, topDown])

  // camera basis (Unity Quaternion.Euler(pitch, yaw, 0))
  const pitch = ((topDown ? 90 : 48) * Math.PI) / 180, psi = (yaw * Math.PI) / 180
  const right: V3 = [Math.cos(psi), 0, -Math.sin(psi)]
  const fwdH: V3 = [Math.sin(psi), 0, Math.cos(psi)]
  const fwd: V3 = [Math.cos(pitch) * fwdH[0], -Math.sin(pitch), Math.cos(pitch) * fwdH[2]]
  const up: V3 = [Math.sin(pitch) * fwdH[0], Math.cos(pitch), Math.sin(pitch) * fwdH[2]]
  const projAt = (p: V3, t: V3): Vec2 => { const r: V3 = [p[0] - t[0], p[1] - t[1], p[2] - t[2]]; return [dot(r, right), -dot(r, up)] }
  const proj = (p: V3) => projAt(p, centre)
  const view = projAt(target, centre) // where the camera target is, in projected units
  const pt = (p: V3) => proj(p).join(',')
  const at = (id: string, y = 0): Vec2 => { const n = node.get(id)!; return proj([n.pos[0], y, n.pos[1]]) }

  // fit the whole floor in view (from the centre), then apply zoom
  const fit = useMemo(() => {
    let mx = 1, my = 1
    for (const f of lvl.floors) for (const p of f) for (const y of [-SLAB_T, WALL_H]) {
      const [sx, sy] = projAt([p[0], y, p[1]], centre)
      mx = Math.max(mx, Math.abs(sx)); my = Math.max(my, Math.abs(sy))
    }
    return { mx: mx * 1.08, my: my * 1.12 }
  }, [lvl, centre, yaw, topDown]) // eslint-disable-line
  const aspect = size.w / size.h
  const vh = Math.max(fit.my * 2, (fit.mx * 2) / aspect) * zoom
  const vw = vh * aspect
  const k = vh / size.h // world units per screen pixel

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

  const nodes = useMemo(() => building.nodes.filter(n => n.level === floor), [building, floor])
  const zone = (id: string, half: number, cls: string) => {
    const n = node.get(id)!, [x, z] = n.pos
    return <polygon key={`z-${id}`} className={cls} points={[[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]].map(p => pt([p[0], 0.02, p[1]])).join(' ')} />
  }
  // floor slabs and stair / lift zones, rebuilt only when the floor or the rotation changes
  const under = useMemo(() => <>
    {slab.map((s, i) => <g key={i}>
      {s.sides.map((sd, j) => <polygon key={j} className="m-slab-side" points={sd.map(pt).join(' ')} />)}
      <polygon className="m-slab" points={s.top.map(pt).join(' ')} />
    </g>)}
    {nodes.filter(n => n.kind === 'stairs').map(n => zone(n.id, 2.2, 'm-zone stairs'))}
    {nodes.filter(n => n.kind === 'lift').map(n => zone(n.id, 2.2, 'm-zone lift'))}
  </>, [slab, nodes]) // eslint-disable-line
  const wallShapes = useMemo(() => walls.map((w, i) => w.polys.map((p, j) => <polygon key={`${i}-${j}`} className={`m-wall s${p.shade}`} points={p.pts.map(pt).join(' ')} />)),
    [walls]) // eslint-disable-line
  // labels also change with the zoom (their size is in screen pixels)
  const labels = useMemo(() => nodes.filter(n => n.kind !== 'turn').map(n => {
    const [x, y] = at(n.id, 0.1)
    return <text key={`l-${n.id}`} x={x} y={y + 16 * k} fontSize={10 * k} className="m-label">{short(n.label)}</text>
  }), [nodes, k, centre, yaw, topDown]) // eslint-disable-line

  const pinNode = pin && node.get(pin.node)?.level === floor ? pin : null
  const hereNode = here && node.get(here)?.level === floor ? here : null

  // gestures
  const ptrs = useRef(new Map<number, Vec2>())
  const pinch = useRef(0)
  const clampZoom = (z: number) => Math.min(2, Math.max(0.35, z))
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
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1]
    if (topDown) setTarget(t => [t[0] - right[0] * dx * k + fwdH[0] * dy * k, 0, t[2] - right[2] * dx * k + fwdH[2] * dy * k])
    else setYaw(v => v - dx * 0.3)
  }

  return (
    <div className={`mapview${topDown ? ' flat' : ''}`} ref={ref}>
      <svg viewBox={`${view[0] - vw / 2} ${view[1] - vh / 2} ${vw} ${vh}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onWheel={e => setZoom(z => clampZoom(z * (e.deltaY < 0 ? 0.9 : 1.1)))} role="img" aria-label={`${lvl.name} map`}>
        {under}
        {pinNode && node.get(pinNode.node)!.kind === 'room' && zone(pinNode.node, 2.6, 'm-zone dest')}
        {wallShapes}
        {labels}
        {lines.map((ids, i) => {
          const ps = ids.filter(id => node.get(id)?.level === floor).map(id => at(id, 0.15).join(','))
          return ps.length > 1 && <polyline key={`r-${i}`} className="m-route" points={ps.join(' ')} strokeWidth={4 * k} />
        })}
        {hereNode && (() => { const [x, y] = at(hereNode, 0.15); return <g><circle cx={x} cy={y} r={13 * k} className="m-here-halo" /><circle cx={x} cy={y} r={7 * k} className="m-here" /></g> })()}
        {pinNode && (() => {
          const [x, y] = at(pinNode.node, 0.15), label = short(pinNode.label), w = (label.length * 6.6 + 24) * k
          const left = x - view[0] + 16 * k + w > vw / 2 - 6 * k // flip the callout so it stays inside the map
          const rx = left ? x - 16 * k - w : x + 16 * k
          return <g>
            <rect x={rx} y={y - 15 * k} width={w} height={30 * k} rx={8 * k} className="m-callout" />
            <text x={rx + 12 * k} y={y + 4 * k} fontSize={12 * k} className="m-callout-t">{label}</text>
            <circle cx={x} cy={y} r={12 * k} className="m-pin" />
            <circle cx={x} cy={y - 1 * k} r={3.5 * k} className="m-pin-dot" />
          </g>
        })()}
      </svg>
    </div>
  )
}
