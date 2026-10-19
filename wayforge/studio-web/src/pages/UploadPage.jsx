/*!
 * \file UploadPage.jsx
 * \brief make a new building from floor plan pictures (one per floor)
 *        or from a .wfb file you already have
 *
 * the backend turns the pictures into a building with
 *   wf_cli build out.wfb L1.png L2.png ... --name --floor-height --scale --lat --lon
 * so the order of the pictures here = the order of the floors.
 * before that you can crop away the title block and set the scale (PlanPrep)
 *
 * \author Katie Lim
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/api.js";
import PlanPrep, { cropFile } from "../components/PlanPrep.jsx";
import { autoCrop } from "../lib/autocrop.js";

// smallest box that holds all the boxes (null ones are skipped)
function union(boxes) {
  const b = boxes.filter(Boolean);
  if (!b.length) return null;
  const x0 = Math.min(...b.map((c) => c.x)), y0 = Math.min(...b.map((c) => c.y));
  const x1 = Math.max(...b.map((c) => c.x + c.w)), y1 = Math.max(...b.map((c) => c.y + c.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/bmp"];

export default function UploadPage({ go }) {
  const [mode, setMode] = useState("images");
  const [name, setName] = useState("");
  const [floorHeight, setFloorHeight] = useState("3.5");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  // [{file, url, w, h, auto, crop}]  auto = the automatic guess (undefined while it's working,
  // null if it found nothing), crop = this level's own crop when "same crop" is off
  const [floors, setFloors] = useState([]);
  const [picked, setPicked] = useState(0);   // which picture is shown in the crop/measure view
  const [shared, setShared] = useState(true);       // one crop for every level (keeps floors lined up)
  const [sharedCrop, setSharedCrop] = useState(null);
  const [sharedEdited, setSharedEdited] = useState(false); // once you drag it, stop replacing it with the auto one
  const [scale, setScale] = useState(0);     // metres per pixel, 0 = let wf_cli use its default
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
    const added = images.map((file) => ({ file, url: URL.createObjectURL(file), w: 0, h: 0 }));
    setFloors((cur) => [...cur, ...added]);
    // find out how big each picture is (needed for cropping)
    added.forEach((f) => {
      const img = new Image();
      img.onload = () => {
        setFloors((cur) => cur.map((x) => (x.url === f.url ? { ...x, w: img.naturalWidth, h: img.naturalHeight } : x)));
        // then guess where the plan is on the sheet
        autoCrop(f.url)
          .catch(() => null)
          .then((c) => setFloors((cur) => cur.map((x) => (x.url === f.url ? { ...x, auto: c, crop: c } : x))));
      };
      img.src = f.url;
    });
  }

  const move = (i, by) => setFloors((cur) => {
    const next = [...cur]; const j = i + by;
    if (j < 0 || j >= next.length) return cur;
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const removeFloor = (i) => {
    setFloors((cur) => { URL.revokeObjectURL(cur[i].url); return cur.filter((_, k) => k !== i); });
    setPicked(0);
  };

  // use the phone/laptop location as a starting point for lat/lon
  function useMyLocation() {
    if (!navigator.geolocation) return setError("this browser can't get your location");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLatitude(p.coords.latitude.toFixed(6)); setLongitude(p.coords.longitude.toFixed(6)); },
      () => setError("couldn't get your location, type it in instead"),
    );
  }

  const pickedIndex = Math.min(picked, Math.max(0, floors.length - 1));
  const current = floors[pickedIndex];
  const autoBusy = floors.some((f) => f.auto === undefined);

  // shared crop = a box around every level's plan, so nothing gets cut off on any floor
  const autoUnion = useMemo(() => union(floors.map((f) => f.auto)), [floors]);
  useEffect(() => { if (!sharedEdited) setSharedCrop(autoUnion); }, [autoUnion, sharedEdited]);

  function changeCrop(c) {
    if (shared) { setSharedCrop(c); setSharedEdited(true); }
    else setFloors((cur) => cur.map((f, i) => (i === pickedIndex ? { ...f, crop: c } : f)));
  }
  function resetToAuto() {
    if (shared) { setSharedEdited(false); setSharedCrop(autoUnion); }
    else setFloors((cur) => cur.map((f, i) => (i === pickedIndex ? { ...f, crop: f.auto } : f)));
  }

  const ready = mode === "wfb" ? !!wfbFile : floors.length > 0 && name.trim() && !autoBusy;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setError("");
    try {
      let files = [];
      if (mode === "images") {
        setStep("Cropping the pictures");
        files = await Promise.all(floors.map((f) => cropFile(f, shared ? sharedCrop : f.crop)));
      }
      const res = await api.createBuilding({
        name: name.trim(), floorHeight, latitude, longitude, scale,
        floors: files,
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
          <p className="note">The Studio server isn't running, so the pictures can't be read. You'll get the
            sample plan instead. Start it with <code>npm run server</code> to use your own blueprints.</p>
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
            {current && (
              <>
                <h2>Get the plan ready</h2>
                <PlanPrep floor={current} crop={shared ? sharedCrop : current.crop} onCrop={changeCrop}
                  onAuto={resetToAuto} autoBusy={autoBusy} shared={shared} onShared={setShared}
                  levelLabel={`L${Math.min(picked, floors.length - 1) + 1}`} scale={scale} onScale={setScale} />
                <p className="muted small">The scale is used for every level.</p>
              </>
            )}
            <h2>Levels</h2>
            <p className="muted">One picture per level. The top of the list is the top floor. Click a level to see it above.</p>
            {floors.length > 0 && (
              <ol className="stack">
                {[...floors].map((f, i) => ({ f, i })).reverse().map(({ f, i }) => (
                  <li key={f.url} className={i === Math.min(picked, floors.length - 1) ? "on" : ""} onClick={() => setPicked(i)}>
                    <b className="lvl">L{i + 1}</b>
                    <img src={f.url} alt="" />
                    <span className="grow">{f.file.name}<br /><span className="muted small">{f.w ? `${f.w} × ${f.h} px, ` : ""}{(f.file.size / 1024).toFixed(0)} KB</span></span>
                    <button type="button" className="quiet small" onClick={(e) => { e.stopPropagation(); move(i, 1); }} disabled={i === floors.length - 1} title="Move up a level">Up</button>
                    <button type="button" className="quiet small" onClick={(e) => { e.stopPropagation(); move(i, -1); }} disabled={i === 0} title="Move down a level">Down</button>
                    <button type="button" className="quiet small danger" onClick={(e) => { e.stopPropagation(); removeFloor(i); }}>Remove</button>
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
