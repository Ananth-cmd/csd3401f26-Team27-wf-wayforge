/*!
 * \file Viewer3D.jsx
 * \brief 3D preview using Ananth's Unity WebGL viewer (wayforge/viewer)
 *
 * we don't render 3D ourselves, the viewer already does it (walls, windows,
 * doors, roofs...). it's loaded in an iframe from /viewer/index.html (vite
 * serves wayforge/viewer/Build/WebGL there, see vite.config.js). the iframe is
 * on the same site, so we grab its window.viewer and call the functions in
 * docs/viewer.md directly, e.g. viewer.loadBuilding(text), viewer.showRoof(false).
 *
 * the bar on top lets you look inside the building:
 *   Floors  - the whole building, or only the level picked on the left
 *   Roof    - roofs on / off (the viewer only draws them with all floors, no
 *             cut-away and no spread, so the box is greyed out otherwise)
 *   See inside - walls cut down to 1.2 m so you look into the rooms from above
 *   Spread  - pulls the floors apart so you can see between them
 *   Labels  - room names on / off
 * these are kept here and sent again after every reload of the building,
 * because loading a building puts the viewer back to its defaults. nothing
 * is sent before the first building, the viewer would only answer "no building loaded".
 *
 * if the build isn't there it shows a short message instead.
 *
 * \author Katie Lim
 */
import { useEffect, useRef, useState } from "react";

const VIEWER_URL = import.meta.env.BASE_URL + "viewer/index.html";

export default function Viewer3D({ wfbText, levelId, onRoomClicked, highlight }) {
  const frameRef = useRef(null);
  const viewerRef = useRef(null);
  const [state, setState] = useState("checking"); // checking | missing | loading | ready | error
  const [loaded, setLoaded] = useState(false);     // a building has been sent, so the settings can follow
  const [message, setMessage] = useState("");
  const clickRef = useRef(onRoomClicked);
  clickRef.current = onRoomClicked;

  // what the bar is set to
  const [allFloors, setAllFloors] = useState(true);
  const [roof, setRoof] = useState(true);
  const [inside, setInside] = useState(false); // the cut-away
  const [spread, setSpread] = useState(0);     // metres between floors
  const [labels, setLabels] = useState(true);
  const roofPossible = allFloors && !inside && spread === 0;

  // is the WebGL build actually there? vite sends back our own index.html for
  // missing files, so check for the viewer's canvas instead of just res.ok
  useEffect(() => {
    let stop = false;
    fetch(VIEWER_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => { if (!stop) setState(t.includes("viewer-canvas") ? "loading" : "missing"); })
      .catch(() => !stop && setState("missing"));
    return () => { stop = true; };
  }, []);

  // after the iframe loads, wait for the viewer inside it to be ready
  function onFrameLoad() {
    const started = Date.now();
    const timer = setInterval(() => {
      let v = null;
      try { v = frameRef.current?.contentWindow?.viewer; } catch { /* other site, can't reach it */ }
      if (v) {
        clearInterval(timer);
        viewerRef.current = v;
        v.on("roomClicked", (room) => clickRef.current && clickRef.current(room));
        v.on("error", (err) => setMessage(`3D: ${err.message}`));
        setState("ready");
      } else if (Date.now() - started > 90000) {
        clearInterval(timer);
        setState("error");
        setMessage("The 3D view took too long to start. Try reloading the page.");
      }
    }, 300);
  }

  // send everything the bar is set to (after a reload of the building, or when one setting changes)
  function apply() {
    const v = viewerRef.current;
    if (!v) return;
    if (allFloors) v.showAllFloors(); else if (levelId) v.showFloor(levelId);
    v.setCutaway(inside);
    v.setFloorSpacing(allFloors ? spread : 0);
    v.showRoof(roof);
    v.showLabels(labels);
  }

  // send the building again whenever it changes (small wait so typing a
  // room name doesn't reload the 3D on every key press)
  useEffect(() => {
    if (state !== "ready" || !wfbText) return;
    const t = setTimeout(() => {
      try {
        viewerRef.current.loadBuilding(wfbText);
        if (loaded) apply(); // first time: setLoaded below makes the effects send everything
        else setLoaded(true);
      } catch (e) { setMessage(String(e.message || e)); }
    }, 600);
    return () => clearTimeout(t);
  }, [state, wfbText]); // the bar's settings are sent by the effect below, no reload needed

  useEffect(() => {
    if (loaded) apply();
  }, [loaded, allFloors, levelId, inside, spread, roof, labels]);

  // the room picked on the 2D plan goes yellow in 3D too ("" clears it)
  useEffect(() => {
    if (loaded) viewerRef.current.highlightRoom(highlight || "");
  }, [loaded, highlight]);

  const call = (method, ...args) => viewerRef.current && viewerRef.current[method](...args);

  if (state === "checking") return <div className="viewer-msg">Loading the 3D view...</div>;
  if (state === "missing") {
    // (developers: build it in Unity with Wayforge > Build WebGL Viewer, then build the Studio again)
    return (
      <div className="viewer-msg">
        <h3>3D view not available</h3>
        <p>The 3D view isn't included in this copy of the Studio. The 2D plan and everything else still work.</p>
      </div>
    );
  }

  return (
    <div className="viewer-wrap">
      {state === "ready" && (
        <div className="viewer-bar" role="toolbar" aria-label="3D view">
          <div className="seg">
            <button className={allFloors ? "on" : ""} onClick={() => setAllFloors(true)}>Whole building</button>
            <button className={!allFloors ? "on" : ""} onClick={() => setAllFloors(false)}>This floor ({levelId})</button>
          </div>
          <label className="check" title={roofPossible ? "" : "Roofs only show with the whole building, no See inside and no spread"}>
            <input type="checkbox" checked={roof} disabled={!roofPossible} onChange={(e) => setRoof(e.target.checked)} /> Roof
          </label>
          <label className="check" title="Cut the walls down so you can look into the rooms">
            <input type="checkbox" checked={inside} onChange={(e) => setInside(e.target.checked)} /> See inside
          </label>
          <label className="check" title="Pull the floors apart">
            Spread
            <input type="range" min="0" max="10" step="0.5" value={spread} disabled={!allFloors}
              onChange={(e) => setSpread(Number(e.target.value))} aria-label="Space between floors" />
          </label>
          <label className="check">
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
          </label>
          <span className="sep" />
          <button className="small" onClick={() => call("setView", "3d")}>3D</button>
          <button className="small" onClick={() => call("setView", "2d")}>Top down</button>
          <button className="small" onClick={() => call("resetView")}>Reset</button>
        </div>
      )}
      {state === "loading" && <div className="viewer-msg overlay">Loading the 3D view...</div>}
      {message && <div className="viewer-error">{message}</div>}
      <iframe ref={frameRef} src={VIEWER_URL} title="3D view of the building" onLoad={onFrameLoad} />
    </div>
  );
}
