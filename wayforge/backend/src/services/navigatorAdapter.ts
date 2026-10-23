import type { EngineRoute } from '../types/engineRoute';
import { findConnection, parseWfbLinks, UnsupportedWfbError } from './wfbLinks';

// Each instruction is copied from the C++ engine; do not invent directions.
export type NavigatorDirection = {
    text: string;
    level: string;
    x: number;
    y: number;
    distance: number;
};

export type NavigatorRoute = {
    nodes: string[];
    passages: ('walk' | 'stairs' | 'lift')[];
    metres: number; // weighted navigation cost as per prototype
    minutes: number; // prototype's approximate ETA
    directions: NavigatorDirection[]; // human-readable C++ instructions
};

export type PublishedWfb = {
    levels: {
        id: string;
        edges: { a: string; b: string; kind?: string; stepFree?: boolean; blocked?: boolean }[];
    }[];
    links?: unknown[];
};

type Rec = Record<string, unknown>;
function isObject(value: unknown): value is Rec {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEngineRoute(value: unknown): value is EngineRoute {
    if (!isObject(value) || value.ok !== true) return false;
    if (typeof value.totalCost !== 'number' || !Number.isFinite(value.totalCost) || value.totalCost < 0) return false;
    if (typeof value.from !== 'string' || typeof value.to !== 'string' || typeof value.stepFree !== 'boolean') return false;
    if (!Array.isArray(value.steps) || !Array.isArray(value.directions) || value.steps.length < 1) return false;
    return value.steps.every((step: unknown) => isObject(step) &&
        typeof step.level === 'string' && typeof step.node === 'string' &&
        ['x', 'y', 'z'].every(k => typeof step[k] === 'number' && Number.isFinite(step[k]))) &&
        value.directions.every((direction: unknown) => isObject(direction) &&
            typeof direction.text === 'string' &&
            typeof direction.level === 'string' &&
            ['x', 'y', 'distance'].every(k =>
                typeof direction[k] === 'number' && Number.isFinite(direction[k])));
}

export function isPublishedWfb(value: unknown): value is PublishedWfb {
    if (!isObject(value) || !Array.isArray(value.levels)) return false;
    if (value.links !== undefined && !Array.isArray(value.links)) return false;
    return value.levels.every((level: unknown) => isObject(level) &&
        typeof level.id === 'string' && Array.isArray(level.edges) &&
        level.edges.every((edge: unknown) => isObject(edge) &&
            typeof edge.a === 'string' && typeof edge.b === 'string'));
}

export function toNavigatorRoute(route: EngineRoute, building: PublishedWfb): NavigatorRoute {
    const nodes = route.steps.map(s => `${s.level}:${s.node}`);
    const passages: NavigatorRoute['passages'] = [];
    const links = parseWfbLinks(building.links ?? []);
    for (let i = 0; i < route.steps.length - 1; i++) {
        const from = route.steps[i], to = route.steps[i + 1];
        if (from.level !== to.level) {
            const link = findConnection(links, `${from.level}:${from.node}`, `${to.level}:${to.node}`);
            if (!link || link.blocked) {
                throw new UnsupportedWfbError(`Missing or blocked inter-floor link between ${nodes[i]} and ${nodes[i + 1]}`);
            }
            if (route.stepFree && link.kind === 'stairs') {
                throw new UnsupportedWfbError('Engine marked a stairs route as step-free');
            }
            passages.push(link.kind);
            continue;
        }
        const level = building.levels.find(l => l.id === from.level);
        if (!level) throw new UnsupportedWfbError(`Unknown floor ${from.level}`);
        const edge = level.edges.find(e => (e.a === from.node && e.b === to.node) ||
            (e.b === from.node && e.a === to.node));
        if (!edge || edge.blocked === true) {
            throw new UnsupportedWfbError(`Missing or blocked same-floor edge between ${nodes[i]} and ${nodes[i + 1]}`);
        }
        let kind: NavigatorRoute['passages'][number];
        if (edge.kind === 'stairs' || edge.kind === 'stair') kind = 'stairs';
        else if (edge.kind === 'lift' || edge.kind === 'elevator') kind = 'lift';
        else if (edge.stepFree === false) {
            throw new UnsupportedWfbError(`Non-step-free edge ${nodes[i]} cannot safely be called a walk`);
        } else kind = 'walk';
        if (route.stepFree && kind === 'stairs') {
            throw new UnsupportedWfbError('Engine marked a stairs route as step-free');
        }
        passages.push(kind);
    }
    return {
        nodes,
        passages,
        metres: route.totalCost,
        minutes: Math.max(1, Math.ceil(route.totalCost / 65)),
        // Preserve the original instructions, floor and position data.
        directions: route.directions.map(direction => ({
            text: direction.text,
            level: direction.level,
            x: direction.x,
            y: direction.y,
            distance: direction.distance
        }))
    };
}
