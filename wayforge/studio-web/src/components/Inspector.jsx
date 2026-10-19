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
import { ROOM_KINDS, KIND_COLOURS, wallLength, polygonArea } from "../lib/wfb.js";

const num = (v, d = 2) => (v == null || Number.isNaN(v) ? "-" : Number(v).toFixed(d));

// sits in the bottom bar, so everything is laid out in one row
export function SelectionPanel({ level, selection, onChange, onDelete }) {
  if (!selection) {
    return <p className="hint">Click a room, wall or door on the plan.</p>;
  }
  if (selection.type === "room") {
    const r = (level.rooms || []).find((x) => x.id === selection.id);
    if (!r) return <p className="hint">That room isn't on this level.</p>;
    // change one field on the room
    const set = (field, value) => onChange((doc) => {
      const room = doc.levels.find((l) => l.id === level.id).rooms.find((x) => x.id === r.id);
      room[field] = value;
    }, field !== "name" && field !== "code"); // typing a name shouldn't make an undo step per letter
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
        <span className="facts">{num(r.area ?? polygonArea(r.polygon), 1)} m², {num((r.confidence ?? 1) * 100, 0)}% sure</span>
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

export function BuildingPanel({ doc, onChange }) {
  const b = doc.building;
  const setB = (field, value) => onChange((d) => { d.building[field] = value; });
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
      <table className="mini">
        <thead><tr><th>Id</th><th>Name</th><th>Height (m)</th></tr></thead>
        <tbody>
          {doc.levels.map((l, i) => (
            <tr key={l.id}>
              <td>{l.id}</td>
              <td><input value={l.name || ""} onChange={(e) => onChange((d) => { d.levels[i].name = e.target.value; })} /></td>
              <td><input type="number" step="0.5" value={l.elevation ?? 0} onChange={(e) => onChange((d) => { d.levels[i].elevation = Number(e.target.value); })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
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
      <p className="muted small">These join the levels so a route can go up or down.</p>
      {!(doc.links || []).length && <p className="muted">No links yet, so routes can't change floor.</p>}
      <ul className="links">
        {(doc.links || []).map((k, i) => (
          <li key={i}>
            <span>{label(k.a)} ↔ {label(k.b)} <em>{k.kind}{k.stepFree ? ", step free" : ""}</em></span>
            <button className="small danger" onClick={() => onChange((d) => { d.links.splice(i, 1); })}>×</button>
          </li>
        ))}
      </ul>
      {transfer.length < 2 ? (
        <p className="muted small">Mark rooms as kind <b>stair</b> or <b>lift</b> on two floors first, then link them here.</p>
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
      <p className="muted">{errors} error(s), {problems.length - errors} warning(s). Errors stop publishing, warnings don't.</p>
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

export function RoutePanel({ doc, onRoute, route, busy }) {
  const codes = [];
  for (const l of doc.levels) for (const r of l.rooms || []) if (r.code) codes.push(r.code);
  const [from, setFrom] = useState(codes[0] || "");
  const [to, setTo] = useState(codes[1] || "");
  const [stepFree, setStepFree] = useState(false);
  return (
    <div className="form">
      <p className="muted small">Try a trip before you publish. Use a room code, or type exit.</p>
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
