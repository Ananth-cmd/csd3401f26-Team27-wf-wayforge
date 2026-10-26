// Route finding and directions for the UI.
// - costs in "metres of walking": a lift ride pays a wait once (~40 s) plus a little per floor, stairs cost more per
//   floor, so 1-3 floors go by stairs and long climbs by lift (the published link costs made every trip take the lift)
// - turn-by-turn steps inside each walk ("Turn left at Seminar Room W1-01-08")
// - lifts and stairs named by block and letter ("W1 Lift A")
// - one summary line built from every leg ("3 lift rides · up to Level 7 · ends on Level 1")
import type { Building, EdgeKind, Node, Route } from './types'
import type { Leg } from './legs'
import type { Place } from './places'

const LIFT_WAIT = 40 // metres-equivalent of waiting for a lift (~40 s)
const LIFT_FLOOR = 4
const STAIR_FLOOR = 15 // 1-3 floors: stairs win; 4+: the lift
const WALK_PER_MIN = 65

export function planRoute(b: Building, nodeIndex: Map<string, Node>, start: string, end: string, stepFree: boolean): Route | null {
  const goal = nodeIndex.get(end)
  if (!nodeIndex.has(start) || !goal) return null
  const out = adjacency(b, nodeIndex, stepFree)
  // state = node + whether we're already in a lift (a ride over several floors waits once)
  const key = (id: string, inLift: boolean) => (inLift ? `${id}|L` : id)
  const h = (id: string) => { const n = nodeIndex.get(id)!; return Math.hypot(n.pos[0] - goal.pos[0], n.pos[1] - goal.pos[1]) + Math.abs(n.level - goal.level) * LIFT_FLOOR }
  const cost = new Map<string, number>([[key(start, false), 0]]), prev = new Map<string, { k: string; kind: EdgeKind }>()
  const done = new Set<string>(), open = new Heap()
  open.push(h(start), key(start, false))
  let endKey = ''
  while (open.size) {
    const k = open.pop()
    if (done.has(k)) continue
    done.add(k)
    const [id, flag] = k.split('|'), inLift = flag === 'L'
    if (id === end) { endKey = k; break }
    const base = cost.get(k)!
    for (const e of out.get(id) ?? []) {
      const nk = key(e.to, e.kind === 'lift')
      if (done.has(nk)) continue
      const c = base + e.len + (e.kind === 'lift' ? e.floors * LIFT_FLOOR + (inLift ? 0 : LIFT_WAIT) : e.kind === 'stairs' ? e.floors * STAIR_FLOOR : 0)
      if (c >= (cost.get(nk) ?? Infinity)) continue
      cost.set(nk, c); prev.set(nk, { k, kind: e.kind }); open.push(c + h(e.to), nk)
    }
  }
  if (!endKey) return null
  const nodes: string[] = [], passages: EdgeKind[] = []
  for (let k = endKey; ;) { nodes.unshift(k.split('|')[0]); const p = prev.get(k); if (!p) break; passages.unshift(p.kind); k = p.k }
  const r: Route = { nodes, passages, metres: cost.get(endKey)!, minutes: 1 }
  r.minutes = tripMinutes(b, nodeIndex, r)
  return r
}

type Out = { to: string; len: number; kind: EdgeKind; floors: number }
const adjCache = new WeakMap<Building, { sf: Map<string, Out[]>; all: Map<string, Out[]> }>()
function adjacency(b: Building, nodeIndex: Map<string, Node>, stepFree: boolean) {
  let c = adjCache.get(b)
  if (!c) {
    const make = (sf: boolean) => {
      const m = new Map<string, Out[]>()
      const add = (from: string, to: string, kind: EdgeKind, extra: number) => {
        const a = nodeIndex.get(from), z = nodeIndex.get(to)
        if (!a || !z) return
        const floors = Math.abs(a.level - z.level)
        const kindNow: EdgeKind = floors && kind === 'walk' ? 'stairs' : kind
        const len = Math.hypot(a.pos[0] - z.pos[0], a.pos[1] - z.pos[1]) + (kindNow === 'walk' ? Math.max(0, extra) : 0)
        const l = m.get(from) ?? []; l.push({ to, len: Math.max(0.01, len), kind: kindNow, floors }); m.set(from, l)
      }
      for (const e of [...b.edges, ...b.links]) {
        if (e.blocked || (sf && e.kind === 'stairs')) continue
        add(e.from, e.to, e.kind, e.extraCost)
        if (e.bidirectional) add(e.to, e.from, e.kind, e.extraCost)
      }
      return m
    }
    c = { sf: make(true), all: make(false) }
    adjCache.set(b, c)
  }
  return stepFree ? c.sf : c.all
}

