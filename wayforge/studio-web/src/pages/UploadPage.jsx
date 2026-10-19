/*!
 * \file UploadPage.jsx
 * \brief make a new building from floor plan pictures (one per floor)
 *        or from a .wfb file you already have
 *
 * the backend turns the pictures into a building with
 *   wf_cli build out.wfb L1.png L2.png ... --name --floor-height --lat --lon
 * so the order of the pictures here = the order of the floors
 *
 * \author Katie Lim
 */
import { useEffect, useState } from "react";
import { api } from "../api/api.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/bmp"];

export default function UploadPage({ go }) {
  const [mode, setMode] = useState("images");
  const [name, setName] = useState("");
  const [floorHeight, setFloorHeight] = useState("3.5");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [floors, setFloors] = useState([]); // [{file, url}]
  const [wfbFile, setWfbFile] = useState(null);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // free the preview images when we leave the page
  useEffect(() => () => floors.forEach((f) => URL.revokeObjectURL(f.url)), []); // eslint-disable-line

  function addFiles(list) {
    const files = [...list];
    const wfb = files.find((f) => f.name.toLowerCase().endsWith(".wfb"));
    if (wfb) { setMode("wfb"); setWfbFile(wfb); return; }
    const images = files.filter((f) => IMAGE_TYPES.includes(f.type));
    if (images.length < files.length) setError("some files were skipped, only PNG, JPG, SVG or BMP pictures work");
    else setError("");
    // sort by name so L1, L2, L3 end up in order when you drop them all at once
    images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    setFloors((cur) => [...cur, ...images.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  const move = (i, by) => setFloors((cur) => {
    const next = [...cur]; const j = i + by;
    if (j < 0 || j >= next.length) return cur;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const removeFloor = (i) => setFloors((cur) => { URL.revokeObjectURL(cur[i].url); return cur.filter((_, k) => k !== i); });

  // use the phone/laptop location as a starting point for lat/lon
  function useMyLocation() {
    if (!navigator.geolocation) return setError("this browser can't get your location");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLatitude(p.coords.latitude.toFixed(6)); setLongitude(p.coords.longitude.toFixed(6)); },
      () => setError("couldn't get your location, type it in instead"),
    );
  }

  const ready = mode === "wfb" ? !!wfbFile : floors.length > 0 && name.trim();

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setError("");
    try {
      const res = await api.createBuilding({
        name: name.trim(), floorHeight, latitude, longitude,
        floors: mode === "images" ? floors.map((f) => f.file) : [],
        wfbFile: mode === "wfb" ? wfbFile : null,
      }, setStep);
      go(`/b/${res.id}`);
    } catch (err) {
      setError(err.message);
      setStep("");
    }
  }

  return (
    <form className="split" onSubmit={submit}>
      <section className="split-list">
        <div className="list-head"><h1>New building</h1></div>

        <div className="seg" role="tablist">
          <button type="button" className={mode === "images" ? "on" : ""} onClick={() => setMode("images")}>From floor plans</button>
          <button type="button" className={mode === "wfb" ? "on" : ""} onClick={() => setMode("wfb")}>From a .wfb file</button>
        </div>

        <div className="form">
          <label>Building name {mode === "wfb" && <span className="muted">(empty keeps the name in the file)</span>}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="SIT Punggol, E2" />
          </label>
          {mode === "images" && (
            <>
              <label>Height between levels (m)
                <input type="number" step="0.1" min="2" value={floorHeight} onChange={(e) => setFloorHeight(e.target.value)} />
              </label>
              <div className="row2">
                <label>Latitude <input type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="1.4136" /></label>
                <label>Longitude <input type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="103.9100" /></label>
              </div>
              <button type="button" className="link" onClick={useMyLocation}>Use my current location</button>
            </>
          )}
        </div>

        {api.mode === "mock" && mode === "images" && (
          <p className="note">Demo mode doesn't read the pictures yet; that happens on the server with wf_cli.
            You'll get the sample plan with one level per picture so you can try the editor.</p>
        )}
        {error && <p className="error-text">{error}</p>}

        <div className="row-buttons">
          <button className="primary" type="submit" disabled={!ready || !!step}>{step ? step + "..." : "Create building"}</button>
          <button type="button" className="quiet" onClick={() => go("/")}>Cancel</button>
        </div>
      </section>

      <section className="split-detail">
        {mode === "images" ? (
          <>
            <h2>Levels</h2>
            <p className="muted">One picture per level. The top of the list is the top floor; use the arrows to change the order.</p>
            {floors.length > 0 && (
              <ol className="stack">
                {[...floors].map((f, i) => ({ f, i })).reverse().map(({ f, i }) => (
                  <li key={f.url}>
                    <b className="lvl">L{i + 1}</b>
                    <img src={f.url} alt="" />
                    <span className="grow">{f.file.name}<br /><span className="muted small">{(f.file.size / 1024).toFixed(0)} KB</span></span>
                    <button type="button" className="quiet small" onClick={() => move(i, 1)} disabled={i === floors.length - 1} title="Move up a level">Up</button>
                    <button type="button" className="quiet small" onClick={() => move(i, -1)} disabled={i === 0} title="Move down a level">Down</button>
                    <button type="button" className="quiet small danger" onClick={() => removeFloor(i)}>Remove</button>
                  </li>
                ))}
              </ol>
            )}
            <div
              className={"drop" + (dragOver ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            >
              <p>Drop floor plan pictures here, or</p>
              <label className="button">Choose pictures
                <input type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <p className="muted small">Scans and phone photos both work. Straight-on photos read better.</p>
            </div>
          </>
        ) : (
          <>
            <h2>Building file</h2>
            <div className="drop"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
              <p>{wfbFile ? wfbFile.name : "Drop a .wfb file here, or"}</p>
              <label className="button">Choose .wfb
                <input type="file" accept=".wfb,application/json" hidden onChange={(e) => setWfbFile(e.target.files[0] || null)} />
              </label>
              <p className="muted small">For example one made with <code>wf_cli build</code>, or saved from the Unity Studio.</p>
            </div>
          </>
        )}
      </section>
    </form>
  );
}
