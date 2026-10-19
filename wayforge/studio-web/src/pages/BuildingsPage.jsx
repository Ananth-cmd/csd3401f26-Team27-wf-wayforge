/*!
 * \file BuildingsPage.jsx
 * \brief home page: the company's buildings on the left, a preview of
 *        the one you picked on the right
 *
 * \author Katie Lim
 */
import { useEffect, useState } from "react";
import { api } from "../api/api.js";
import { parseWfb } from "../lib/wfb.js";
import MiniPlan from "../components/MiniPlan.jsx";

const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const statusText = (b) => (b.status === "published" ? `Published v${b.version}` : b.status === "changed" ? "Edited since publish" : "Draft");

export default function BuildingsPage({ go }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState(null);
  const [preview, setPreview] = useState(null); // parsed .wfb of the picked building

  const refresh = () => api.listBuildings()
    .then((l) => { setList(l); setPicked((p) => (l.some((b) => b.id === p) ? p : l[0]?.id || null)); })
    .catch((e) => setError(e.message));
  useEffect(() => { refresh(); }, []);

  // load the picked building for the preview
  useEffect(() => {
    if (!picked) { setPreview(null); return; }
    let stop = false;
    api.getBuilding(picked).then((b) => !stop && setPreview(parseWfb(b.wfb))).catch(() => !stop && setPreview(null));
    return () => { stop = true; };
  }, [picked]);

  async function remove(b) {
    if (!window.confirm(`Delete "${b.name}"?`)) return;
    await api.deleteBuilding(b.id);
    refresh();
  }

  const b = list?.find((x) => x.id === picked);

  return (
    <div className="split">
      <section className="split-list">
        <div className="list-head">
          <h1>Buildings</h1>
          <button className="primary" onClick={() => go("/new")}>New building</button>
        </div>

        {error && <p className="error-text">Couldn't load buildings: {error}</p>}
        {!list && !error && <p className="muted">Loading...</p>}
        {list && !list.length && (
          <div className="empty">
            <p>No buildings yet.</p>
            <button className="primary" onClick={() => go("/new")}>Upload floor plans</button>
          </div>
        )}

        {list && list.length > 0 && (
          <ul className="b-list">
            {list.map((x) => (
              <li key={x.id}>
                <button className={x.id === picked ? "on" : ""} onClick={() => setPicked(x.id)} onDoubleClick={() => go(`/b/${x.id}`)}>
                  <span className="b-name">{x.name}</span>
                  <span className={"status" + (x.status === "published" ? " is-live" : "")}>{statusText(x)}</span>
                  <span className="b-meta">{x.floors} level{x.floors === 1 ? "" : "s"}, {x.tagged} of {x.rooms} rooms named</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {api.mode === "mock" && (
          <p className="muted small foot">Demo data (this browser only).{" "}
            <button className="link" onClick={async () => { await api.reset(); refresh(); }}>Reset it</button>
          </p>
        )}
      </section>

      <section className="split-detail">
        {b ? (
          <>
            <div className="detail-head">
              <div>
                <h2>{b.name}</h2>
                <p className="muted">{statusText(b)}. Last edited {when(b.updatedAt)}{b.publishedAt ? `, published ${when(b.publishedAt)}` : ""}.</p>
              </div>
              <div className="row-buttons">
                <button className="primary" onClick={() => go(`/b/${b.id}`)}>Open editor</button>
                <button className="quiet danger" onClick={() => remove(b)}>Delete</button>
              </div>
            </div>
            <div className="detail-plan">
              {preview ? <MiniPlan key={picked} doc={preview} /> : <p className="muted">Loading plan...</p>}
            </div>
          </>
        ) : (
          list && list.length > 0 && <p className="muted">Select a building.</p>
        )}
      </section>
    </div>
  );
}
