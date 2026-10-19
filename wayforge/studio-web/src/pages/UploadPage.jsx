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
    <div className="page narrow">
      <button className="ghost" onClick={() => go("/")}>← Buildings</button>
      <h1>New building</h1>

      <div className="tabs">
        <button className={mode === "images" ? "active" : ""} onClick={() => setMode("images")}>From floor plan pictures</button>
        <button className={mode === "wfb" ? "active" : ""} onClick={() => setMode("wfb")}>From a .wfb file</button>
      </div>

      <form onSubmit={submit} className="form">
        <label>Building name {mode === "wfb" && <span className="muted">(leave empty to keep the name in the file)</span>}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. SIT Punggol Campus E2" />
        </label>

        {mode === "images" ? (
          <>
            <div
              className={"drop" + (dragOver ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            >
              <p><b>Drop floor plan pictures here</b>, one per floor (bottom floor first)</p>
              <label className="button">Choose pictures
                <input type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              </label>
              <p className="muted small">Scans and phone photos both work. Straight on photos read better.</p>
            </div>

            {floors.length > 0 && (
              <ol className="floor-list">
                {floors.map((f, i) => (
                  <li key={f.url}>
                    <img src={f.url} alt="" />
                    <div className="grow">
                      <b>L{i + 1}</b> <span className="muted small">{f.file.name} · {(f.file.size / 1024).toFixed(0)} KB</span>
                    </div>
                    <button type="button" className="ghost small" onClick={() => move(i, -1)} disabled={i === 0} title="move down a floor">↑</button>
                    <button type="button" className="ghost small" onClick={() => move(i, 1)} disabled={i === floors.length - 1} title="move up a floor">↓</button>
                    <button type="button" className="ghost small danger" onClick={() => removeFloor(i)}>×</button>
                  </li>
                ))}
              </ol>
            )}

            <div className="row3">
              <label>Floor to floor height (m)
                <input type="number" step="0.1" min="2" value={floorHeight} onChange={(e) => setFloorHeight(e.target.value)} />
              </label>
              <label>Latitude <input type="number" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} placeholder="1.4136" /></label>
              <label>Longitude <input type="number" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} placeholder="103.9100" /></label>
            </div>
            <button type="button" className="link" onClick={useMyLocation}>use my current location</button>
          </>
        ) : (
          <div className="drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
            <p><b>{wfbFile ? wfbFile.name : "Drop a .wfb file here"}</b></p>
            <label className="button">Choose .wfb
              <input type="file" accept=".wfb,application/json" hidden onChange={(e) => setWfbFile(e.target.files[0] || null)} />
            </label>
            <p className="muted small">e.g. one made with <code>wf_cli build</code> or saved from the Unity Studio.</p>
          </div>
        )}

        {api.mode === "mock" && mode === "images" && (
          <p className="note">Mock mode: the pictures aren't really read yet (that needs the server running wf_cli),
            you'll get the sample building with {floors.length || "N"} floor(s) instead.</p>
        )}
        {error && <p className="error-text">{error}</p>}

        <div className="row-buttons">
          <button className="primary" type="submit" disabled={!ready || !!step}>{step ? step + "..." : "Create building"}</button>
          <button type="button" className="ghost" onClick={() => go("/")}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
