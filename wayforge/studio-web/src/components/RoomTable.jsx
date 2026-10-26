/*!
 * \file RoomTable.jsx
 * \brief every room of the building in one table, to name them quickly
 *
 * clicking rooms on the plan one by one takes ages on a big building, so this
 * lists them all with the code, name, type and starting point editable right
 * in the table. Enter jumps to the same box in the next row, so you can type
 * the codes straight down a column like in a spreadsheet.
 *
 * "Only rooms still to name" keeps the list it showed when you ticked it, so a
 * room doesn't vanish from under you the moment you finish typing its name.
 * tick it again to refresh the list.
 *
 * edits go through onChange like the other panels, so undo works here too
 *
 * \author Katie Lim
 */
import { useMemo, useState } from "react";
import { ROOM_KINDS, KIND_COLOURS, kindLabel, needsName, isNamed, isStartPoint, setStartPoint, polygonArea } from "../lib/wfb.js";

export default function RoomTable({ doc, onChange, onShow }) {
  const [levelId, setLevelId] = useState("all");
  const [search, setSearch] = useState("");
  const [showCorridors, setShowCorridors] = useState(false);
  const [todo, setTodo] = useState(null); // ids still to name when the filter was ticked, null = filter off

  // every room with its level, in floor order
  const all = useMemo(() => doc.levels.flatMap((l) => (l.rooms || []).map((r) => ({ level: l, room: r }))), [doc]);
  const toName = all.filter(({ room }) => needsName(room));
  const named = toName.filter(({ room }) => isNamed(room)).length;

  const word = search.trim().toLowerCase();
  const rows = all.filter(({ level, room }) =>
    (levelId === "all" || level.id === levelId) &&
    (showCorridors || needsName(room)) &&
    (!todo || todo.has(`${level.id}:${room.id}`)) &&
    (!word || `${room.id} ${room.code} ${room.name} ${room.kind}`.toLowerCase().includes(word)));

  function toggleTodo(on) {
    setTodo(on ? new Set(toName.filter(({ room }) => !isNamed(room)).map(({ level, room }) => `${level.id}:${room.id}`)) : null);
  }

  // change one field of one room. typing in a box merges into one undo step, like the side panel
  const set = (level, room, field, value) => onChange((d) => {
    d.levels.find((l) => l.id === level.id).rooms.find((r) => r.id === room.id)[field] = value;
  }, field === "kind");
  const setStart = (level, room, on) => onChange((d) => setStartPoint(d.levels.find((l) => l.id === level.id), room, on), true);

  // Enter = same box, next row (Shift+Enter goes up)
  function nextRow(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const { row, col } = e.currentTarget.dataset;
    const next = document.querySelector(`.room-table [data-row="${Number(row) + (e.shiftKey ? -1 : 1)}"][data-col="${col}"]`);
    if (next) { next.focus(); next.select?.(); }
  }

  return (
    <div className="room-table">
      <div className="rt-head">
        <div>
          <h2>Rooms</h2>
          <p className="muted small">{named} of {toName.length} rooms named</p>
          <div className="progress" aria-hidden="true"><i style={{ width: `${toName.length ? (named / toName.length) * 100 : 100}%` }} /></div>
        </div>
        <div className="rt-filters">
          <select value={levelId} onChange={(e) => setLevelId(e.target.value)} aria-label="Level">
            <option value="all">All levels</option>
            {doc.levels.map((l) => <option key={l.id} value={l.id}>{l.id} {l.name}</option>)}
          </select>
          <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search rooms" />
          <label className="check small"><input type="checkbox" checked={!!todo} onChange={(e) => toggleTodo(e.target.checked)} /> Only rooms still to name</label>
          <label className="check small"><input type="checkbox" checked={showCorridors} onChange={(e) => setShowCorridors(e.target.checked)} /> Show corridors</label>
        </div>
      </div>

      <div className="rt-scroll">
        <table>
          <thead>
            <tr><th>Level</th><th>Room</th><th>Code</th><th>Name</th><th>Type</th><th title="Where people can start a route in the Navigator">Start</th><th>Size</th><th /></tr>
          </thead>
          <tbody>
            {rows.map(({ level, room }, i) => (
              <tr key={`${level.id}:${room.id}`} className={isNamed(room) || !needsName(room) ? "" : "todo"}>
                <td>{level.id}</td>
                <td><i className="swatch" style={{ background: KIND_COLOURS[room.kind] }} />{room.id}</td>
                <td><input className="code-input" value={room.code || ""} data-row={i} data-col="code"
                  onChange={(e) => set(level, room, "code", e.target.value)} onKeyDown={nextRow} /></td>
                <td><input value={room.name || ""} data-row={i} data-col="name"
                  onChange={(e) => set(level, room, "name", e.target.value)} onKeyDown={nextRow} /></td>
                <td>
                  <select value={room.kind} data-row={i} data-col="kind" onChange={(e) => set(level, room, "kind", e.target.value)}>
                    {ROOM_KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" checked={isStartPoint(level, room.id)} onChange={(e) => setStart(level, room, e.target.checked)}
                  aria-label={`Starting point ${room.code || room.id}`} /></td>
                <td className="muted">{Math.round(room.area ?? polygonArea(room.polygon))} m²</td>
                <td><button className="small quiet" onClick={() => onShow(level.id, room.id)}>Show</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="muted rt-empty">{todo ? "All done, every room in this list has a name." : "No rooms match."}</p>}
      </div>
    </div>
  );
}
