/*!
 * \file route.js
 * \brief simple route finder for the offline demo (mockApi.js), so "Test a
 *        route" still works when the Studio server isn't running
 *
 * it's plain Dijkstra over the nodes/edges in the .wfb plus the stair/lift
 * links between floors. with the server, routes come from wf_cli route
 * (wf_graph in the C++ core) instead. this gives back the same shape of
 * answer so the route panel doesn't care which one it got.
 *
 * \author Katie Lim
 */

// find a room by its code ("L1-01") or by "L1:r19"
function findRoom(doc, ref) {
  const want = String(ref).trim().toLowerCase();
  for (const l of doc.levels) {
    for (const r of l.rooms || []) {
      if ((r.code && r.code.toLowerCase() === want) || `${l.id}:${r.id}`.toLowerCase() === want) {
        return { level: l, room: r };
      }
    }
  }
  return null;
}

export function findRoute(doc, fromRef, toRef, stepFree = false) {
  const from = findRoom(doc, fromRef);
  if (!from) return { ok: false, error: `can't find room "${fromRef}"` };
  const toExit = String(toRef).trim().toLowerCase() === "exit";
  const to = toExit ? null : findRoom(doc, toRef);
  if (!toExit && !to) return { ok: false, error: `can't find room "${toRef}"` };

  // build one graph for the whole building, node keys are "L1:n100001"
  const pos = new Map(), adj = new Map(), roomOf = new Map();
  const link = (a, b, cost, kind) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push({ to: b, cost, kind });
    adj.get(b).push({ to: a, cost, kind });
  };
  for (const l of doc.levels) {
    for (const n of l.nodes || []) {
      const key = `${l.id}:${n.id}`;
      pos.set(key, { level: l.id, x: n.pos[0], y: n.pos[1], z: l.elevation || 0, kind: n.kind });
      if (n.room) roomOf.set(key, { level: l, roomId: n.room });
    }
    for (const e of l.edges || []) {
      if (stepFree && e.stepFree === false) continue;
      link(`${l.id}:${e.a}`, `${l.id}:${e.b}`, e.cost, "walk");
    }
  }
  for (const k of doc.links || []) {
    if (stepFree && k.stepFree === false) continue;
    link(k.a, k.b, k.cost ?? 10, k.kind);
  }

  const roomNodes = (lvl, roomId) => [...roomOf.entries()]
    .filter(([, v]) => v.level.id === lvl.id && v.roomId === roomId).map(([k]) => k);
  const starts = roomNodes(from.level, from.room.id);
  if (!starts.length) return { ok: false, error: `${fromRef} has no navigation point` };
  const isGoal = (key) => {
    const r = roomOf.get(key);
    if (!r) return false;
    if (toExit) return (r.level.rooms || []).some((x) => x.id === r.roomId && x.kind === "exit");
    return r.level.id === to.level.id && r.roomId === to.room.id;
  };

  // Dijkstra, the graph is small (hundreds of nodes) so a plain array is fine
  const dist = new Map(), prev = new Map(), done = new Set();
  for (const s of starts) dist.set(s, 0);
  let goal = null;
  while (true) {
    let cur = null, best = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < best) { best = d; cur = k; }
    if (cur === null) break;
    if (isGoal(cur)) { goal = cur; break; }
    done.add(cur);
    for (const e of adj.get(cur) || []) {
      const nd = best + e.cost;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, cur); }
    }
  }
  if (!goal) return { ok: false, error: stepFree ? "no step-free route found" : "no route found" };

  const keys = [];
  for (let k = goal; k; k = prev.get(k)) keys.unshift(k);
  const steps = keys.map((k) => ({ ...pos.get(k), node: k }));
  return {
    ok: true,
    from: fromRef,
    to: toRef,
    totalCost: dist.get(goal),
    stepFree,
    steps,
    directions: [{ text: `about ${Math.round(dist.get(goal))} m, ${steps.length} points (mock route)`, level: steps[0].level, x: steps[0].x, y: steps[0].y, distance: dist.get(goal) }],
  };
}
