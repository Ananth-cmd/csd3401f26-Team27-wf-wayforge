// Convert a published Wayforge .wfb into the Building shape in navigator/src/types.ts.
// This first version supports the verified single-floor demo and safe same-floor edges.
// Do not invent stair/lift connections or floor slab outlines that aren't in the .wfb.

export type Vec2 = [number, number];
export type NavigatorEdgeKind = "walk" | "stairs" | "lift";
export type NavigatorNodeKind = "room" | "turn" | "stairs" | "lift";

export type NavigatorBuilding = {
    format: string;
    version: number;
    id: string;
    name: string;
    site: string;
    floorHeight: number;
    illustrative: boolean;
    units: "m";
    levels: {
        index: number;
        name: string;
        elevation: number;
        height: number;
        floors: Vec2[][];
        walls: { a: Vec2; b: Vec2; thickness: number }[];
    }[];
    nodes: { id: string; label: string; level: number; pos: Vec2; kind: NavigatorNodeKind }[];
    edges: { from: string; to: string; kind: NavigatorEdgeKind; bidirectional: boolean; blocked: boolean; extraCost: number }[];
    links: { from: string; to: string; kind: NavigatorEdgeKind; bidirectional: boolean; blocked: boolean; extraCost: number }[];
    pois: { id: string; name: string; code: string; node: string; category: string; description: string; startingPoint: boolean }[];
};

import { parseWfbLinks, UnsupportedWfbError } from "./wfbLinks";
export { UnsupportedWfbError } from "./wfbLinks";

type Rec = Record<string, unknown>;
const object = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
function requireObject(v: unknown, description: string): Rec {
    if (!object(v)) throw new Error(`Invalid .wfb: ${description} must be an object`);
    return v;
}
function requireArray(v: unknown, description: string): unknown[] {
    if (!Array.isArray(v)) throw new Error(`Invalid .wfb: ${description} must be an array`);
    return v;
}
function requireString(v: unknown, description: string): string {
    if (typeof v !== "string" || !v) throw new Error(`Invalid .wfb: ${description} must be a nonempty string`);
    return v;
}
function number(v: unknown, fallback: number): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function vec2(v: unknown, description: string): Vec2 {
    if (!Array.isArray(v) || v.length !== 2 || !v.every(x => typeof x === "number" && Number.isFinite(x))) {
        throw new Error(`Invalid .wfb: ${description} must be [x, y]`);
    }
    return [v[0], v[1]];
}
function isVec2(v: unknown): v is Vec2 {
    return Array.isArray(v) && v.length === 2 && v.every(x => typeof x === "number" && Number.isFinite(x));
}
// Ray casting: is point p inside the room outline?
function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
function mapNodeKind(kind: unknown): NavigatorNodeKind {
    if (kind === "room") return "room";
    if (kind === "stairs" || kind === "stair") return "stairs";
    if (kind === "lift" || kind === "elevator") return "lift";
    // Navigator's NodeKind lacks "door"; use a generic path/turn node.
    return "turn";
}

