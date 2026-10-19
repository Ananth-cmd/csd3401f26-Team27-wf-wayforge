/*!
 * \file BuildingsPage.jsx
 * \brief home page: list of the company's buildings
 *
 * \author Katie Lim
 */
import { useEffect, useState } from "react";
import { api } from "../api/api.js";

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "-");

export default function BuildingsPage({ go }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  const refresh = () => api.listBuildings().then(setList).catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  async function remove(b) {
    if (!window.confirm(`Delete "${b.name}"? This can't be undone.`)) return;
    await api.deleteBuilding(b.id);
    refresh();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Buildings</h1>
          <p className="muted">Upload floor plans, fix them up, then publish them to the Navigator.</p>
        </div>
        <button className="primary" onClick={() => go("/new")}>+ New building</button>
      </div>

      {error && <p className="error-text">Couldn't load buildings: {error}</p>}
      {!list && !error && <p className="muted">loading...</p>}
      {list && !list.length && <p className="muted">No buildings yet. Click "New building" to upload your first floor plans.</p>}

      {list && list.length > 0 && (
        <div className="cards">
          {list.map((b) => (
            <div key={b.id} className="card" onClick={() => go(`/b/${b.id}`)}>
              <div className="card-top">
                <h3>{b.name}</h3>
                <span className={`badge ${b.status === "published" ? "pub" : ""}`}>{b.status}</span>
              </div>
              <p className="muted small">{b.floors} floor{b.floors === 1 ? "" : "s"} · {b.rooms} rooms · {b.doors} doors</p>
              <div className="bar" title={`${b.tagged} of ${b.rooms} rooms tagged`}>
                <div style={{ width: `${b.rooms ? (b.tagged / b.rooms) * 100 : 0}%` }} />
              </div>
              <p className="muted small">{b.tagged}/{b.rooms} rooms tagged</p>
              <p className="muted small">Edited {when(b.updatedAt)}{b.publishedAt ? ` · published ${when(b.publishedAt)}` : ""}</p>
              <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => go(`/b/${b.id}`)}>Open</button>
                <button className="ghost danger" onClick={() => remove(b)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {api.mode === "mock" && (
        <p className="muted small foot">Running on the mock backend (data stays in this browser).{" "}
          <button className="link" onClick={async () => { await api.reset(); refresh(); }}>Reset mock data</button>
        </p>
      )}
    </div>
  );
}
