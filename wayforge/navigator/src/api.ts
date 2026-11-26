// The ONLY place the site gets data from.
// Loads the published building from the backend (/api/published) and finds routes itself
// (A* in findRoute below: walking, lift waits and stairs weighed in metres of walking; step-free leaves out stairs).
import type { Building, EdgeKind, Node, Route } from './types'


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
// Costs are "metres of walking", so walking, lifts and stairs can be weighed against each other:
// - walking: the distance, plus the extra cost the published path carries (passing through a room, walking off the
//   walkways outside: the engine puts those into extraCost)
// - a lift: a wait of LIFT_WAIT when you get in, then LIFT_FLOOR per floor. Staying in for several floors waits once
// - stairs: STAIR_FLOOR per floor. So 1-3 floors go by stairs and longer climbs by lift
// stepFree leaves out every stairs connection, so the route only uses lifts, however much longer that is; when there is
// no such route the result is null and the app says so (it never falls back to stairs on its own).
const LIFT_WAIT = 40 // metres-equivalent of waiting for a lift (~40 s)
const LIFT_FLOOR = 4
const STAIR_FLOOR = 15
const WALK_PER_MIN = 65

type Out = { to: string; len: number; extra: number; kind: EdgeKind; floors: number }
// Connections leaving each point, worked out once per building (a two-way edge leaves from both ends).
const adjCache = new WeakMap<Building, Map<string, Out[]>>()
function adjacency(b: Building, node: Map<string, Node>): Map<string, Out[]> {
  const hit = adjCache.get(b)
  if (hit) return hit
  const out = new Map<string, Out[]>(b.nodes.map(n => [n.id, []]))
  const add = (from: string, to: string, kind: EdgeKind, extra: number) => {
    const a = node.get(from), z = node.get(to)
    if (!a || !z) return
    const floors = Math.abs(a.level - z.level)
    // a "walk" between two floors can only be stairs: treat it as stairs, so step-free never uses it
    const k: EdgeKind = floors && kind === 'walk' ? 'stairs' : kind
    out.get(from)!.push({ to, len: Math.hypot(a.pos[0] - z.pos[0], a.pos[1] - z.pos[1]), extra: k === 'walk' ? Math.max(0, extra) : 0, kind: k, floors })
  }
  for (const e of [...b.edges, ...b.links]) {
    if (e.blocked) continue
    add(e.from, e.to, e.kind, e.extraCost)
    if (e.bidirectional) add(e.to, e.from, e.kind, e.extraCost)
  }
  adjCache.set(b, out)
  return out
}

export function findRoute(b: Building, start: string, end: string, stepFree: boolean): Route | null {
  const node = new Map(b.nodes.map(n => [n.id, n]))
  const goal = node.get(end)
  if (!node.has(start) || !goal) return null
  const out = adjacency(b, node)
  // Search state: a point, and whether we're riding a lift there ("id|L"), so a ride over several floors waits once.
  const key = (id: string, inLift: boolean) => (inLift ? `${id}|L` : id)
  // Guess of the cost left: flat distance + the cheapest a floor change can be. Never more than the real cost, so the
  // first time the destination comes off the heap is the cheapest route.
  const guess = (id: string) => { const n = node.get(id)!; return Math.hypot(n.pos[0] - goal.pos[0], n.pos[1] - goal.pos[1]) + Math.abs(n.level - goal.level) * LIFT_FLOOR }
  const cost = new Map<string, number>([[key(start, false), 0]])
  const prev = new Map<string, { k: string; kind: EdgeKind }>()
  const done = new Set<string>(), open = new MinHeap()
  open.push(guess(start), key(start, false))
  let endKey = ''
  while (open.size > 0) {
    const k = open.pop()
    if (done.has(k)) continue // an older, dearer entry for a state already settled
    done.add(k)
    const [id, flag] = k.split('|'), inLift = flag === 'L'
    if (id === end) { endKey = k; break }
    const base = cost.get(k)!
    for (const e of out.get(id) ?? []) {
      if (stepFree && e.kind === 'stairs') continue
      const nk = key(e.to, e.kind === 'lift')
      if (done.has(nk)) continue
      const c = base + e.len + e.extra
        + (e.kind === 'lift' ? e.floors * LIFT_FLOOR + (inLift ? 0 : LIFT_WAIT) : e.kind === 'stairs' ? e.floors * STAIR_FLOOR : 0)
      if (c >= (cost.get(nk) ?? Infinity)) continue
      cost.set(nk, c); prev.set(nk, { k, kind: e.kind }); open.push(c + guess(e.to), nk)
    }
  }
  if (!endKey) return null
  const nodes: string[] = [], passages: EdgeKind[] = []
  for (let k = endKey; ;) { nodes.unshift(k.split('|')[0]); const p = prev.get(k); if (!p) break; passages.unshift(p.kind); k = p.k }
  // Walked metres and trip time from the route itself (the cost above includes waits and penalties, not distance).
  let walk = 0, lifts = 0, liftFloors = 0, stairFloors = 0
  for (let i = 0; i < passages.length; i++) {
    const a = node.get(nodes[i])!, z = node.get(nodes[i + 1])!, f = Math.abs(a.level - z.level)
    if (passages[i] === 'walk') walk += Math.hypot(a.pos[0] - z.pos[0], a.pos[1] - z.pos[1])
    else if (passages[i] === 'lift') { liftFloors += f; if (passages[i - 1] !== 'lift') lifts++ }
    else stairFloors += f
  }
  const minutes = Math.max(1, Math.ceil(walk / WALK_PER_MIN + lifts * 0.75 + liftFloors * 0.08 + stairFloors * 0.3))
  return { nodes, passages, metres: walk, minutes, cost: cost.get(endKey)! }
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
