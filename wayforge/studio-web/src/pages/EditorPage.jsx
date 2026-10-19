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
import { parseWfb, toWfbText, clone, validate, summary, nextId } from "../lib/wfb.js";
import PlanView from "../components/PlanView.jsx";
import Viewer3D from "../components/Viewer3D.jsx";
import { SelectionPanel, BuildingPanel, LinksPanel, ChecksPanel, RoutePanel } from "../components/Inspector.jsx";

const MERGE_MS = 800; // edits closer together than this (like typing) share one undo step

// just the walls and doors, to tell if the shape of the building changed
const geometryKey = (doc) => JSON.stringify(doc.levels.map((l) => [l.walls, l.openings]));

export default function EditorPage({ id, go }) {
  const [info, setInfo] = useState(null);
  const [doc, setDoc] = useState(null);
  const [savedText, setSavedText] = useState("");
  const [error, setError] = useState("");
  const [levelId, setLevelId] = useState(null);
  const [selection, setSelection] = useState(null);
  const [tool, setTool] = useState("select");
  const [centre, setCentre] = useState("2d");
  const [side, setSide] = useState("edit");
  const [showPaths, setShowPaths] = useState(false);
  const [route, setRoute] = useState(null);
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
    if (problems.some((p) => p.type === "error")) { setSide("checks"); flash("Fix the errors first"); return; }
    if (!window.confirm(`Publish "${doc.building.name}" so it shows up in the Navigator?`)) return;
    if (dirty && !(await save())) return;
    setBusy("publish");
    try {
      const res = await api.publishBuilding(id);
      setInfo((i) => ({ ...i, ...res }));
      flash(`Published version ${res.version}`);
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
    if (len < width + 0.1) { flash("That wall is too short for a door"); return; }
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
    if (!selection || selection.type === "room" || !level) return;
    edit((d) => {
      const l = d.levels.find((x) => x.id === level.id);
      if (selection.type === "wall") {
        l.walls = l.walls.filter((w) => w.id !== selection.id);
        l.openings = (l.openings || []).filter((o) => o.wall !== selection.id); // its doors go too
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
    setSide("edit");
  }, []);

  if (error) return <div className="page"><p className="error-text">{error}</p><button onClick={() => go("/")}>Back</button></div>;
  if (!doc || !level) return <div className="page muted">loading building...</div>;

  const s = summary(doc);
  const errors = problems.filter((p) => p.type === "error").length;
  const status = info?.publishedAt ? (dirty || info.status === "changed" ? "changed since publish" : `published v${info.version}`) : "draft";

  return (
    <div className="editor">
      <div className="toolbar">
        <button className="ghost" onClick={() => (!dirty || window.confirm("Leave without saving?")) && go("/")}>← Buildings</button>
        <div className="title">
          <b>{doc.building.name || id}</b>
          <span className={`badge ${status.startsWith("published") ? "pub" : ""}`}>{status}</span>
          <span className="muted small">{s.floors} floors · {s.rooms} rooms · {s.tagged}/{s.rooms} tagged</span>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={doUndo} disabled={!undo.current.length} title="Ctrl+Z">Undo</button>
        <button className="ghost" onClick={doRedo} disabled={!redo.current.length} title="Ctrl+Y">Redo</button>
        <button className="ghost" onClick={download} title="download the .wfb file">Download .wfb</button>
        <button onClick={save} disabled={!dirty || busy === "save"} title="Ctrl+S">{busy === "save" ? "Saving..." : dirty ? "Save" : "Saved"}</button>
        <button className="primary" onClick={publish} disabled={busy === "publish"}>{busy === "publish" ? "Publishing..." : "Publish"}</button>
      </div>

      {geometryChanged && (
        <div className="banner">Walls or doors changed. The walking paths get rebuilt by the server when you save
          (<code>wf_cli graph</code>){api.mode === "mock" ? ", the mock can't do that so test routes still use the old paths" : ""}.</div>
      )}

      <div className="editor-body">
        <aside className="left">
          <h4>Floors</h4>
          {doc.levels.map((l) => (
            <button key={l.id} className={"floor" + (l.id === level.id ? " active" : "")} onClick={() => { setLevelId(l.id); setSelection(null); }}>
              <b>{l.id}</b> <span>{l.name}</span>
            </button>
          ))}
          <h4>Tools</h4>
          <button className={"tool" + (tool === "select" ? " active" : "")} onClick={() => setTool("select")}>Select <kbd>V</kbd></button>
          <button className={"tool" + (tool === "wall" ? " active" : "")} onClick={() => { setTool("wall"); setCentre("2d"); }}>Draw wall <kbd>W</kbd></button>
          <button className={"tool" + (tool === "door" ? " active" : "")} onClick={() => { setTool("door"); setCentre("2d"); }}>Add door <kbd>D</kbd></button>
          <label className="check"><input type="checkbox" checked={showPaths} onChange={(e) => setShowPaths(e.target.checked)} /> show walking paths</label>
        </aside>

        <main className="centre">
          <div className="tabs">
            <button className={centre === "2d" ? "active" : ""} onClick={() => setCentre("2d")}>2D plan</button>
            <button className={centre === "3d" ? "active" : ""} onClick={() => setCentre("3d")}>3D preview</button>
          </div>
          {/* keep the 3D mounted once opened so Unity doesn't reload every time */}
          <div className="centre-view" style={{ display: centre === "2d" ? "block" : "none" }}>
            <PlanView level={level} selection={selection} tool={tool} showPaths={showPaths} route={route}
              onSelect={(sel) => { setSelection(sel); if (sel) setSide("edit"); }} onAddWall={addWall} onAddDoor={addDoor} />
          </div>
          <Lazy3D show={centre === "3d"}>
            <Viewer3D wfbText={text} levelId={level.id} route={route} onRoomClicked={onRoomClicked} />
          </Lazy3D>
        </main>

        <aside className="right">
          <div className="tabs small">
            <button className={side === "edit" ? "active" : ""} onClick={() => setSide("edit")}>Edit</button>
            <button className={side === "building" ? "active" : ""} onClick={() => setSide("building")}>Building</button>
            <button className={side === "links" ? "active" : ""} onClick={() => setSide("links")}>Stairs/lifts</button>
            <button className={side === "checks" ? "active" : ""} onClick={() => setSide("checks")}>
              Checks {problems.length > 0 && <span className={"count" + (errors ? " bad" : "")}>{problems.length}</span>}
            </button>
            <button className={side === "route" ? "active" : ""} onClick={() => setSide("route")}>Route</button>
          </div>
          <div className="panel">
            {side === "edit" && <SelectionPanel level={level} selection={selection} onChange={edit} onDelete={deleteSelected} />}
            {side === "building" && <BuildingPanel doc={doc} onChange={edit} />}
            {side === "links" && <LinksPanel doc={doc} onChange={edit} />}
            {side === "checks" && <ChecksPanel problems={problems} onPick={(p) => { setLevelId(p.level); if (p.room) { setSelection({ type: "room", id: p.room }); setSide("edit"); } }} />}
            {side === "route" && <RoutePanel doc={doc} onRoute={findRoute} route={route} busy={busy === "route"} />}
          </div>
        </aside>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// only mount the 3D viewer the first time you open its tab, then keep it
function Lazy3D({ show, children }) {
  const [opened, setOpened] = useState(false);
  useEffect(() => { if (show) setOpened(true); }, [show]);
  if (!opened) return null;
  return <div className="centre-view" style={{ display: show ? "block" : "none" }}>{children}</div>;
}
