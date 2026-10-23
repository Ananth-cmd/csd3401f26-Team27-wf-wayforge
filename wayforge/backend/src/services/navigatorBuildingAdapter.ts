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
function mapNodeKind(kind: unknown): NavigatorNodeKind {
    if (kind === "room") return "room";
    if (kind === "stairs" || kind === "stair") return "stairs";
    if (kind === "lift" || kind === "elevator") return "lift";
    // Navigator's NodeKind lacks "door"; use a generic path/turn node.
    return "turn";
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
            const label = (typeof room?.name === "string" && room.name) ||
                (typeof room?.code === "string" && room.code) || id;
            result.nodes.push({ id: `${levelId}:${id}`, label, level: index, pos, kind });
        }

        const walls = requireArray(level.walls ?? [], `${levelId}.walls`).map((value, i) => {
            const wall = requireObject(value, `${levelId}.walls[${i}]`);
            return {
                a: vec2(wall.a, `${levelId}.walls[${i}].a`),
                b: vec2(wall.b, `${levelId}.walls[${i}].b`),
                thickness: number(wall.thickness, 0.15)
            };
        });

        // The demo .wfb has rooms, but no guaranteed full-floor slab outlines.
        // Never misrepresent each room polygon as a complete floor slab.
        const floors = Array.isArray(level.floors)
            ? level.floors.map((polygon, i) => requireArray(polygon, `${levelId}.floors[${i}]`)
                .map((p, j) => vec2(p, `${levelId}.floors[${i}][${j}]`)))
            : [];
        result.levels.push({
            index, name: typeof level.name === "string" ? level.name : levelId,
            elevation, height: number(level.ceilingHeight, 3), floors, walls
        });

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
            result.edges.push({
                from: `${levelId}:${a}`, to: `${levelId}:${b}`, kind,
                bidirectional: edge.bidirectional !== false,
                blocked: edge.blocked === true,
                extraCost: Math.max(0, edgeCost - directDistance)
            });
        }

        for (const room of rooms) {
            const id = requireString(room.id, `${levelId}.room.id`);
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
                startingPoint: room.startingPoint === true
            });
        }
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
