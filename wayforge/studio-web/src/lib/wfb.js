/*!
 * \file wfb.js
 * \brief small helpers for working with .wfb building files in the browser
 *
 * the .wfb format is in docs/fileformat.md. it's just JSON so we read it
 * with JSON.parse and edit the object directly. everything here is plain
 * functions, no React, so it's easy to test or reuse in the backend.
 *
 * \author Katie Lim
 */

// same list as RoomKind in wf_doc (docs/fileformat.md)
export const ROOM_KINDS = [
  "unknown", "classroom", "lab", "office", "toilet", "corridor",
  "stair", "lift", "lobby", "food", "storage", "exit",
];

// the engine gives every wall/door/room a confidence (0 to 1). under this it wasn't sure,
// so the plan shows it in orange and the guide asks you to check it
export const isUnsure = (x) => (x.confidence ?? 1) < 0.7;

// what the type dropdowns show. "unknown" reads like an error, so it's "not set" on screen
export const kindLabel = (k) => (k === "unknown" ? "not set" : k);

// colour per room kind for the 2D plan. kept light so the walls still stand out
export const KIND_COLOURS = {
  unknown: "#e6e6e6", classroom: "#cfe3ff", lab: "#d9cffc", office: "#ffe3c2",
  toilet: "#c8f0ec", corridor: "#f5f1e6", stair: "#ffd0d0", lift: "#ffc4e4",
  lobby: "#d6f5c9", food: "#fff2b3", storage: "#e0d6cc", exit: "#b8f0b8",
};

export function parseWfb(text) {
  const doc = JSON.parse(text);
  if (!doc || !doc.building || !Array.isArray(doc.levels)) {
    throw new Error("this doesn't look like a .wfb file (no building / levels)");
  }
  return doc;
}

export function toWfbText(doc) {
  return JSON.stringify(doc, null, 1);
}

// deep copy so edits don't change the old version (needed for undo)
export function clone(doc) {
  return structuredClone(doc);
}

// min/max of everything on a level, used to fit the plan in the view
export function levelBounds(level) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = ([x, y]) => {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  };
  for (const w of level.walls || []) { add(w.a); add(w.b); }
  for (const r of level.rooms || []) for (const p of r.polygon || []) add(p);
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  return { minX, minY, maxX, maxY };
}

// walls by id, built once per walls array. edits always produce a new array, so the index matches the walls
const wallIndexes = new WeakMap();
function wallIndex(walls) {
  let index = wallIndexes.get(walls);
  if (!index) { index = new Map(walls.map((w) => [w.id, w])); wallIndexes.set(walls, index); }
  return index;
}

// a door/window is stored as "which wall + how far along it", so work out
// the two end points of the gap. offset is from wall.a to the start of the gap
export function openingEnds(level, opening) {
  const wall = wallIndex(level.walls || []).get(opening.wall);
  if (!wall) return null;
  const dx = wall.b[0] - wall.a[0], dy = wall.b[1] - wall.a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const s = opening.offset, e = opening.offset + opening.width;
  return {
    wall,
    a: [wall.a[0] + ux * s, wall.a[1] + uy * s],
    b: [wall.a[0] + ux * e, wall.a[1] + uy * e],
  };
}

// middle of a room, where its label and starting point go. the engine gives a centroid,
// rooms drawn by hand in the Studio get the average of their corners
export function roomCentre(r) {
  if (r.centroid) return [...r.centroid];
  const p = r.polygon || [];
  return [p.reduce((t, q) => t + q[0], 0) / (p.length || 1), p.reduce((t, q) => t + q[1], 0) / (p.length || 1)];
}

// ---------- room naming and starting points (used by the room table, the side panel and the guide) ----------

// corridors don't need a name, people never search for "corridor 3"
export const needsName = (r) => r.kind !== "corridor";
// a room is done when it has a code or a name, and its type is set
export const isNamed = (r) => !!(r.code || r.name) && r.kind !== "unknown";

// a starting point is saved as an anchor (the QR / tap to start spot) in the middle of the room,
// id "a-<room id>". the Navigator offers these rooms as "where am I"
const anchorId = (roomId) => "a-" + roomId;
export const isStartPoint = (level, roomId) => (level.anchors || []).some((a) => a.id === anchorId(roomId));

// turn a room's starting point on or off. level is the editable copy inside edit()
export function setStartPoint(level, room, on) {
  level.anchors = (level.anchors || []).filter((a) => a.id !== anchorId(room.id));
  if (on) level.anchors.push({ id: anchorId(room.id), pos: roomCentre(room), name: room.name || room.code || room.id, heading: 0 });
}

export function wallLength(w) {
  return Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
}

// shoelace formula, same as the engine uses for room area
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// next free id like "w12" on a level, so new walls don't clash
export function nextId(level, prefix) {
  let max = 0;
  const all = [...(level.walls || []), ...(level.openings || []), ...(level.rooms || [])];
  for (const item of all) {
    const m = /^([a-z]+)(\d+)$/.exec(item.id || "");
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return prefix + (max + 1);
}

// quick numbers for the building list / header
export function summary(doc) {
  let rooms = 0, doors = 0, walls = 0, tagged = 0;
  for (const l of doc.levels) {
    rooms += (l.rooms || []).length;
    walls += (l.walls || []).length;
    doors += (l.openings || []).filter((o) => o.type === "door").length;
    tagged += (l.rooms || []).filter((r) => r.code && r.kind !== "unknown").length;
  }
  return { floors: doc.levels.length, rooms, doors, walls, tagged, links: (doc.links || []).length };
}

// checks before publishing. "error" blocks publish, "warn" is just a heads up.
// these are the things the Navigator needs to actually route people around
export function validate(doc) {
  const out = [];
  const codes = new Map();
  let exits = 0;
  for (const l of doc.levels) {
    for (const r of l.rooms || []) {
      if (r.kind === "exit") exits++;
      if (!r.code) {
        if (r.kind !== "corridor") out.push({ level: l.id, room: r.id, type: "warn", text: `${l.id} ${r.id}: no room code` });
        continue;
      }
      const key = r.code.toLowerCase();
      if (codes.has(key)) out.push({ level: l.id, room: r.id, type: "error", text: `Duplicate code ${r.code} (${codes.get(key)}, ${l.id}:${r.id})` });
      else codes.set(key, `${l.id}:${r.id}`);
      if (r.kind === "unknown") out.push({ level: l.id, room: r.id, type: "warn", text: `${r.code}: kind not set` });
    }
    if (!(l.nodes || []).length) out.push({ level: l.id, type: "error", text: `${l.id}: no navigation points` });
  }
  if (!exits) out.push({ type: "warn", text: "No exit marked" });
  if (!doc.levels.some((l) => (l.anchors || []).length)) {
    out.push({ type: "warn", text: "No starting point (Navigator will use exits and lobbies)" });
  }
  if (doc.levels.length > 1 && !(doc.links || []).length) {
    out.push({ type: "warn", text: "No stairs or lifts linking the levels" });
  }
  if (!doc.building.latitude && !doc.building.longitude) {
    out.push({ type: "warn", text: "No building location (lat/lon)" });
  }
  return out;
}
