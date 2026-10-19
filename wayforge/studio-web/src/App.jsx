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

  return (
    <div className={"app" + (m ? " app-editor" : "")}>
      <header className="top">
        <a href="#/" className="brand"><span className="logo">W</span> Wayforge <span>Studio</span></a>
        <div className="spacer" />
        <span className={"mode " + api.mode} title={api.mode === "mock" ? "using the pretend backend" : "using the real server"}>
          {api.mode === "mock" ? "Mock backend" : "Server"}
        </span>
      </header>
      {page}
    </div>
  );
}
