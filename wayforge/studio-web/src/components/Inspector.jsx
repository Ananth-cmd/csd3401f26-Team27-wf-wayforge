/*!
 * \file Inspector.jsx
 * \brief the panels on the right side of the editor
 *
 * SelectionPanel - edit whatever you clicked (room, wall or door)
 * BuildingPanel  - building name, location, floor names and heights
 * LinksPanel     - stairs/lifts that join two floors
 * ChecksPanel    - problems to fix before publishing
 * RoutePanel     - try a route from one room to another
 *
 * none of these change the building directly, they call onChange with a
 * function that edits a copy, so the editor can keep undo history
 *
 * \author Katie Lim
 */
import { useState } from "react";
import { ROOM_KINDS, KIND_COLOURS, wallLength, polygonArea, roomCentre } from "../lib/wfb.js";

const num = (v, d = 2) => (v == null || Number.isNaN(v) ? "-" : Number(v).toFixed(d));

// sits in the bottom bar, so everything is laid out in one row
export function SelectionPanel({ level, selection, onChange, onDelete }) {
  if (!selection) {
    return <p className="hint">Nothing selected.</p>;
  }
  if (selection.type === "room") {
    const r = (level.rooms || []).find((x) => x.id === selection.id);
    if (!r) return <p className="hint">Nothing selected.</p>;
    // change one field on the room
    const set = (field, value) => onChange((doc) => {
      const room = doc.levels.find((l) => l.id === level.id).rooms.find((x) => x.id === r.id);
      room[field] = value;
    }, field !== "name" && field !== "code"); // typing a name shouldn't make an undo step per letter
    // a starting point is saved as an anchor (QR / tap to start spot) in the middle of the room.
    // the Navigator lets people pick these as "where am I"
    const anchorId = "a-" + r.id;
    const isStart = (level.anchors || []).some((a) => a.id === anchorId);
    const toggleStart = (on) => onChange((doc) => {
      const l = doc.levels.find((x) => x.id === level.id);
      l.anchors = (l.anchors || []).filter((a) => a.id !== anchorId);
      if (on) l.anchors.push({ id: anchorId, pos: roomCentre(r), name: r.name || r.code || r.id, heading: 0 });
    }, true);
    return (
      <div className="fields">
        <span className="what"><i className="swatch" style={{ background: KIND_COLOURS[r.kind] }} />Room {r.id}</span>
        <label>Code
          <input className="code-input" value={r.code || ""} placeholder={`${level.id}-01`} onChange={(e) => set("code", e.target.value)} />
        </label>
        <label className="wide">Name
          <input value={r.name || ""} placeholder="Lecture Theatre 1" onChange={(e) => set("name", e.target.value)} />
        </label>
        <label>Kind
          <select value={r.kind} onChange={(e) => set("kind", e.target.value)}>
            {ROOM_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={isStart} onChange={(e) => toggleStart(e.target.checked)} /> Starting point</label>
        <span className="facts">{num(r.area ?? polygonArea(r.polygon), 1)} m², {num((r.confidence ?? 1) * 100, 0)}% sure</span>
        <button className="danger" onClick={onDelete}>Delete room</button>
      </div>
    );
  }
  if (selection.type === "wall") {
    const w = (level.walls || []).find((x) => x.id === selection.id);
    if (!w) return null;
    const doors = (level.openings || []).filter((o) => o.wall === w.id).length;
    return (
      <div className="fields">
        <span className="what">Wall {w.id}</span>
        <label>Thickness (m)
          <input type="number" step="0.05" min="0.05" value={w.thickness}
            onChange={(e) => onChange((doc) => { findIn(doc, level.id, "walls", w.id).thickness = Number(e.target.value); }, true)} />
        </label>
        <span className="facts">{num(wallLength(w))} m long, {doors} door{doors === 1 ? "" : "s"}, {num((w.confidence ?? 1) * 100, 0)}% sure</span>
        <button className="danger" onClick={onDelete}>Delete wall{doors ? ` and its door${doors > 1 ? "s" : ""}` : ""}</button>
      </div>
    );
  }
  if (selection.type === "opening") {
    const o = (level.openings || []).find((x) => x.id === selection.id);
    if (!o) return null;
    const set = (field, value) => onChange((doc) => { findIn(doc, level.id, "openings", o.id)[field] = value; }, true);
    return (
      <div className="fields">
        <span className="what">{o.type === "window" ? "Window" : "Door"} {o.id}</span>
        <label>Type
          <select value={o.type} onChange={(e) => set("type", e.target.value)}>
            <option value="door">door</option>
            <option value="opening">opening, no door</option>
            <option value="window">window</option>
          </select>
        </label>
        <label>Width (m)
          <input type="number" step="0.05" min="0.3" value={num(o.width)} onChange={(e) => set("width", Number(e.target.value))} />
        </label>
        <label>From wall start (m)
          <input type="number" step="0.05" min="0" value={num(o.offset)} onChange={(e) => set("offset", Number(e.target.value))} />
        </label>
        <button className="danger" onClick={onDelete}>Delete {o.type}</button>
      </div>
    );
  }
  return null;
}

// find a wall/opening/room on a level inside the copy we're editing
function findIn(doc, levelId, list, id) {
  return doc.levels.find((l) => l.id === levelId)[list].find((x) => x.id === id);
}

export function BuildingPanel({ doc, onChange, current, onPick }) {
  const b = doc.building;
  const setB = (field, value) => onChange((d) => { d.building[field] = value; });
  // levels are kept bottom to top. "elevation" is how high the floor is above the ground floor
  const sorted = [...doc.levels].sort((x, y) => (x.elevation ?? 0) - (y.elevation ?? 0));
  const gap = sorted.length > 1 ? (sorted.at(-1).elevation - sorted[0].elevation) / (sorted.length - 1) : 3.5;

  const setLevel = (id, field, value) => onChange((d) => { d.levels.find((l) => l.id === id)[field] = value; });

  // move a floor up or down by swapping heights with the one next to it
  const moveLevel = (id, dir) => onChange((d) => {
    const order = [...d.levels].sort((x, y) => (x.elevation ?? 0) - (y.elevation ?? 0));
    const i = order.findIndex((l) => l.id === id), j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i].elevation, order[j].elevation] = [order[j].elevation, order[i].elevation];
    d.levels.sort((x, y) => (x.elevation ?? 0) - (y.elevation ?? 0));
  }, true);

  // new empty floor on top, draw its walls with the tools or start from a copy later
  const addLevel = () => onChange((d) => {
    const top = Math.max(...d.levels.map((l) => l.elevation ?? 0), -gap);
    let n = d.levels.length + 1;
    while (d.levels.some((l) => l.id === `L${n}`)) n++;
    d.levels.push({ id: `L${n}`, name: `Level ${n}`, elevation: top + (gap || 3.5), ceilingHeight: 3,
      walls: [], openings: [], rooms: [], nodes: [], edges: [], pois: [], anchors: [] });
  }, true);

  const removeLevel = (id) => {
    if (doc.levels.length <= 1) return;
    if (!window.confirm(`Remove ${id} and everything on it?`)) return;
    onChange((d) => {
      d.levels = d.levels.filter((l) => l.id !== id);
      // stairs/lifts that went to that floor go too
      d.links = (d.links || []).filter((k) => !k.a.startsWith(id + ":") && !k.b.startsWith(id + ":"));
    }, true);
    if (id === current) onPick(doc.levels.find((l) => l.id !== id).id);
  };

  // set every floor to the same floor-to-floor height
  const spaceAll = (h) => onChange((d) => {
    const order = [...d.levels].sort((x, y) => (x.elevation ?? 0) - (y.elevation ?? 0));
    order.forEach((l, i) => { l.elevation = Math.round(i * h * 100) / 100; });
  }, true);

  return (
    <div className="form">
      <h3>Building</h3>
      <label>Name <input value={b.name || ""} onChange={(e) => setB("name", e.target.value)} /></label>
      <div className="row2">
        <label>Latitude <input type="number" step="0.0001" value={b.latitude ?? ""} onChange={(e) => setB("latitude", Number(e.target.value))} /></label>
        <label>Longitude <input type="number" step="0.0001" value={b.longitude ?? ""} onChange={(e) => setB("longitude", Number(e.target.value))} /></label>
      </div>
      <label>Heading (° clockwise from north)
        <input type="number" step="1" value={b.heading ?? 0} onChange={(e) => setB("heading", Number(e.target.value))} />
      </label>

      <h3>Levels</h3>
      <table className="mini levels-table">
        <thead><tr><th>Id</th><th>Name</th><th>Height</th><th>Ceiling</th><th /></tr></thead>
        <tbody>
          {[...sorted].reverse().map((l, k) => (
            <tr key={l.id} className={l.id === current ? "on" : ""}>
              <td><button className="link" onClick={() => onPick(l.id)}>{l.id}</button></td>
              <td><input value={l.name || ""} onChange={(e) => setLevel(l.id, "name", e.target.value)} /></td>
              <td><input type="number" step="0.5" value={l.elevation ?? 0} onChange={(e) => setLevel(l.id, "elevation", Number(e.target.value))} /></td>
              <td><input type="number" step="0.1" value={l.ceilingHeight ?? 3} onChange={(e) => setLevel(l.id, "ceilingHeight", Number(e.target.value))} /></td>
              <td className="row-tools">
                <button className="quiet small" title="Move up" disabled={k === 0} onClick={() => moveLevel(l.id, 1)}>Up</button>
                <button className="quiet small" title="Move down" disabled={k === sorted.length - 1} onClick={() => moveLevel(l.id, -1)}>Down</button>
                <button className="quiet small danger" title="Remove this level" disabled={sorted.length <= 1} onClick={() => removeLevel(l.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-buttons">
        <button onClick={addLevel}>Add a level on top</button>
        <button className="quiet" onClick={() => { const h = Number(window.prompt("Floor to floor height in metres", String(Math.round(gap * 10) / 10 || 3.5))); if (h > 0) spaceAll(h); }}>Same height for all</button>
      </div>
    </div>
  );
}

// stairs and lifts that connect floors. wf_cli finds them by itself when the
// plan has stair/lift symbols, this is for fixing/adding them by hand
export function LinksPanel({ doc, onChange }) {
  const transfer = [];
  for (const l of doc.levels) {
    for (const r of l.rooms || []) {
      if (r.kind !== "stair" && r.kind !== "lift") continue;
      const node = (l.nodes || []).find((n) => n.room === r.id);
      if (node) transfer.push({ key: `${l.id}:${node.id}`, label: `${l.id} ${r.code || r.id} (${r.kind})`, kind: r.kind, level: l.id });
    }
  }
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const label = (key) => transfer.find((t) => t.key === key)?.label || key;

  function add() {
    const ta = transfer.find((t) => t.key === a), tb = transfer.find((t) => t.key === b);
    if (!ta || !tb || ta.level === tb.level) return;
    const kind = ta.kind === "lift" && tb.kind === "lift" ? "lift" : "stair";
    onChange((d) => {
      d.links = d.links || [];
      // stairs aren't step free, lifts are. cost is roughly "metres of walking" it's worth
      d.links.push({ a, b, kind, stepFree: kind === "lift", cost: kind === "lift" ? 15 : 10 });
    });
    setA(""); setB("");
  }

  return (
    <div className="form">
      <h3>Stairs and lifts</h3>
      {!(doc.links || []).length && <p className="muted">No links yet.</p>}
      <ul className="links">
        {(doc.links || []).map((k, i) => (
          <li key={i}>
            <span>{label(k.a)} ↔ {label(k.b)} <em>{k.kind}{k.stepFree ? ", step free" : ""}</em></span>
            <button className="small danger" onClick={() => onChange((d) => { d.links.splice(i, 1); })}>×</button>
          </li>
        ))}
      </ul>
      {transfer.length < 2 ? (
        <p className="muted small">Set rooms to <b>stair</b> or <b>lift</b> on two levels to link them.</p>
      ) : (
        <>
          <label>From
            <select value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">pick a stair/lift</option>
              {transfer.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label>To
            <select value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">pick one on another floor</option>
              {transfer.filter((t) => !a || t.level !== transfer.find((x) => x.key === a)?.level)
                .map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <button onClick={add} disabled={!a || !b}>Add link</button>
        </>
      )}
    </div>
  );
}

export function ChecksPanel({ problems, onPick }) {
  if (!problems.length) return <div><h3>Checks</h3><p className="ok">Nothing to fix. Ready to publish.</p></div>;
  const errors = problems.filter((p) => p.type === "error").length;
  return (
    <div>
      <h3>Checks</h3>
      <p className="muted">{errors} error(s), {problems.length - errors} warning(s)</p>
      <ul className="checks">
        {problems.map((p, i) => (
          <li key={i} className={p.type} onClick={() => p.level && onPick(p)} title={p.level ? "show it on the plan" : ""}>
            <b>{p.type === "error" ? "Error" : "Warning"}</b> {p.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoutePanel({ doc, onRoute, route, busy, dirty }) {
  const codes = [];
  for (const l of doc.levels) for (const r of l.rooms || []) if (r.code) codes.push(r.code);
  const [from, setFrom] = useState(codes[0] || "");
  const [to, setTo] = useState(codes[1] || "");
  const [stepFree, setStepFree] = useState(false);
  return (
    <div className="form">
      <h3>Test a route</h3>
      {dirty && <p className="note small">Save first to include your changes.</p>}
      <datalist id="room-codes">{codes.map((c) => <option key={c} value={c} />)}<option value="exit" /></datalist>
      <div className="row2">
        <label>From <input list="room-codes" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>To <input list="room-codes" value={to} onChange={(e) => setTo(e.target.value)} placeholder="code or exit" /></label>
      </div>
      <label className="check"><input type="checkbox" checked={stepFree} onChange={(e) => setStepFree(e.target.checked)} /> step free only (no stairs)</label>
      <div className="row-buttons">
        <button onClick={() => onRoute(from, to, stepFree)} disabled={busy || !from || !to}>{busy ? "Finding..." : "Show route"}</button>
        {route && <button className="ghost" onClick={() => onRoute(null)}>Clear</button>}
      </div>
      {route && !route.ok && <p className="error-text">{route.error}</p>}
      {route && route.ok && (
        <div>
          <p className="ok">About {Math.round(route.totalCost)} m through {new Set(route.steps.map((s) => s.level)).size} floor(s).</p>
          <ol className="directions">{route.directions.map((d, i) => <li key={i}>{d.text}</li>)}</ol>
        </div>
      )}
    </div>
  );
}
