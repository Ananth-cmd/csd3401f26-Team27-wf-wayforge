/*!
 * \file App.jsx
 * \brief top of the Studio website: header + which page to show
 *
 * pages are picked from the url hash (#/, #/new, #/b/<id>) so we don't
 * need a router library and it works from any static server
 *
 * \author Katie Lim
 */
import { useEffect, useState } from "react";
import { api } from "./api/api.js";
import BuildingsPage from "./pages/BuildingsPage.jsx";
import UploadPage from "./pages/UploadPage.jsx";
import EditorPage from "./pages/EditorPage.jsx";

const currentPath = () => window.location.hash.replace(/^#/, "") || "/";

export default function App() {
  const [path, setPath] = useState(currentPath());

  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (to) => { window.location.hash = to; };

  let page;
  const m = /^\/b\/(.+)$/.exec(path);
  if (m) page = <EditorPage key={m[1]} id={decodeURIComponent(m[1])} go={go} />;
  else if (path === "/new") page = <UploadPage go={go} />;
  else page = <BuildingsPage go={go} />;

  // the editor has its own top bar (undo, save, publish), other pages share this one
  if (m) return <div className="app app-editor">{page}</div>;
  return (
    <div className="app">
      <header className="site-top">
        <a href="#/" className="wordmark">Wayforge <span>Studio</span></a>
        <nav>
          <a href="#/" className={path === "/" ? "on" : ""}>Buildings</a>
          <a href="#/new" className={path === "/new" ? "on" : ""}>New building</a>
        </nav>
        <span className={"backend " + api.mode} title={api.mode === "mock" ? "Data is kept in this browser" : "Connected to the server"}>
          {api.mode === "mock" ? "Offline demo data" : "Server"}
        </span>
      </header>
      {page}
    </div>
  );
}
