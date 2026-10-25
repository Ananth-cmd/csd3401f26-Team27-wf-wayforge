// Illustrative 3D / 2D floor map (camera from the prototype's BuildingMap.cs: orthographic, tilt 48°, yaw -35°).
// Fills its parent. Drag = rotate (3D) or pan (2D), wheel / pinch = zoom.
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

  // camera: look-at point on the floor, zoom (1 = whole floor fits, smaller = closer), rotation
  const defYaw = topDown ? 0 : -35
  const [cam, setCam] = useState<{ t: V3; zoom: number; yaw: number }>({ t: centre, zoom: 1, yaw: defYaw })
  const reset = () => setCam({ t: centre, zoom: 1, yaw: defYaw })
  useEffect(reset, [centre, topDown]) // eslint-disable-line
  const { t: target, zoom, yaw } = cam

  // camera basis (Unity Quaternion.Euler(pitch, yaw, 0))
  const pitch = ((topDown ? 90 : 48) * Math.PI) / 180, psi = (yaw * Math.PI) / 180
  const right: V3 = [Math.cos(psi), 0, -Math.sin(psi)]
  const fwdH: V3 = [Math.sin(psi), 0, Math.cos(psi)]
  const fwd: V3 = [Math.cos(pitch) * fwdH[0], -Math.sin(pitch), Math.cos(pitch) * fwdH[2]]
  const up: V3 = [Math.sin(pitch) * fwdH[0], Math.cos(pitch), Math.sin(pitch) * fwdH[2]]
  const projAt = (p: V3, t: V3): Vec2 => { const r: V3 = [p[0] - t[0], p[1] - t[1], p[2] - t[2]]; return [dot(r, right), -dot(r, up)] }
  const proj = (p: V3) => projAt(p, target)
  const pt = (p: V3) => proj(p).join(',')
  const at = (id: string, y = 0): Vec2 => { const n = node.get(id)!; return proj([n.pos[0], y, n.pos[1]]) }

  // fit the whole floor in view (from the centre), then apply zoom
  const fit = useMemo(() => {
    const ps = (defYaw * Math.PI) / 180
    const r0: V3 = [Math.cos(ps), 0, -Math.sin(ps)], f0: V3 = [Math.sin(ps), 0, Math.cos(ps)]
    const u0: V3 = [Math.sin(pitch) * f0[0], Math.cos(pitch), Math.sin(pitch) * f0[2]]
    let mx = 1, my = 1
    for (const f of lvl.floors) for (const p of f) for (const y of [-SLAB_T, WALL_H]) {
      const r: V3 = [p[0] - centre[0], y, p[1] - centre[2]]
      mx = Math.max(mx, Math.abs(dot(r, r0))); my = Math.max(my, Math.abs(dot(r, u0)))
    }
    return { mx: mx * 1.08, my: my * 1.12 }
  }, [lvl, centre, topDown]) // eslint-disable-line
  const aspect = size.w / size.h
  const vh = Math.max(fit.my * 2, (fit.mx * 2) / aspect) * zoom
  const vw = vh * aspect
  const k = vh / size.h // world units per screen pixel

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

  const nodes = building.nodes.filter(n => n.level === floor)
  const zone = (id: string, half: number, cls: string) => {
    const n = node.get(id)!, [x, z] = n.pos
    return <polygon key={`z-${id}`} className={cls} points={[[x - half, z - half], [x + half, z - half], [x + half, z + half], [x - half, z + half]].map(p => pt([p[0], 0.02, p[1]])).join(' ')} />
  }
  const pinNode = pin && node.get(pin.node)?.level === floor ? pin : null
  const hereNode = here && node.get(here)?.level === floor ? here : null

  // ---- gestures ----
  // 1 finger / mouse drag: rotate (3D) or move (2D). Right-drag or Shift-drag: move in 3D.
  // 2 fingers: pinch to zoom + drag to move. Wheel / trackpad: zoom towards the pointer.
  const svgRef = useRef<SVGSVGElement>(null)
  const sinp = Math.sin(pitch)
  const live = useRef({ k, sinp, right, fwdH })
  live.current = { k, sinp, right, fwdH }
  const clampZoom = (z: number) => Math.min(2.5, Math.max(0.25, z))
  // move the camera so the floor follows the pointer by (dx, dy) screen pixels
  const panBy = (dx: number, dy: number) => setCam(c => {
    const { k, sinp, right, fwdH } = live.current
    const a = -dx * k, b = (dy * k) / sinp
    return { ...c, t: [c.t[0] + right[0] * a + fwdH[0] * b, 0, c.t[2] + right[2] * a + fwdH[2] * b] }
  })
  // zoom by factor (<1 = closer) keeping the point under (px, py) — pixels from the map centre — in place
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
  // wheel needs a non-passive listener so the page doesn't scroll / zoom while zooming the map
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = fromCentre(e.clientX, e.clientY)
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY // lines -> pixels
      zoomAt(Math.exp(Math.max(-60, Math.min(60, dy)) * (e.ctrlKey ? 0.01 : 0.002)), px, py) // ctrlKey = trackpad pinch
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line

  const ptrs = useRef(new Map<number, Vec2>())
  const pinch = useRef<{ d: number; m: Vec2 } | null>(null)
  const panMode = useRef(false)
  const onDown = (e: React.PointerEvent) => {
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    panMode.current = topDown || e.button === 2 || e.shiftKey
    pinch.current = null
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onUp = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); pinch.current = null }
  const onMove = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId)
    if (!prev) return
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size >= 2) {
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
    if (panMode.current) panBy(dx, dy)
    else setCam(c => ({ ...c, yaw: c.yaw + dx * 0.4 })) // drag right = turn the building right
  }

  return (
    <div className={`mapview${topDown ? ' flat' : ''}`} ref={ref}>
      <svg ref={svgRef} viewBox={`${-vw / 2} ${-vh / 2} ${vw} ${vh}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onContextMenu={e => e.preventDefault()} onDoubleClick={e => { const [px, py] = fromCentre(e.clientX, e.clientY); zoomAt(0.6, px, py) }} role="img" aria-label={`${lvl.name} map`}>
        {slab.map((s, i) => <g key={i}>
          {s.sides.map((sd, j) => <polygon key={j} className="m-slab-side" points={sd.map(pt).join(' ')} />)}
          <polygon className="m-slab" points={s.top.map(pt).join(' ')} />
        </g>)}
        {nodes.filter(n => n.kind === 'stairs').map(n => zone(n.id, 2.2, 'm-zone stairs'))}
        {nodes.filter(n => n.kind === 'lift').map(n => zone(n.id, 2.2, 'm-zone lift'))}
        {pinNode && node.get(pinNode.node)!.kind === 'room' && zone(pinNode.node, 2.6, 'm-zone dest')}
        {walls.map((w, i) => w.polys.map((p, j) => <polygon key={`${i}-${j}`} className={`m-wall s${p.shade}`} points={p.pts.map(pt).join(' ')} />))}
        {nodes.filter(n => n.kind !== 'turn').map(n => {
          const [x, y] = at(n.id, 0.1)
          return <text key={`l-${n.id}`} x={x} y={y + 16 * k} fontSize={10 * k} className="m-label">{short(n.label)}</text>
        })}
        {lines.map((ids, i) => {
          const ps = ids.filter(id => node.get(id)?.level === floor).map(id => at(id, 0.15).join(','))
          return ps.length > 1 && <polyline key={`r-${i}`} className="m-route" points={ps.join(' ')} strokeWidth={4 * k} />
        })}
        {hereNode && (() => { const [x, y] = at(hereNode, 0.15); return <g><circle cx={x} cy={y} r={13 * k} className="m-here-halo" /><circle cx={x} cy={y} r={7 * k} className="m-here" /></g> })()}
        {pinNode && (() => {
          const [x, y] = at(pinNode.node, 0.15), label = short(pinNode.label), w = (label.length * 6.6 + 24) * k
          const left = x + 16 * k + w > vw / 2 - 6 * k // flip the callout so it stays inside the map
          const rx = left ? x - 16 * k - w : x + 16 * k
          return <g>
            <rect x={rx} y={y - 15 * k} width={w} height={30 * k} rx={8 * k} className="m-callout" />
            <text x={rx + 12 * k} y={y + 4 * k} fontSize={12 * k} className="m-callout-t">{label}</text>
            <circle cx={x} cy={y} r={12 * k} className="m-pin" />
            <circle cx={x} cy={y - 1 * k} r={3.5 * k} className="m-pin-dot" />
          </g>
        })()}
      </svg>
      <div className="map-ctrl">
        <button aria-label="Zoom in" onClick={() => zoomAt(1 / 1.35)}>+</button>
        <button aria-label="Zoom out" onClick={() => zoomAt(1.35)}>−</button>
        <button aria-label="Reset view" onClick={reset} title="Reset view">⟲</button>
      </div>
    </div>
  )
}
