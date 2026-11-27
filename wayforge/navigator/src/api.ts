// The ONLY place the site gets data from.
// Loads the published building from the backend (/api/published) and finds routes itself
// (A* in findRoute below: walking, lift waits and stairs weighed in metres of walking; step-free leaves out stairs).
import type { Building, Edge, EdgeKind, Node, Route } from './types'


// Address of the Wayforge backend.
// Can be changed later when the backend is deployed.
// The 2 wall map u see now on the website is dummy values for .wfb file, need wait for studo website to produce actual .wfb for the map 
// The built site (npm run build, what goes on the team server) calls /api on its own site, nginx
// passes it to the backend. npm run dev still uses VITE_API_URL from .env.local or Kervin's local port.
const API_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.PROD ? "" : "http://127.0.0.1:3000");

// Which building to open: ?b=<id> in the address (the Studio's "Open in Navigator" button adds it),
// otherwise the one published most recently in the Studio.
async function chooseBuilding(): Promise<string> {
  const fromUrl = new URLSearchParams(window.location.search).get("b");
  if (fromUrl) return fromUrl;
  const response = await fetch(`${API_URL}/api/published`);
  if (!response.ok) throw new Error(`Failed to list buildings (HTTP ${response.status})`);
  const list = await response.json() as { id: string; publishedAt?: string }[];
  if (!list.length) throw new Error("No buildings have been published yet");
  list.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  return list[0].id;
}


// Load a published building through the Wayforge backend.
export async function loadBuilding(
  wanted?: string
): Promise<Building> {
  const id = wanted ?? await chooseBuilding();

  const response = await fetch(
    `${API_URL}/api/navigator/${encodeURIComponent(id)}/building`
  );

  if (!response.ok) {
    throw new Error(
      `Failed to load building (HTTP ${response.status})`
    );
  }

  return await response.json() as Building;
}

// Calculate a route using the C++ Wayforge engine.
export async function getRoute(
  b: Building,
  start: string,
  end: string,
  stepFree: boolean
): Promise<Route | null> {

  // Prepare the navigation request.
  const params = new URLSearchParams({
    from: start,
    to: end,
    stepFree: stepFree ? "1" : "0"
  });

  // Ask our backend to calculate the route.
  const response = await fetch(
    `${API_URL}/api/navigator/${encodeURIComponent(b.id)}/route?${params}`
  );

  // Handle invalid destinations or navigation failures.
  if (!response.ok) {
    const result: unknown = await response.json().catch(() => null);

    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : `Failed to calculate route (HTTP ${response.status})`;

    throw new Error(message);
  }

  // Return the Navigator-compatible route.
  return await response.json() as Route;
}

//old one
/*export async function loadBuilding(id = 'sit-demo'): Promise<Building> {
  // later: const res = await fetch(`${API_URL}/buildings/${id}`)
  const res = await fetch(`${import.meta.env.BASE_URL}building.json`)
  if (!res.ok) throw new Error(`Could not load building ${id}`)
  return res.json()
}

export async function getRoute(b: Building, start: string, end: string, stepFree: boolean): Promise<Route | null> {
  // later: return (await fetch(`${API_URL}/route?building=${b.id}&from=${start}&to=${end}&stepFree=${stepFree}`)).json()
  return findRoute(b, start, end, stepFree)
}*/

