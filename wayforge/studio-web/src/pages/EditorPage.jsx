/*!
 * \file EditorPage.jsx
 * \brief edit one building: 2D plan + 3D preview + panels, save and publish
 *
 * the whole building is one .wfb object in state. every edit makes a copy,
 * changes it and pushes the old one on the undo list, so Ctrl+Z works
 * for everything without each panel needing its own undo code
 *
 * \author Katie Lim
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/api.js";
import { parseWfb, toWfbText, clone, validate, summary, nextId, polygonArea } from "../lib/wfb.js";
import PlanView from "../components/PlanView.jsx";
import Viewer3D from "../components/Viewer3D.jsx";
import { SelectionPanel, BuildingPanel, LinksPanel, ChecksPanel, RoutePanel } from "../components/Inspector.jsx";

const MERGE_MS = 800; // edits closer together than this (like typing) share one undo step

// just the walls and doors, to tell if the shape of the building changed
const geometryKey = (doc) => JSON.stringify(doc.levels.map((l) => [l.walls, l.openings]));

// where people open a published building in the Navigator (Shri's site). ?b= picks the building
const NAVIGATOR_URL = import.meta.env.VITE_NAVIGATOR_URL || "https://navigation.duckdns.org/";
export const navigatorLink = (id) => `${NAVIGATOR_URL}?b=${encodeURIComponent(id)}`;

export default function EditorPage({ id, go }) {
  const [info, setInfo] = useState(null);
  const [doc, setDoc] = useState(null);
  const [savedText, setSavedText] = useState("");
  const [error, setError] = useState("");
  const [levelId, setLevelId] = useState(null);
  const [selection, setSelection] = useState(null);
  const [tool, setTool] = useState("select");
  const [centre, setCentre] = useState("2d");
  // what wf_cli said when the building was made (UploadPage leaves it here). shows once
  const [buildLog] = useState(() => {
    try {
      const t = sessionStorage.getItem("wf.buildlog." + id);
      sessionStorage.removeItem("wf.buildlog." + id);
      return t ? JSON.parse(t) : null;
    } catch { return null; }
  });
  const [sheet, setSheet] = useState(buildLog ? "summary" : null); // building | links | checks | route | summary popout
  const [showPaths, setShowPaths] = useState(false);
  const [route, setRoute] = useState(null);
  const [blueprint, setBlueprint] = useState(true);   // show the uploaded picture under the plan
  const [opacity, setOpacity] = useState(0.35);
  const [picDims, setPicDims] = useState({});         // {L1: {w, h}} sizes of the uploaded pictures
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const undo = useRef([]), redo = useRef([]), lastEdit = useRef(0);
  const loadedGeometry = useRef("");

  // load the building
  useEffect(() => {
    let stop = false;
    api.getBuilding(id)
      .then((b) => {
        if (stop) return;
        const d = parseWfb(b.wfb);
        setInfo(b); put(d); setSavedText(toWfbText(d));
        setLevelId(d.levels[0]?.id);
        loadedGeometry.current = geometryKey(d);
      })
      .catch((e) => !stop && setError(e.message));
    return () => { stop = true; };
  }, [id]);

  const picUrl = (lv) => `/api/buildings/${encodeURIComponent(id)}/source/${lv}`;
  // find out how big each uploaded picture is, so it can be lined up under the plan
  useEffect(() => {
    if (!info || api.mode !== "server") return;
    for (const src of info.sources || []) {
      const img = new Image();
      img.onload = () => setPicDims((cur) => ({ ...cur, [src.level]: { w: img.naturalWidth, h: img.naturalHeight } }));
      img.src = picUrl(src.level);
    }
  }, [info?.id, info?.sources?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (text) => { setToast(text); setTimeout(() => setToast(""), 2500); };

  // keep the latest doc in a ref too, so quick edits in a row build on each other
  const docRef = useRef(null);
  const put = (d) => { docRef.current = d; setDoc(d); };

  // every change goes through here. fn edits a copy of the building.
  // newStep = true forces its own undo step even if it was quick
  const edit = useCallback((fn, newStep = false) => {
    const cur = docRef.current;
    if (!cur) return;
    const next = clone(cur);
    fn(next);
    const now = Date.now();
    if (newStep || now - lastEdit.current > MERGE_MS || !undo.current.length) {
      undo.current.push(cur);
      if (undo.current.length > 100) undo.current.shift();
    }
    lastEdit.current = now;
    redo.current = [];
    put(next);
    setRoute(null); // an old route might not be right any more
  }, []);

  const doUndo = useCallback(() => {
    if (!undo.current.length) return;
    redo.current.push(docRef.current);
    put(undo.current.pop());
    lastEdit.current = 0;
  }, []);
  const doRedo = useCallback(() => {
    if (!redo.current.length) return;
    undo.current.push(docRef.current);
    put(redo.current.pop());
    lastEdit.current = 0;
  }, []);

  const text = useMemo(() => (doc ? toWfbText(doc) : ""), [doc]);
  const dirty = doc && text !== savedText;
  const problems = useMemo(() => (doc ? validate(doc) : []), [doc]);
  const geometryChanged = doc && geometryKey(doc) !== loadedGeometry.current;
  const level = doc?.levels.find((l) => l.id === levelId) || doc?.levels[0];

  async function save() {
    setBusy("save");
    try {
      const res = await api.saveBuilding(id, text);
      setSavedText(text);
      setInfo((i) => ({ ...i, ...res }));
      flash("Saved");
      return true;
    } catch (e) { flash("Save failed: " + e.message); return false; } finally { setBusy(""); }
  }

  async function publish() {
    if (problems.some((p) => p.type === "error")) { setSheet("checks"); flash("Fix the errors first"); return; }
    if (!window.confirm(`Publish "${doc.building.name}" to the Navigator?`)) return;
    if (dirty && !(await save())) return;
    setBusy("publish");
    try {
      const res = await api.publishBuilding(id);
      setInfo((i) => ({ ...i, ...res }));
      flash(`Published version ${res.version}. The Navigator has it now.`);
    } catch (e) { flash("Publish failed: " + e.message); } finally { setBusy(""); }
  }

  function download() {
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (doc.building.id || id) + ".wfb";
    a.click();
    URL.revokeObjectURL(a.href);
  }



  // drag a wall (or one end of it) in the 2D plan
  function moveWall(wallId, a, b) {
    edit((d) => {
      const w = d.levels.find((x) => x.id === level.id).walls.find((x) => x.id === wallId);
      if (w) { w.a = a; w.b = b; }
    }, true);
  }

  // a room drawn with the room tool. centroid = average of the corners, good enough for the label
  function addRoom(poly) {
    let newId = null;
    edit((d) => {
      const l = d.levels.find((x) => x.id === level.id);
      l.rooms = l.rooms || [];
      newId = nextId(l, "r");
      const cx = poly.reduce((t, p) => t + p[0], 0) / poly.length, cy = poly.reduce((t, p) => t + p[1], 0) / poly.length;
      l.rooms.push({ id: newId, code: "", name: "", kind: "unknown", polygon: poly, centroid: [cx, cy],
        area: polygonArea(poly), boundary: [], confidence: 1 });
    }, true);
    setTool("select");
    setTimeout(() => newId && setSelection({ type: "room", id: newId }), 0);
  }

  // try a trip between two rooms (the server runs wf_cli route on the saved file)
  async function findRoute(from, to, stepFree) {
    if (from == null) { setRoute(null); return; }
    setBusy("route");
    try {
      const r = await api.route(id, text, from, to, stepFree);
      setRoute(r);
      if (r.ok) setLevelId(r.steps[0].level); // jump to where the route starts
    } catch (e) { setRoute({ ok: false, error: e.message }); } finally { setBusy(""); }
  }

  function addWall(a, b) {
    edit((d) => {
      const l = d.levels.find((x) => x.id === level.id);
      l.walls = l.walls || [];
      const wid = nextId(l, "w");
      l.walls.push({ id: wid, a, b, thickness: 0.15, confidence: 1 });
    }, true);
  }

  function addDoor(wall, at) {
    const width = 0.9;
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (len < width + 0.1) { flash("Wall too short for a door"); return; }
    // centre the door where you clicked but keep it inside the wall
    const offset = Math.min(Math.max(at - width / 2, 0.05), len - width - 0.05);
    let newId = null;
    edit((d) => {
      const l = d.levels.find((x) => x.id === level.id);
      l.openings = l.openings || [];
      newId = nextId(l, "o");
      l.openings.push({ id: newId, wall: wall.id, type: "door", offset, width, height: 2.1, sill: 0, confidence: 1 });
    }, true);
    setTool("select");
    setTimeout(() => newId && setSelection({ type: "opening", id: newId }), 0);
  }

  const deleteSelected = useCallback(() => {
    if (!selection || !level) return;
    edit((d) => {
      const l = d.levels.find((x) => x.id === level.id);
      if (selection.type === "wall") {
        l.walls = l.walls.filter((w) => w.id !== selection.id);
        l.openings = (l.openings || []).filter((o) => o.wall !== selection.id); // its doors go too
      } else if (selection.type === "room") {
        l.rooms = l.rooms.filter((r) => r.id !== selection.id);
        l.anchors = (l.anchors || []).filter((a) => a.id !== "a-" + selection.id); // its starting point too
      } else if (selection.type === "opening") {
        l.openings = l.openings.filter((o) => o.id !== selection.id);
      }
    }, true);
    setSelection(null);
  }, [selection, level, edit]);

  // keyboard shortcuts, but not while typing in a box
  useEffect(() => {
    const onKey = (e) => {
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      else if (e.key === "v") setTool("select");
      else if (e.key === "w") setTool("wall");
      else if (e.key === "d") setTool("door");
      else if (e.key === "r") setTool("room");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // warn before leaving with unsaved changes
  useEffect(() => {
    const onLeave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  // clicking a room in the 3D viewer selects it here too
  const onRoomClicked = useCallback((room) => {
    setLevelId(room.level);
    setSelection({ type: "room", id: room.id });
  }, []);

  if (error) return <div className="page"><p className="error-text">{error}</p><button onClick={() => go("/")}>Back to buildings</button></div>;
  if (!doc || !level) return <div className="page muted">Loading building...</div>;

  const s = summary(doc);

  // the uploaded picture for this level (only buildings made from pictures on the server have one)
  const hasPic = api.mode === "server" && (info?.sources || []).some((x) => x.level === level.id);
  const dims = picDims[level.id];
  const underlay = hasPic && blueprint && dims
    ? { url: picUrl(level.id), w: dims.w, h: dims.h, scale: info.scale || 0.02, opacity } : null;

  // stairs/lifts on this level that go somewhere, so the plan can mark them
  const linksHere = [];
  for (const k of doc.links || []) {
    for (const [here, there] of [[k.a, k.b], [k.b, k.a]]) {
      const [lv, node] = here.split(":");
      if (lv !== level.id) continue;
      const n = (level.nodes || []).find((x) => x.id === node);
      if (n) linksHere.push({ pos: n.pos, kind: k.kind, to: there.split(":")[0] });
    }
  }
  const errors = problems.filter((p) => p.type === "error").length;
  const status = info?.publishedAt ? (dirty || info.status === "changed" ? "Edited since publish" : `Published v${info.version}`) : "Draft";
  // floors listed top floor first, like the buttons in a lift
  const floorsTopDown = [...doc.levels].reverse();
  const toggleSheet = (name) => setSheet((cur) => (cur === name ? null : name));

  return (
    <div className="editor">
      <header className="ed-top">
        <a className="wordmark" href="#/" onClick={(e) => { if (dirty && !window.confirm("Leave without saving?")) e.preventDefault(); }}>
          Wayforge <span>Studio</span>
        </a>
        <div className="ed-title">
          <h1>{doc.building.name || id}</h1>
          <span className={"status" + (status.startsWith("Published") ? " is-live" : "")}>{status}</span>
        </div>
        <div className="ed-actions">
          <button className="quiet" onClick={doUndo} disabled={!undo.current.length} title="Ctrl+Z">Undo</button>
          <button className="quiet" onClick={doRedo} disabled={!redo.current.length} title="Ctrl+Y">Redo</button>
          <span className="sep" />
          <button className="quiet" onClick={download} title="Download the .wfb file">Download</button>
          <button onClick={save} disabled={!dirty || busy === "save"} title="Ctrl+S">{busy === "save" ? "Saving..." : dirty ? "Save" : "Saved"}</button>
          <button className="primary" onClick={publish} disabled={busy === "publish"}>{busy === "publish" ? "Publishing..." : "Publish"}</button>
          {info?.publishedAt && <a className="button" href={navigatorLink(id)} target="_blank" rel="noreferrer">Open in Navigator</a>}
        </div>
      </header>

      {geometryChanged && (
        <div className="banner">Walls or doors edited. Paths update on save.</div>
      )}

      <div className="ed-body">
        <aside className="ed-side">
          <section>
            <h2>Levels</h2>
            <ol className="levels">
              {floorsTopDown.map((l) => (
                <li key={l.id}>
                  <button className={l.id === level.id ? "on" : ""} onClick={() => { setLevelId(l.id); setSelection(null); }}>
                    <b>{l.id}</b><span>{l.name}</span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
          <section className="side-links">
            <button className={sheet === "building" ? "on" : ""} onClick={() => toggleSheet("building")}>Building details</button>
            <button className={sheet === "links" ? "on" : ""} onClick={() => toggleSheet("links")}>Stairs and lifts <em>{s.links}</em></button>
            <button className={sheet === "checks" ? "on" : ""} onClick={() => toggleSheet("checks")}>
              Checks {problems.length > 0 && <em className={errors ? "bad" : "warn"}>{problems.length}</em>}
            </button>
            <button className={sheet === "route" ? "on" : ""} onClick={() => toggleSheet("route")}>Test a route</button>
          </section>
          <p className="side-foot">{s.rooms} rooms, {s.tagged} tagged<br />{s.floors} levels</p>
        </aside>

        <main className="ed-main">
          <div className="view-switch" role="tablist">
            <button role="tab" aria-selected={centre === "2d"} className={centre === "2d" ? "on" : ""} onClick={() => setCentre("2d")}>2D</button>
            <button role="tab" aria-selected={centre === "3d"} className={centre === "3d" ? "on" : ""} onClick={() => setCentre("3d")}>3D</button>
          </div>

          {sheet && (
            <div className="sheet">
              <button className="sheet-close" onClick={() => setSheet(null)} aria-label="Close">Close</button>
              {sheet === "summary" && (
                <div>
                  <h2>Build summary</h2>
                  <ul className="checks">{buildLog.map((t, i) => <li key={i}>{t}</li>)}</ul>
                  <p className="muted small">Check the rooms in orange, they are the ones the engine wasn't sure about.</p>
                </div>
              )}
              {sheet === "building" && <BuildingPanel doc={doc} onChange={edit} current={level.id} onPick={setLevelId} />}
              {sheet === "route" && <RoutePanel doc={doc} onRoute={findRoute} route={route} busy={busy === "route"} dirty={dirty} />}
              {sheet === "links" && <LinksPanel doc={doc} onChange={edit} />}
              {sheet === "checks" && <ChecksPanel problems={problems} onPick={(p) => { if (p.level) setLevelId(p.level); if (p.room) setSelection({ type: "room", id: p.room }); }} />}
            </div>
          )}

          {/* keep the 3D mounted once opened so Unity doesn't reload every time */}
          <div className="canvas" style={{ display: centre === "2d" ? "block" : "none" }}>
            <PlanView level={level} selection={selection} tool={tool} showPaths={showPaths} route={route}
              underlay={underlay} links={linksHere}
              onSelect={setSelection} onAddWall={addWall} onAddDoor={addDoor} onMoveWall={moveWall} onAddRoom={addRoom} />
          </div>
          <Lazy3D show={centre === "3d"}>
            <Viewer3D wfbText={text} levelId={level.id} route={route} onRoomClicked={onRoomClicked}
              highlight={selection?.type === "room" ? `${level.id}:${selection.id}` : ""} />
          </Lazy3D>
        </main>

        <footer className="ed-bottom">
          <div className="tools" role="toolbar" aria-label="Tools">
            <span className="group-name">Tools</span>
            <button className={tool === "select" ? "on" : ""} onClick={() => setTool("select")}>Select <kbd>V</kbd></button>
            <button className={tool === "wall" ? "on" : ""} onClick={() => { setTool("wall"); setCentre("2d"); }}>Wall <kbd>W</kbd></button>
            <button className={tool === "door" ? "on" : ""} onClick={() => { setTool("door"); setCentre("2d"); }}>Door <kbd>D</kbd></button>
            <button className={tool === "room" ? "on" : ""} onClick={() => { setTool("room"); setCentre("2d"); }}>Room <kbd>R</kbd></button>
            <label className="check"><input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} /> Paths</label>
            {hasPic && (
              <label className="check" title="Show the uploaded blueprint under the plan">
                <input type="checkbox" checked={blueprint} onChange={(e) => setBlueprint(e.target.checked)} /> Blueprint
                {blueprint && <input type="range" min="0.1" max="1" step="0.05" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Blueprint opacity" />}
              </label>
            )}
          </div>
          <div className="edit-strip">
            <span className="group-name">Edit</span>
            <SelectionPanel level={level} selection={selection} onChange={edit} onDelete={deleteSelected} />
          </div>
        </footer>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// only mount the 3D viewer the first time you open its tab, then keep it
function Lazy3D({ show, children }) {
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (show) setOpened(true); }, [show]);
  if (!opened) return null;
  return <div className="canvas" style={{ display: show ? "block" : "none" }}>{children}</div>;
}
