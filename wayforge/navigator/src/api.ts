// The ONLY place the site gets data from.
// Today: loads public/building.json and finds routes itself (A*, same costs as the prototype's RoutePlanner.Find).
// Later: swap the bodies for fetch() calls to #4's backend. Keep the signatures.
import type { Building, EdgeKind, Route } from './types'

export async function loadBuilding(id = 'sit-demo'): Promise<Building> {
  // later: const res = await fetch(`${API_URL}/buildings/${id}`)
  const res = await fetch(`${import.meta.env.BASE_URL}building.json`)
  if (!res.ok) throw new Error(`Could not load building ${id}`)
  return res.json()
}

export async function getRoute(b: Building, start: string, end: string, stepFree: boolean): Promise<Route | null> {
  // later: return (await fetch(`${API_URL}/route?building=${b.id}&from=${start}&to=${end}&stepFree=${stepFree}`)).json()
  return findRoute(b, start, end, stepFree)
}

// A* search. Same leg costs as the prototype's RoutePlanner.Find (android-prototype BuildingDefinition.cs):
// straight-line metres + extraCost, plus floorHeight per floor changed. So it finds the same shortest routes,
// it just looks at fewer places on the way (matters once the map covers a whole campus).
export function findRoute(b: Building, start: string, end: string, stepFree: boolean): Route | null {
  const node = new Map(b.nodes.map(n => [n.id, n]))
  const goal = node.get(end)
  if (!node.has(start) || !goal) return null
  const edges = [...b.edges, ...b.links]
  // legs leaving each point, worked out once (a two-way edge is a leg from both ends)
  const legs = new Map<string, { next: string; cost: number; kind: EdgeKind }[]>(b.nodes.map(n => [n.id, []]))
  const addLeg = (from: string, to: string, extraCost: number, kind: EdgeKind) => {
    const a = node.get(from), c = node.get(to)
    if (!a || !c) return
    const length = Math.hypot(a.pos[0] - c.pos[0], a.pos[1] - c.pos[1]) + extraCost + Math.abs(a.level - c.level) * b.floorHeight
    legs.get(from)!.push({ next: to, cost: Math.max(0.01, length), kind })
  }
  for (const e of edges) {
    if (e.blocked || (stepFree && e.kind === 'stairs')) continue
    addLeg(e.from, e.to, e.extraCost, e.kind)
    if (e.bidirectional) addLeg(e.to, e.from, e.extraCost, e.kind)
  }
  // guess of the metres left: flat distance + floors to climb. Never more than the real walk, so the route stays
  // the shortest one. A negative extraCost would break that, so fall back to plain Dijkstra (guess 0) if there is one.
  const guess = edges.some(e => e.extraCost < 0) ? () => 0 : (id: string) => {
    const n = node.get(id)!
    return Math.hypot(n.pos[0] - goal.pos[0], n.pos[1] - goal.pos[1]) + Math.abs(n.level - goal.level) * b.floorHeight
  }
  const costs = new Map<string, number>([[start, 0]]), previous = new Map<string, string>(), modes = new Map<string, EdgeKind>()
  const done = new Set<string>(), open = new MinHeap()
  open.push(guess(start), start)
  while (open.size > 0) {
    const current = open.pop()
    if (done.has(current)) continue // an older, longer entry for a point already settled
    done.add(current)
    if (current === end) break
    const best = costs.get(current)!
    for (const { next, cost, kind } of legs.get(current)!) {
      if (done.has(next)) continue
      const candidate = best + cost
      if (candidate >= (costs.get(next) ?? Infinity)) continue
      costs.set(next, candidate); previous.set(next, current); modes.set(next, kind)
      open.push(candidate + guess(next), next)
    }
  }
  const metres = costs.get(end)
  if (metres === undefined) return null
  const nodes = [end], passages: EdgeKind[] = []
  for (let cur = end; cur !== start; cur = previous.get(cur)!) { passages.unshift(modes.get(cur)!); nodes.unshift(previous.get(cur)!) }
  return { nodes, passages, metres, minutes: Math.max(1, Math.ceil(metres / 65)) }
}

// Binary heap of point ids, smallest score first.
class MinHeap {
  private items: { score: number; id: string }[] = []
  get size() { return this.items.length }
  push(score: number, id: string) {
    const h = this.items
    h.push({ score, id })
    for (let i = h.length - 1; i > 0;) {
      const parent = (i - 1) >> 1
      if (h[parent].score <= h[i].score) break
      ;[h[parent], h[i]] = [h[i], h[parent]]; i = parent
    }
  }
  pop(): string {
    const h = this.items, top = h[0], last = h.pop()!
    if (h.length > 0) {
      h[0] = last
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < h.length && h[l].score < h[m].score) m = l
        if (r < h.length && h[r].score < h[m].score) m = r
        if (m === i) break
        ;[h[m], h[i]] = [h[i], h[m]]; i = m
      }
    }
    return top.id
  }
}
