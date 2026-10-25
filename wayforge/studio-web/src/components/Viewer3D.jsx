/*!
 * \file Viewer3D.jsx
 * \brief 3D preview using Ananth's Unity WebGL viewer (wayforge/viewer)
 *
 * we don't render 3D ourselves, the viewer already does it. it's loaded in
 * an iframe from /viewer/index.html (copy the WebGL build into
 * public/viewer, see the README there). because the iframe is on the same
 * site we can grab its window.viewer and call the api in docs/viewer.md
 * directly, e.g. viewer.loadBuilding(text), viewer.showFloor("L2").
 *
 * if the build isn't there yet it just shows a message instead.
 *
 * \author Katie Lim
 */
import { useEffect, useRef, useState } from "react";

const VIEWER_URL = import.meta.env.BASE_URL + "viewer/index.html";

export default function Viewer3D({ wfbText, levelId, route, onRoomClicked, highlight }) {
  const frameRef = useRef(null);
  const viewerRef = useRef(null);
  const [state, setState] = useState("checking"); // checking | missing | loading | ready | error
  const [message, setMessage] = useState("");
  const clickRef = useRef(onRoomClicked);
  clickRef.current = onRoomClicked;

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
        v.on("error", (err) => setMessage(`viewer: ${err.command} - ${err.message}`));
        setState("ready");
      } else if (Date.now() - started > 90000) {
        clearInterval(timer);
        setState("error");
        setMessage("the viewer took too long to start");
      }
    }, 300);
  }

  // send the building again whenever it changes (small wait so typing a
  // room name doesn't reload the 3D on every key press)
  useEffect(() => {
    if (state !== "ready" || !wfbText) return;
    const t = setTimeout(() => {
      try {
        viewerRef.current.loadBuilding(wfbText);
        if (levelId) viewerRef.current.showFloor(levelId);
      } catch (e) { setMessage(String(e.message || e)); }
    }, 600);
    return () => clearTimeout(t);
  }, [state, wfbText]); // not on levelId, changing floor is the effect below (no reload)

  useEffect(() => {
    if (state === "ready" && levelId) viewerRef.current.showFloor(levelId);
  }, [state, levelId]);

  useEffect(() => {
    if (state !== "ready") return;
    if (route && route.ok) viewerRef.current.showRoute(route, { animate: true });
    else viewerRef.current.clearRoute();
  }, [state, route]);

  // the room picked on the 2D plan goes yellow in 3D too ("" clears it)
  useEffect(() => {
    if (state === "ready") viewerRef.current.highlightRoom(highlight || "");
  }, [state, highlight]);

  const call = (method, ...args) => viewerRef.current && viewerRef.current[method](...args);

  if (state === "checking") return <div className="viewer-msg">checking for the 3D viewer...</div>;
  if (state === "missing") {
    return (
      <div className="viewer-msg">
        <h3>3D viewer not available</h3>
        <p>Build it in Unity: <b>Wayforge &gt; Build WebGL Viewer</b>.</p>
      </div>
    );
  }

  return (
    <div className="viewer-wrap">
      {state === "ready" && (
        <div className="viewer-bar">
          <button onClick={() => call("setView", "3d")}>3D</button>
          <button onClick={() => call("setView", "2d")}>Top down</button>
          <button onClick={() => call("showFloor", levelId)}>This floor</button>
          <button onClick={() => call("showAllFloors")}>All floors</button>
          <button onClick={() => call("resetView")}>Reset</button>
        </div>
      )}
      {state === "loading" && <div className="viewer-msg overlay">starting the 3D viewer...</div>}
      {message && <div className="viewer-error">{message}</div>}
      <iframe ref={frameRef} src={VIEWER_URL} title="Wayforge 3D viewer" onLoad={onFrameLoad} />
    </div>
  );
}
