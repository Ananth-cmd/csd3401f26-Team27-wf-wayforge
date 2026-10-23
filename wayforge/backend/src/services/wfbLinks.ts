/**
 * Strict parser for Wayforge inter-floor links.
 * Supports explicit qualified endpoints, not guessed links.
 * Until the real multi-floor .wfb is available, all supported shapes are provisional.
 */
export type WfbLinkKind = 'stairs' | 'lift';
export type Endpoint = { level: string; node: string; id: string };
export type ParsedWfbLink = {
    from: Endpoint;
    to: Endpoint;
    kind: WfbLinkKind;
    bidirectional: boolean;
    blocked: boolean;
    cost?: number;
};

export class UnsupportedWfbError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedWfbError';
    }
}

type Rec = Record<string, unknown>;
function rec(v: unknown): v is Rec {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}
function nonempty(v: unknown): v is string {
    return typeof v === 'string' && v.trim().length > 0;
}
function endpoint(v: unknown): Endpoint | null {
    let level: unknown;
    let node: unknown;
    if (typeof v === 'string') {
        const m = /^([^:]+):([^:]+)$/.exec(v);
        if (!m) return null;
        [, level, node] = m;
    } else if (rec(v)) {
        level = v.level ?? v.levelId ?? v.floor;
        node = v.node ?? v.nodeId ?? v.id;
    } else return null;
    if (!nonempty(level) || !nonempty(node)) return null;
    return { level, node, id: `${level}:${node}` };
}
function parseKind(v: unknown): WfbLinkKind | null {
    if (typeof v !== 'string') return null;
    const k = v.toLowerCase();
    if (['stair', 'stairs', 'staircase'].includes(k)) return 'stairs';
    if (['lift', 'elevator'].includes(k)) return 'lift';
    return null;
}

export function parseWfbLinks(raw: unknown): ParsedWfbLink[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new UnsupportedWfbError('The .wfb links field is not an array');

    return raw.map((value, i): ParsedWfbLink => {
        if (!rec(value)) throw new UnsupportedWfbError(`Unsupported .wfb link at index ${i}`);
        const a = value.a ?? value.from ?? value.src ?? value.start ?? (
            value.fromLevel !== undefined ? {level: value.fromLevel, node: value.fromNode} : undefined
        );
        const b = value.b ?? value.to ?? value.dst ?? value.end ?? (
            value.toLevel !== undefined ? {level: value.toLevel, node: value.toNode} : undefined
        );
        const from = endpoint(a), to = endpoint(b);
        if (!from || !to) {
            throw new UnsupportedWfbError(`Unsupported endpoint format in .wfb links[${i}]; inspect the real link JSON`);
        }
        if (from.level === to.level) {
            throw new UnsupportedWfbError(`Unexpected same-floor link in .wfb links[${i}]`);
        }
        const kind = parseKind(value.kind ?? value.type);
        if (!kind) throw new UnsupportedWfbError(`Unknown stairs/lift kind in .wfb links[${i}]`);
        // Conflicting accessibility flags are not silently reinterpreted.
        if (kind === 'stairs' && value.stepFree === true) {
            throw new UnsupportedWfbError(`Conflicting stepFree=true on stair link ${i}`);
        }
        const rawCost = value.cost ?? value.weight;
        if (rawCost !== undefined && (typeof rawCost !== 'number' || !Number.isFinite(rawCost) || rawCost < 0)) {
            throw new UnsupportedWfbError(`Invalid cost in .wfb links[${i}]`);
        }
        return {
            from, to, kind,
            bidirectional: value.bidirectional !== false && value.twoWay !== false,
            blocked: value.blocked === true || (kind === 'lift' && value.stepFree === false),
            cost: rawCost as number | undefined
        };
    });
}

export function findConnection(
    links: ParsedWfbLink[],
    start: string,
    destination: string
): ParsedWfbLink | undefined {
    return links.find(l => (l.from.id === start && l.to.id === destination) ||
        (l.bidirectional && l.from.id === destination && l.to.id === start));
}