// ---------- route finding (A*) ----------
// A* search over the published paths. Costs are in "metres of walking", so walking, lifts and stairs can be weighed
// against each other:
// - walking: the straight-line metres of each path, plus its extraCost from the map (the engine puts the cost of
//   passing through a room or of walking off the walkways outside there)
// - stairs: STAIR_FLOOR per floor climbed
// - a lift: LIFT_WAIT once per ride (waiting for it to come) + LIFT_FLOOR per floor
// So a trip of 1-3 floors takes the stairs and a longer climb takes the lift. Before, a stair and a lift cost the same
// per floor with no wait, so every trip took whichever was a few metres closer (nearly always a lift), and the
// "Shortest" and "Step-free" routes came out the same - there was never a stairs option to pick.
// stepFree leaves out every stairs connection, so the route only uses lifts, however much longer that is; when there is
// no such route the result is null and the app says so (it never falls back to stairs on its own).
const LIFT_WAIT = 40 // about 40 s waiting for a lift, as metres of walking
const LIFT_FLOOR = 4 // riding one floor
const STAIR_FLOOR = 15 // climbing one floor of stairs
const WALK_PER_MIN = 65 // walking speed, for the trip time
// the paths leaving each point, built once per building (and once more for step-free). Building them took longer
// than the search itself, and search results, nearby toilets and both route options each ask for routes
type Leg = { next: string; len: number; floors: number; kind: EdgeKind }
const graphs = new WeakMap<Building, { node: Map<string, Node>; all: Map<string, Leg[]>; sf: Map<string, Leg[]> }>()
function graphOf(b: Building) {
  let g = graphs.get(b)
  if (!g) {
    const node = new Map(b.nodes.map(n => [n.id, n]))
    const edges = [...b.edges, ...b.links]
    g = { node, all: buildLegs(node, edges, false), sf: buildLegs(node, edges, true) }
    graphs.set(b, g)
  }
  return g
}
// a two-way edge is a leg from both ends. A walk edge that changes floor (a ramp or a stair drawn as a path) counts as
// stairs, so step-free never uses it
function buildLegs(node: Map<string, Node>, edges: Edge[], stepFree: boolean) {
  const legs = new Map<string, Leg[]>([...node.keys()].map(id => [id, []]))
  const addLeg = (from: string, to: string, extraCost: number, kind: EdgeKind) => {
    const a = node.get(from), c = node.get(to)
    if (!a || !c) return
    const floors = Math.abs(a.level - c.level)
    const k: EdgeKind = floors && kind === 'walk' ? 'stairs' : kind
    if (stepFree && k === 'stairs') return
    // extraCost is never below 0 here, so the guess in findRoute stays below the real cost
    const len = Math.hypot(a.pos[0] - c.pos[0], a.pos[1] - c.pos[1]) + (k === 'walk' ? Math.max(0, extraCost) : 0)
    legs.get(from)!.push({ next: to, len: Math.max(0.01, len), floors, kind: k })
  }
  for (const e of edges) {
    if (e.blocked) continue
    addLeg(e.from, e.to, e.extraCost, e.kind)
    if (e.bidirectional) addLeg(e.to, e.from, e.extraCost, e.kind)
  }
  return legs
}
export function findRoute(b: Building, start: string, end: string, stepFree: boolean): Route | null {
  const { node, all, sf } = graphOf(b)
  const legs = stepFree ? sf : all
  const goal = node.get(end)
  if (!node.has(start) || !goal) return null
  // guess of what's left: flat distance + the cheapest way to change floors. Never more than the real cost, so the
  // first time the destination comes off the heap is the cheapest route
  const guess = (id: string) => {
    const n = node.get(id)!
    return Math.hypot(n.pos[0] - goal.pos[0], n.pos[1] - goal.pos[1]) + Math.abs(n.level - goal.level) * LIFT_FLOOR
  }
  // a point is visited "on foot" or "in a lift" ("id|L"): staying in the lift for more floors doesn't wait again
  const key = (id: string, inLift: boolean) => (inLift ? `${id}|L` : id)
  const costs = new Map<string, number>([[start, 0]]), previous = new Map<string, string>(), modes = new Map<string, EdgeKind>()
  const done = new Set<string>(), open = new MinHeap()
  open.push(guess(start), start)
  let endKey = ''
  while (open.size > 0) {
    const current = open.pop()
    if (done.has(current)) continue // an older, longer entry for a point already settled
    done.add(current)
    const [id, flag] = current.split('|'), inLift = flag === 'L'
    if (id === end) { endKey = current; break }
    const best = costs.get(current)!
    for (const { next, len, floors, kind } of legs.get(id)!) {
      const nk = key(next, kind === 'lift')
      if (done.has(nk)) continue
      const step = len + (kind === 'lift' ? floors * LIFT_FLOOR + (inLift ? 0 : LIFT_WAIT) : kind === 'stairs' ? floors * STAIR_FLOOR : 0)
      const candidate = best + step
      if (candidate >= (costs.get(nk) ?? Infinity)) continue
      costs.set(nk, candidate); previous.set(nk, current); modes.set(nk, kind)
      open.push(candidate + guess(next), nk)
    }
  }
  if (!endKey) return null
  const nodes: string[] = [], passages: EdgeKind[] = []
  for (let cur = endKey; ;) {
    nodes.unshift(cur.split('|')[0])
    const prev = previous.get(cur)
    if (prev === undefined) break
    passages.unshift(modes.get(cur)!); cur = prev
  }
  // Walked metres and trip time from the route itself (the cost above includes waits and penalties, not distance).
  let walk = 0, lifts = 0, liftFloors = 0, stairFloors = 0
  for (let i = 0; i < passages.length; i++) {
    const a = node.get(nodes[i])!, z = node.get(nodes[i + 1])!, f = Math.abs(a.level - z.level)
    if (passages[i] === 'walk') walk += Math.hypot(a.pos[0] - z.pos[0], a.pos[1] - z.pos[1])
    else if (passages[i] === 'lift') { liftFloors += f; if (passages[i - 1] !== 'lift') lifts++ }
    else stairFloors += f
  }
  const minutes = Math.max(1, Math.ceil(walk / WALK_PER_MIN + lifts * 0.75 + liftFloors * 0.08 + stairFloors * 0.3))
  return { nodes, passages, metres: walk, minutes, cost: costs.get(endKey)! }
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
