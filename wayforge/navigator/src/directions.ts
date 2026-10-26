// Directions text for a route that's already been found (routes come from findRoute in api.ts; nothing here changes them).
// - turn-by-turn steps inside each walk ("Turn left at Seminar Room W1-01-08")
// - lifts and stairs named by block and letter ("W1 Lift A")
// - one summary line built from every leg ("3 lift rides · up to Level 7 · ends on Level 1")
import type { Building, Node, Route } from './types'
import type { Leg } from './legs'
import type { Place } from './places'

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
