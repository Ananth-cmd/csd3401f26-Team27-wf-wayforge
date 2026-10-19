import { useMemo, useRef, useState } from 'react'
import type { Building, Route, Vec2 } from './types'

type Props = {
  building: Building
  level: number
  onLevel: (l: number) => void
  route?: Route | null
  target?: number // index of the step the user is walking to (guide screen)
  focus?: string // node id to mark (arrival / selected place)
  height?: number
}

const PAD = 2
const toSvg = (p: Vec2): Vec2 => [p[0], -p[1]] // z = north = up

export default function MapView({ building, level, onLevel, route, target, focus, height = 260 }: Props) {
  // fit every level so switching floors doesn't jump
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const l of building.levels) for (const w of l.walls) for (const p of [w.a, w.b]) {
      const [x, y] = toSvg(p)
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
    return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 }
  }, [building])

  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Vec2>([0, 0])
  const drag = useRef<{ x: number; y: number; pan: Vec2 } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const w = bounds.w / zoom, h = bounds.h / zoom
  const vx = bounds.x + (bounds.w - w) / 2 + pan[0], vy = bounds.y + (bounds.h - h) / 2 + pan[1]

  const lvl = building.levels[level]
  const nodes = building.nodes.filter(n => n.level === level)
  const byId = new Map(building.nodes.map(n => [n.id, n]))
  const pts = (route?.steps ?? []).filter(s => s.level === level).map(s => toSvg(s.pos).join(',')).join(' ')
  const start = route?.steps[0], end = route?.steps[route.steps.length - 1]
  const tgt = route && target !== undefined ? route.steps[target] : undefined
  const focusNode = focus ? byId.get(focus) : undefined
  const r = 0.55 / Math.sqrt(zoom) // marker size stays readable when zoomed

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, pan }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !svgRef.current) return
    const k = w / svgRef.current.clientWidth
    setPan([drag.current.pan[0] - (e.clientX - drag.current.x) * k, drag.current.pan[1] - (e.clientY - drag.current.y) * k])
  }
  const zoomBy = (f: number) => setZoom(z => Math.min(5, Math.max(0.6, z * f)))

  return (
    <div className="map" style={{ height }}>
      <svg
        ref={svgRef}
        viewBox={`${vx} ${vy} ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onWheel={e => zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15)}
      >
        {lvl.floors.map((f, i) => <polygon key={i} points={f.map(p => toSvg(p).join(',')).join(' ')} className="slab" />)}
        {lvl.walls.map((wl, i) => {
          const [ax, ay] = toSvg(wl.a), [bx, by] = toSvg(wl.b)
          return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} strokeWidth={wl.thickness} className="wall" />
        })}
        {nodes.filter(n => n.kind === 'stairs' || n.kind === 'lift').map(n => {
          const [x, y] = toSvg(n.pos)
          return (
            <g key={n.id}>
              <rect x={x - r * 1.3} y={y - r * 1.3} width={r * 2.6} height={r * 2.6} rx={r * 0.5} className="vert" />
              <text x={x} y={y + r * 0.55} fontSize={r * 1.6} className="vert-t">{n.kind === 'lift' ? 'L' : 'S'}</text>
            </g>
          )
        })}
        {nodes.filter(n => n.kind === 'room').map(n => {
          const [x, y] = toSvg(n.pos)
          return (
            <g key={n.id}>
              <circle cx={x} cy={y} r={r * 0.45} className="room-dot" />
              <text x={x} y={y - r * 0.9} fontSize={r * 1.7} className="room-t">{n.id}</text>
            </g>
          )
        })}
        {pts && <polyline points={pts} className="route" strokeWidth={r * 0.7} />}
        {start && start.level === level && <circle cx={toSvg(start.pos)[0]} cy={toSvg(start.pos)[1]} r={r} className="m-start" strokeWidth={r * 0.35} />}
        {end && end.level === level && <circle cx={toSvg(end.pos)[0]} cy={toSvg(end.pos)[1]} r={r} className="m-end" strokeWidth={r * 0.35} />}
        {tgt && tgt.level === level && <circle cx={toSvg(tgt.pos)[0]} cy={toSvg(tgt.pos)[1]} r={r * 1.2} className="m-target" strokeWidth={r * 0.35} />}
        {focusNode && focusNode.level === level && <circle cx={toSvg(focusNode.pos)[0]} cy={toSvg(focusNode.pos)[1]} r={r} className="m-end" strokeWidth={r * 0.35} />}
      </svg>

      <button className="chip map-level" onClick={() => onLevel((level + 1) % building.levels.length)}>{lvl.name}</button>
      <button className="chip map-n" onClick={() => { setPan([0, 0]); setZoom(1) }} title="Recenter">N ↑</button>
      <div className="map-ctrl">
        <span className="chip">2D</span>
        <button className="chip" onClick={() => zoomBy(1 / 1.3)} aria-label="Zoom out">−</button>
        <button className="chip" onClick={() => zoomBy(1.3)} aria-label="Zoom in">+</button>
      </div>
    </div>
  )
}