export function tripMinutes(b: Building, nodeIndex: Map<string, Node>, r: Route) {
  let walk = 0, lifts = 0, liftFloors = 0, stairFloors = 0
  for (let i = 0; i < r.passages.length; i++) {
    const a = nodeIndex.get(r.nodes[i])!, z = nodeIndex.get(r.nodes[i + 1])!, k = r.passages[i], f = Math.abs(a.level - z.level)
    if (k === 'walk') walk += Math.hypot(a.pos[0] - z.pos[0], a.pos[1] - z.pos[1])
    else if (k === 'lift') { liftFloors += f; if (r.passages[i - 1] !== 'lift') lifts++ }
    else stairFloors += f
  }
  void b
  return Math.max(1, Math.ceil(walk / WALK_PER_MIN + lifts * 0.75 + liftFloors * 0.08 + stairFloors * 0.3))
}

export const sameRoute = (a?: Route | null, c?: Route | null) => !!a && !!c && a.nodes.length === c.nodes.length && a.nodes.every((n, i) => n === c.nodes[i])

// ---------- names for lifts / stairs: "W1 Lift A" ----------
export function verticalNames(b: Building, blockOfNode: (id: string) => string) {
  const groups = new Map<string, Node[]>()
  for (const n of b.nodes) if (n.kind === 'lift' || n.kind === 'stairs') {
    const k = `${n.level}|${blockOfNode(n.id)}|${n.kind}`
    const g = groups.get(k) ?? []; g.push(n); groups.set(k, g)
  }
  const names = new Map<string, string>()
  for (const [k, g] of groups) {
    const [, bl, kind] = k.split('|')
    g.sort((a, c) => a.pos[0] - c.pos[0] || a.pos[1] - c.pos[1])
    g.forEach((n, i) => names.set(n.id, `${bl ? bl + ' ' : ''}${kind === 'lift' ? 'Lift' : 'Stairs'}${g.length > 1 ? ` ${String.fromCharCode(65 + Math.min(i, 25))}` : ''}`))
  }
  return names
}

// ---------- turn-by-turn inside one walk ----------
export type Step = { turn: 'start' | 'left' | 'right' | 'straight' | 'arrive'; text: string; metres: number }
type Landmark = (nodeId: string, avoid?: string[]) => Place | null

export function walkSteps(nodeIndex: Map<string, Node>, ids: string[], endName: string, landmark: Landmark): Step[] {
  const pts = ids.map(id => ({ id, p: nodeIndex.get(id)!.pos }))
  if (pts.length < 2) return [{ turn: 'arrive', text: `${endName} is here`, metres: 0 }]
  // simplify the path so small wiggles don't count as turns (Douglas-Peucker, 1.5 m)
  const keep = new Array(pts.length).fill(false); keep[0] = keep[pts.length - 1] = true
  const dp = (i: number, j: number) => {
    let best = -1, bi = -1
    const [ax, az] = pts[i].p, [bx, bz] = pts[j].p, L = Math.hypot(bx - ax, bz - az) || 1
    for (let k = i + 1; k < j; k++) { const [x, z] = pts[k].p; const d = Math.abs((bx - ax) * (az - z) - (ax - x) * (bz - az)) / L; if (d > best) { best = d; bi = k } }
    if (best > 1.5) { keep[bi] = true; dp(i, bi); dp(bi, j) }
  }
  dp(0, pts.length - 1)
  const v = pts.filter((_, i) => keep[i])
  const steps: Step[] = []
  let run = 0
  const seg = (i: number) => Math.hypot(v[i + 1].p[0] - v[i].p[0], v[i + 1].p[1] - v[i].p[1])
  for (let i = 0; i < v.length - 1; i++) {
    run += seg(i)
    if (i === v.length - 2) break
    const d1 = [v[i + 1].p[0] - v[i].p[0], v[i + 1].p[1] - v[i].p[1]], d2 = [v[i + 2].p[0] - v[i + 1].p[0], v[i + 2].p[1] - v[i + 1].p[1]]
    const ang = (Math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1]) * 180) / Math.PI
    if (Math.abs(ang) < 30) continue
    const side = ang > 0 ? 'left' : 'right' // x east, z north: counter-clockwise = left
    const last = i === v.length - 3 && seg(i + 1) < 8 // the final short turn is into the place itself
    const lm = landmark(v[i + 1].id, [ids[0], ids[ids.length - 1]])
    steps.push({ turn: side, metres: Math.round(run), text: last ? `Turn ${side} into ${endName}` : `Turn ${side}${lm ? ` at ${lm.title}${lm.code ? ` (${lm.code})` : ''}` : ''}` })
    run = 0
  }
  const tail = Math.round(run)
  const lmEnd = steps.length && steps[steps.length - 1].text.startsWith('Turn ') && steps[steps.length - 1].text.includes(' into ')
  if (!lmEnd) steps.push({ turn: 'arrive', metres: tail, text: tail > 3 ? `Continue ${tail} m to ${endName}` : `${endName} is ahead` })
  return steps
}

