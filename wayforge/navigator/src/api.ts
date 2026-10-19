// The ONLY place the site gets data from.
// Today: loads public/building.json and computes routes locally (port of the prototype's RoutePlanner).
// Later: swap the bodies for fetch() calls to #4's backend. Keep the signatures.
import type { Building, Edge, Route, RouteStep } from './types'

const WALK_SPEED = 1.2 // m/s

export async function loadBuilding(id = 'sit-demo'): Promise<Building> {
  // later: const res = await fetch(`${API_URL}/buildings/${id}`)
  const res = await fetch(`${import.meta.env.BASE_URL}building.json`)
  if (!res.ok) throw new Error(`Could not load building ${id}`)
  return res.json()
}

export async function getRoute(b: Building, fromNode: string, toNode: string, stepFree: boolean): Promise<Route | null> {
  // later: return (await fetch(`${API_URL}/route?building=${b.id}&from=${fromNode}&to=${toNode}&stepFree=${stepFree}`)).json()
  return findRoute(b, fromNode, toNode, stepFree)
}

const dist = (a: [number, number], c: [number, number]) => Math.hypot(a[0] - c[0], a[1] - c[1])

export function findRoute(b: Building, from: string, to: string, stepFree: boolean): Route | null {
  const node = new Map(b.nodes.map(n => [n.id, n]))
  if (!node.has(from) || !node.has(to)) return null
  if (from === to) return { from, to, stepFree, metres: 0, minutes: 0, steps: [] }

  // adjacency: walking metres (shown to user) and cost (metres + extra penalty, used for choosing)
  type Arc = { to: string; metres: number; cost: number; kind: Edge['kind'] }
  const adj = new Map<string, Arc[]>()
  const add = (a: string, c: string, arc: Omit<Arc, 'to'>) => adj.set(a, [...(adj.get(a) ?? []), { to: c, ...arc }])
  for (const e of [...b.edges, ...b.links]) {
    if (e.blocked || (stepFree && e.kind === 'stairs')) continue
    const A = node.get(e.from)!, C = node.get(e.to)!
    const metres = A.level === C.level ? dist(A.pos, C.pos) : Math.abs(b.levels[C.level].elevation - b.levels[A.level].elevation)
    add(e.from, e.to, { metres, cost: metres + e.extraCost, kind: e.kind })
    if (e.bidirectional) add(e.to, e.from, { metres, cost: metres + e.extraCost, kind: e.kind })
  }

  // Dijkstra
  const cost = new Map<string, number>([[from, 0]])
  const prev = new Map<string, { id: string; arc: Arc }>()
  const open = new Set([from])
  while (open.size) {
    let u = ''
    for (const id of open) if (!u || cost.get(id)! < cost.get(u)!) u = id
    open.delete(u)
    if (u === to) break
    for (const arc of adj.get(u) ?? []) {
      const c = cost.get(u)! + arc.cost
      if (c < (cost.get(arc.to) ?? Infinity)) {
        cost.set(arc.to, c)
        prev.set(arc.to, { id: u, arc })
        open.add(arc.to)
      }
    }
  }
  if (!prev.has(to)) return null

  // walk back
  const chain: { id: string; arc?: Arc }[] = []
  for (let id = to; id !== from; id = prev.get(id)!.id) chain.unshift({ id, arc: prev.get(id)!.arc })
  chain.unshift({ id: from })

  // build steps; merge consecutive floor changes (L1 -> L2 -> L3 = one "take the lift" step)
  const steps: RouteStep[] = []
  const first = node.get(from)!
  steps.push({ node: from, level: first.level, pos: first.pos, text: `Start at ${first.label}`, metres: 0 })
  for (let i = 1; i < chain.length; i++) {
    const n = node.get(chain[i].id)!, arc = chain[i].arc!
    const last = steps[steps.length - 1]
    if (arc.kind !== 'walk') {
      if (last.via === arc.kind) steps.pop()
      steps.push({ node: n.id, level: n.level, pos: n.pos, via: arc.kind, metres: (last.via === arc.kind ? last.metres : 0) + arc.metres, text: `Take the ${arc.kind} to ${b.levels[n.level].name}` })
      continue
    }
    const isLast = i === chain.length - 1
    steps.push({ node: n.id, level: n.level, pos: n.pos, metres: arc.metres, text: isLast ? `Arrive at ${n.label}` : `Continue to ${n.label}` })
  }
  const metres = Math.round(steps.reduce((s, x) => s + x.metres, 0))
  return { from, to, stepFree, metres, minutes: Math.max(1, Math.ceil(metres / WALK_SPEED / 60)), steps }
}