// returns a quick "does this line go through a wall" test for one level.
// walls are put into 5 m grid squares first so each line only checks the walls near it
function wallChecker(walls: { a: Vec2; b: Vec2 }[]): (p: Vec2, q: Vec2) => boolean {
    const CELL = 5;
    const grid = new Map<string, { a: Vec2; b: Vec2 }[]>();
    const cells = (p: Vec2, q: Vec2) => {
        const keys: string[] = [];
        for (let x = Math.floor(Math.min(p[0], q[0]) / CELL); x <= Math.floor(Math.max(p[0], q[0]) / CELL); x++)
            for (let y = Math.floor(Math.min(p[1], q[1]) / CELL); y <= Math.floor(Math.max(p[1], q[1]) / CELL); y++)
                keys.push(`${x},${y}`);
        return keys;
    };
    for (const w of walls) for (const k of cells(w.a, w.b)) {
        const list = grid.get(k) ?? [];
        list.push(w);
        grid.set(k, list);
    }
    // which side of line a-b point c is on (+ / - / 0)
    const side = (a: Vec2, b: Vec2, c: Vec2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    // true only for a proper crossing, just touching a wall end (like a door edge) doesn't count
    const crosses = (p: Vec2, q: Vec2, w: { a: Vec2; b: Vec2 }) =>
        side(w.a, w.b, p) * side(w.a, w.b, q) < -1e-9 && side(p, q, w.a) * side(p, q, w.b) < -1e-9;

    return (p, q) => {
        const seen = new Set<{ a: Vec2; b: Vec2 }>();
        for (const k of cells(p, q)) for (const w of grid.get(k) ?? []) {
            if (seen.has(w)) continue;
            seen.add(w);
            if (crosses(p, q, w)) return true;
        }
        return false;
    };
}

export function toNavigatorBuilding(input: unknown): NavigatorBuilding {
    const doc = requireObject(input, "document");
    const meta = requireObject(doc.building, "building");
    const rawLevels = requireArray(doc.levels, "levels");
    const rawLinks = parseWfbLinks(doc.links ?? []);
    const parsed = rawLevels.map((value, i) => {
        const level = requireObject(value, `levels[${i}]`);
        return { level, id: requireString(level.id, `levels[${i}].id`), elevation: number(level.elevation, 0) };
    });
    parsed.sort((a, b) => a.elevation - b.elevation);

    const gaps = parsed.slice(1).map((l, i) => l.elevation - parsed[i].elevation).filter(n => n > 0);
    const floorHeight = number(meta.floorHeight, gaps[0] ?? 3.5);

    const result: NavigatorBuilding = {
        format: "wayforge-navigator-v1",
        version: number(doc.version, 1),
        id: requireString(meta.id, "building.id"),
        name: requireString(meta.name, "building.name"),
        site: typeof meta.site === "string" ? meta.site : "",
        floorHeight,
        illustrative: meta.illustrative === true,
        units: "m",
        levels: [], nodes: [], edges: [], links: [], pois: []
    };

    for (const [index, { level, id: levelId, elevation }] of parsed.entries()) {
        const rooms = requireArray(level.rooms ?? [], `${levelId}.rooms`).map((r, i) => requireObject(r, `${levelId}.rooms[${i}]`));
        const rawNodes = requireArray(level.nodes ?? [], `${levelId}.nodes`);
        const roomMap = new Map(rooms.map((room, i) => [requireString(room.id, `${levelId}.rooms[${i}].id`), room]));
        const knownNodes = new Map<string, { id: string; pos: Vec2; kind: NavigatorNodeKind; raw: Rec }>();

        for (const [i, value] of rawNodes.entries()) {
            const node = requireObject(value, `${levelId}.nodes[${i}]`);
            const id = requireString(node.id, `${levelId}.nodes[${i}].id`);
            const pos = vec2(node.pos, `${levelId}.nodes[${i}].pos`);
            const kind = mapNodeKind(node.kind);
            if (knownNodes.has(id)) throw new Error(`Invalid .wfb: duplicate node ${levelId}:${id}`);
            knownNodes.set(id, { id, pos, kind, raw: node });
            const room = typeof node.room === "string" ? roomMap.get(node.room) : undefined;
            // unnamed rooms get no map label (the node id like "n100017" means nothing to visitors)
            const label = (typeof room?.name === "string" && room.name) ||
                (typeof room?.code === "string" && room.code) ||
                (kind === "stairs" ? "Stairs" : kind === "lift" ? "Lift" : "");
            result.nodes.push({ id: `${levelId}:${id}`, label, level: index, pos, kind });
        }

        // doors live in level.openings, not in the walls, so cut a gap in each wall where a door is
        // (Navigator draws every wall piece as solid, a gap is how it shows a door). windows stay as wall
        const doorsOnWall = new Map<string, { offset: number; width: number }[]>();
        for (const value of Array.isArray(level.openings) ? level.openings : []) {
            if (!object(value) || (value.type !== "door" && value.type !== "opening")) continue;
            if (typeof value.wall !== "string") continue;
            const list = doorsOnWall.get(value.wall) ?? [];
            list.push({ offset: number(value.offset, 0), width: number(value.width, 0) });
            doorsOnWall.set(value.wall, list);
        }

        const walls: { a: Vec2; b: Vec2; thickness: number }[] = [];
        for (const [i, value] of requireArray(level.walls ?? [], `${levelId}.walls`).entries()) {
            const wall = requireObject(value, `${levelId}.walls[${i}]`);
            const a = vec2(wall.a, `${levelId}.walls[${i}].a`);
            const b = vec2(wall.b, `${levelId}.walls[${i}].b`);
            const thickness = number(wall.thickness, 0.15);
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            const doors = (typeof wall.id === "string" ? doorsOnWall.get(wall.id) : undefined) ?? [];

            // point along the wall, d metres from a
            const at = (d: number): Vec2 => len ? [a[0] + (b[0] - a[0]) * d / len, a[1] + (b[1] - a[1]) * d / len] : a;

            // walk from a to b, adding a wall piece before each door and skipping over the door itself
            let from = 0;
            for (const door of [...doors].sort((x, y) => x.offset - y.offset)) {
                const start = Math.min(Math.max(door.offset, 0), len);
                const end = Math.min(Math.max(door.offset + door.width, 0), len);
                if (start - from > 0.05) walls.push({ a: at(from), b: at(start), thickness });
                from = Math.max(from, end);
            }
            if (len - from > 0.05 || (!doors.length)) walls.push({ a: from ? at(from) : a, b, thickness });
        }

        // The demo .wfb has rooms, but no guaranteed full-floor slab outlines.
        // Never misrepresent each room polygon as a complete floor slab.
        // Studio's .wfb has no slab outline, so use every room's own outline as a piece of floor
        // (corridors are rooms too, so together they cover the walkable floor). Navigator needs at
        // least one floor shape to centre and fit the map, it draws nothing without it.
        const floors = Array.isArray(level.floors) && level.floors.length
            ? level.floors.map((polygon, i) => requireArray(polygon, `${levelId}.floors[${i}]`)
                .map((p, j) => vec2(p, `${levelId}.floors[${i}][${j}]`)))
            : rooms.map(r => (Array.isArray(r.polygon) ? r.polygon.filter(isVec2) : [])).filter(p => p.length >= 3);
        result.levels.push({
            index, name: typeof level.name === "string" ? level.name : levelId,
            elevation, height: number(level.ceilingHeight, 3), floors, walls
        });

        // paths that cut straight through a solid wall (bad links in the path data, the route would
        // be drawn through the wall). they get checked below once all the paths are in
        const levelEdges: NavigatorBuilding["edges"] = [];
        const throughWall = new Set<NavigatorBuilding["edges"][number]>();
        const hitsWall = wallChecker(walls);

        for (const [i, value] of requireArray(level.edges ?? [], `${levelId}.edges`).entries()) {
            const edge = requireObject(value, `${levelId}.edges[${i}]`);
            const a = requireString(edge.a, `${levelId}.edges[${i}].a`);
            const b = requireString(edge.b, `${levelId}.edges[${i}].b`);
            const n1 = knownNodes.get(a), n2 = knownNodes.get(b);
            if (!n1 || !n2) throw new Error(`Invalid .wfb: unknown edge nodes ${levelId}:${a}/${b}`);
            const kind: NavigatorEdgeKind = edge.kind === "stair" || edge.kind === "stairs" ? "stairs"
                : edge.kind === "lift" ? "lift" : "walk";
            // A non-step-free edge without an explicit stair/lift type cannot be accurately
            // represented by Navigator's current client-side step-free routing model.
            if (edge.stepFree === false && kind === "walk") {
                throw new UnsupportedWfbError(`Cannot safely classify non-step-free connection ${levelId}:${a} -> ${levelId}:${b}`);
            }
            const dx = n1.pos[0] - n2.pos[0], dy = n1.pos[1] - n2.pos[1];
            const directDistance = Math.hypot(dx, dy);
            const edgeCost = number(edge.cost, directDistance);
            const out = {
                from: `${levelId}:${a}`, to: `${levelId}:${b}`, kind,
                bidirectional: edge.bidirectional !== false,
                blocked: edge.blocked === true,
                extraCost: Math.max(0, edgeCost - directDistance)
            };
            levelEdges.push(out);
            if (kind === "walk" && hitsWall(n1.pos, n2.pos)) throughWall.add(out);
        }

        // drop a through-wall path only if its two ends can still reach each other another way,
        // so nothing gets cut off (a room with no door at all keeps it until someone adds a door)
        const links = new Map<string, Set<NavigatorBuilding["edges"][number]>>();
        for (const e of levelEdges) for (const n of [e.from, e.to]) {
            if (!links.has(n)) links.set(n, new Set());
            links.get(n)!.add(e);
        }
        const stillJoined = (from: string, to: string) => {
            const seen = new Set([from]);
            const todo = [from];
            while (todo.length) {
                const n = todo.pop()!;
                if (n === to) return true;
                for (const e of links.get(n) ?? []) {
                    const next = e.from === n ? e.to : e.from;
                    if (!seen.has(next)) { seen.add(next); todo.push(next); }
                }
            }
            return false;
        };
        for (const e of throughWall) {
            links.get(e.from)!.delete(e);
            links.get(e.to)!.delete(e);
            if (stillJoined(e.from, e.to)) continue; // fine without it
            links.get(e.from)!.add(e); // only way through, put it back
            links.get(e.to)!.add(e);
        }
        for (const e of levelEdges) {
            if (links.get(e.from)!.has(e)) result.edges.push(e);
        }

        // Starting points come from the level's anchors (Studio saves one per room ticked as
        // "Starting point", id "a-<room id>"). An anchor that just sits inside a room counts too.
        const anchors = (Array.isArray(level.anchors) ? level.anchors : []).filter(object);
        for (const room of rooms) {
            const id = requireString(room.id, `${levelId}.room.id`);
            const polygon = Array.isArray(room.polygon) ? room.polygon.filter(isVec2) : [];
            const anchored = anchors.some(a => a.id === `a-${id}` || (isVec2(a.pos) && insidePolygon(a.pos, polygon)));
            const node = [...knownNodes.values()].find(n => n.raw.room === id);
            if (!node) continue; // No point of interest without a navigable node.
            result.pois.push({
                id: `${levelId}:${id}`,
                name: (typeof room.name === "string" && room.name) ||
                    (typeof room.code === "string" && room.code) || `Room ${id}`,
                code: typeof room.code === "string" ? room.code : "",
                node: `${levelId}:${node.id}`,
                category: typeof room.kind === "string" ? room.kind : "unknown",
                description: typeof room.description === "string" ? room.description : "",
                startingPoint: room.startingPoint === true || anchored
            });
        }
    }
    // No starting points marked in Studio yet: let people start from the exits and lobbies,
    // or from any room if there are none of those, so the Navigator is still usable.
    if (!result.pois.some(p => p.startingPoint)) {
        const entrances = result.pois.filter(p => p.category === "exit" || p.category === "lobby");
        for (const p of entrances.length ? entrances : result.pois) p.startingPoint = true;
    }

    // Every inter-floor link must point to a real node. Never silently invent endpoints.
    const positions = new Map(result.nodes.map(n => [n.id, n]));
    for (const link of rawLinks) {
        const start = positions.get(link.from.id);
        const end = positions.get(link.to.id);
        if (!start || !end) {
            throw new UnsupportedWfbError(`Inter-floor link references missing node ${link.from.id} or ${link.to.id}`);
        }
        const startLevel = result.levels[start.level];
        const endLevel = result.levels[end.level];
        const planar = Math.hypot(start.pos[0] - end.pos[0], start.pos[1] - end.pos[1]);
        const vertical = Math.abs(startLevel.elevation - endLevel.elevation);
        // Navigator's prototype adds a vertical-height penalty to inter-floor edges.
        // This only approximates wf_cli weighted costs; authoritative routes come from wf_cli.
        const approximateBaseCost = planar + vertical;
        result.links.push({
            from: link.from.id, to: link.to.id, kind: link.kind,
            bidirectional: link.bidirectional, blocked: link.blocked,
            extraCost: Math.max(0, (link.cost ?? approximateBaseCost) - approximateBaseCost)
        });
    }
    return result;
}