// a landmark you pass near a point (prefers places people can recognise: unique names or a room code)
export function landmarkFinder(places: Place[], nodeIndex: Map<string, Node>) {
  const byLevel = new Map<number, { x: number; z: number; p: Place }[]>()
  const count = new Map<string, number>()
  for (const p of places) if (!p.hidden) count.set(`${p.level}|${p.title}`, (count.get(`${p.level}|${p.title}`) ?? 0) + 1)
  for (const p of places) {
    if (p.hidden || p.kind === 'stairs') continue
    const n = nodeIndex.get(p.node)!
    const a = byLevel.get(n.level) ?? []; a.push({ x: n.pos[0], z: n.pos[1], p }); byLevel.set(n.level, a)
  }
  return (nodeId: string, avoid: string[] = []): Place | null => {
    const n = nodeIndex.get(nodeId)
    if (!n) return null
    let best: Place | null = null, bd = 10 * 10
    for (const c of byLevel.get(n.level) ?? []) {
      if (avoid.includes(c.p.node)) continue
      const d = (c.x - n.pos[0]) ** 2 + (c.z - n.pos[1]) ** 2 + ((count.get(`${c.p.level}|${c.p.title}`) ?? 1) > 1 && !c.p.code ? 20 : 0)
      if (d < bd) { bd = d; best = c.p }
    }
    return best
  }
}

// ---------- one line for a whole route ----------
export function routeSummary(legs: Leg[], levelName: (i: number) => string, walk: number) {
  const t = legs.filter(l => l.kind !== 'walk') as Extract<Leg, { from: number }>[]
  const m = `${Math.round(walk)} m`
  if (!t.length) return `${m} · Same floor`
  const lifts = t.filter(l => l.kind === 'lift').length, stairs = t.length - lifts
  const levels = [legs[0].kind === 'walk' ? legs[0].level : t[0].from, ...t.map(l => l.to)]
  const top = Math.max(...levels), endL = t[t.length - 1].to
  if (t.length === 1) return `${m} · ${lifts ? 'Lift' : 'Stairs'} ${t[0].to > t[0].from ? 'up' : 'down'} to ${levelName(endL)}`
  const how = [lifts ? `${lifts} lift ride${lifts > 1 ? 's' : ''}` : '', stairs ? (stairs > 1 ? `stairs ×${stairs}` : 'stairs') : ''].filter(Boolean).join(' + ')
  return `${m} · ${how}${top > endL && top > levels[0] ? ` · up to ${levelName(top)}` : ''} · ends on ${levelName(endL)}`
}

class Heap {
  private h: { s: number; k: string }[] = []
  get size() { return this.h.length }
  push(s: number, k: string) {
    const h = this.h; h.push({ s, k })
    for (let i = h.length - 1; i > 0;) { const p = (i - 1) >> 1; if (h[p].s <= h[i].s) break; [h[p], h[i]] = [h[i], h[p]]; i = p }
  }
  pop(): string {
    const h = this.h, top = h[0], last = h.pop()!
    if (h.length) {
      h[0] = last
      for (let i = 0; ;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && h[l].s < h[m].s) m = l; if (r < h.length && h[r].s < h[m].s) m = r; if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m }
    }
    return top.k
  }
}
