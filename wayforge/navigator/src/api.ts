// The ONLY place the site gets data from.
// Today: loads public/building.json and runs a direct port of the prototype's RoutePlanner.Find.
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

// Port of RoutePlanner.Find (android-prototype BuildingDefinition.cs)
export function findRoute(b: Building, start: string, end: string, stepFree: boolean): Route | null {
  const node = new Map(b.nodes.map(n => [n.id, n]))
  if (!node.has(start) || !node.has(end)) return null
  const edges = [...b.edges, ...b.links]
  const costs = new Map<string, number>(), previous = new Map<string, string>(), modes = new Map<string, EdgeKind>()
  const open = new Set<string>()
  for (const n of b.nodes) { costs.set(n.id, Infinity); open.add(n.id) }
  costs.set(start, 0)
  while (open.size > 0) {
    let current: string | null = null, best = Infinity
    for (const id of open) if (costs.get(id)! < best) { best = costs.get(id)!; current = id }
    if (current === null) break
    open.delete(current)
    if (current === end) break
    for (const e of edges) {
      if (e.blocked || (stepFree && e.kind === 'stairs')) continue
      const next = e.from === current ? e.to : e.bidirectional && e.to === current ? e.from : null
      if (next === null || !open.has(next)) continue
      const a = node.get(current)!, c = node.get(next)!
      let length = Math.hypot(a.pos[0] - c.pos[0], a.pos[1] - c.pos[1]) + e.extraCost
      if (a.level !== c.level) length += Math.abs(a.level - c.level) * b.floorHeight
      const candidate = best + Math.max(0.01, length)
      if (candidate >= costs.get(next)!) continue
      costs.set(next, candidate); previous.set(next, current); modes.set(next, e.kind)
    }
  }
  const metres = costs.get(end)!
  if (!isFinite(metres)) return null
  const nodes = [end], passages: EdgeKind[] = []
  for (let cur = end; cur !== start; cur = previous.get(cur)!) { passages.unshift(modes.get(cur)!); nodes.unshift(previous.get(cur)!) }
  return { nodes, passages, metres, minutes: Math.max(1, Math.ceil(metres / 65)) }
}
