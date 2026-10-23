// Groups a route (list of waypoints) into the stages the visitor confirms:
// walk on a floor -> take stairs/lift -> walk on a floor ... (e.g. "1 of 3 · Level 1").
import type { Building, Route } from './types'

export type Leg =
  | { kind: 'walk'; level: number; nodes: string[]; metres: number; final: boolean }
  | { kind: 'stairs' | 'lift'; from: number; to: number; nodes: string[] }

export function toLegs(b: Building, r: Route): Leg[] {
  const node = new Map(b.nodes.map(n => [n.id, n]))
  const legs: Leg[] = []
  if (r.nodes.length < 2) return legs
  let walk: string[] = [r.nodes[0]]
  const flushWalk = () => {
    if (walk.length > 1) {
      let m = 0
      for (let i = 1; i < walk.length; i++) { const a = node.get(walk[i - 1])!, c = node.get(walk[i])!; m += Math.hypot(a.pos[0] - c.pos[0], a.pos[1] - c.pos[1]) }
      legs.push({ kind: 'walk', level: node.get(walk[0])!.level, nodes: walk, metres: m, final: false })
    }
  }
  for (let i = 0; i < r.passages.length; i++) {
    const p = r.passages[i], a = r.nodes[i], c = r.nodes[i + 1]
    if (p === 'walk') { walk.push(c); continue }
    flushWalk(); walk = [c]
    const last = legs[legs.length - 1]
    if (last && last.kind === p) { last.to = node.get(c)!.level; last.nodes.push(c) }
    else legs.push({ kind: p, from: node.get(a)!.level, to: node.get(c)!.level, nodes: [a, c] })
  }
  flushWalk()
  const lastWalk = legs[legs.length - 1]
  if (lastWalk?.kind === 'walk') lastWalk.final = true
  return legs
}

// Walking metres only (the planner's cost also includes the lift wait penalty)
export const walkMetres = (legs: Leg[]) => legs.reduce((s, l) => s + (l.kind === 'walk' ? l.metres : 0), 0)
export const transfer = (legs: Leg[]) => legs.find(l => l.kind !== 'walk') as Extract<Leg, { from: number }> | undefined
