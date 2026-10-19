/*!
 * \file PlanPrep.jsx
 * \brief get a blueprint picture ready before it's sent to wf_cli
 *
 * real drawings have a border, title block, north arrow, notes... the engine
 * would read those as walls too. so here you:
 *   Crop    - starts with an automatic guess (lib/autocrop.js). drag the
 *             box's edges/corners to fix it, drag inside to move it
 *   Measure - click both ends of something you know the length of (a
 *             dimension line, a scale bar) and type the real length. that
 *             tells wf_cli how many metres one pixel is (--scale)
 *
 * everything works in the picture's own pixels (the svg viewBox is the
 * image size) so the crop and the measurement don't depend on zoom
 *
 * \author Katie Lim
 */
import { useRef, useState } from "react";

export default function PlanPrep({ floor, crop, onCrop, onAuto, autoBusy, scale, onScale, shared, onShared, levelLabel }) {
  const svgRef = useRef(null);
  const [tool, setTool] = useState("crop");
  const [drag, setDrag] = useState(null);   // {mode, start, orig, edges} while dragging the crop
  const [live, setLive] = useState(null);   // the crop box while it's being dragged
  const [hover, setHover] = useState("crosshair");
  const [pts, setPts] = useState([]);       // measure points
  const [metres, setMetres] = useState("");

  const W = floor.w, H = floor.h;
  if (!W) return <p className="muted">Loading picture...</p>;
  const k = Math.max(W, H) / 900;           // keeps lines and dots a readable size on big scans
  const grab = 12 * k;                      // how close to an edge counts as grabbing it

  // screen -> picture pixels
  const toImg = (e) => {
    const p = svgRef.current.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svgRef.current.getScreenCTM().inverse());
    return [Math.max(0, Math.min(W, q.x)), Math.max(0, Math.min(H, q.y))];
  };

  // what's under the pointer: an edge/corner of the crop (resize), inside it (move), or outside (new box)
  function hitTest([x, y]) {
    if (!crop) return { mode: "new" };
    const l = Math.abs(x - crop.x) < grab, r = Math.abs(x - (crop.x + crop.w)) < grab;
    const t = Math.abs(y - crop.y) < grab, b = Math.abs(y - (crop.y + crop.h)) < grab;
    const insideX = x > crop.x - grab && x < crop.x + crop.w + grab;
    const insideY = y > crop.y - grab && y < crop.y + crop.h + grab;
    const edges = { l: l && insideY, r: r && insideY, t: t && insideX, b: b && insideX };
    if (edges.l || edges.r || edges.t || edges.b) return { mode: "resize", edges };
    if (x > crop.x && x < crop.x + crop.w && y > crop.y && y < crop.y + crop.h) return { mode: "move" };
    return { mode: "new" };
  }
  const cursorFor = (h) => {
    if (h.mode === "move") return "move";
    if (h.mode !== "resize") return "crosshair";
    const { l, r, t, b } = h.edges;
    if ((l && t) || (r && b)) return "nwse-resize";
    if ((r && t) || (l && b)) return "nesw-resize";
    return l || r ? "ew-resize" : "ns-resize";
  };

  function down(e) {
    const p = toImg(e);
    if (tool === "measure") { setPts((cur) => (cur.length >= 2 ? [p] : [...cur, p])); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    const h = hitTest(p);
    setDrag({ ...h, start: p, orig: crop });
    setLive(h.mode === "new" ? { x: p[0], y: p[1], w: 0, h: 0 } : crop);
  }

  function move(e) {
    const p = toImg(e);
    if (!drag) { if (tool === "crop") setHover(cursorFor(hitTest(p))); return; }
    const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
    const o = drag.orig;
    if (drag.mode === "new") {
      setLive({ x: Math.min(p[0], drag.start[0]), y: Math.min(p[1], drag.start[1]), w: Math.abs(dx), h: Math.abs(dy) });
    } else if (drag.mode === "move") {
      setLive({ ...o, x: Math.max(0, Math.min(W - o.w, o.x + dx)), y: Math.max(0, Math.min(H - o.h, o.y + dy)) });
    } else {
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (drag.edges.l) x0 = Math.min(x1 - 20, o.x + dx);
      if (drag.edges.r) x1 = Math.max(x0 + 20, o.x + o.w + dx);
      if (drag.edges.t) y0 = Math.min(y1 - 20, o.y + dy);
      if (drag.edges.b) y1 = Math.max(y0 + 20, o.y + o.h + dy);
      setLive({ x: Math.max(0, x0), y: Math.max(0, y0), w: Math.min(W, x1) - Math.max(0, x0), h: Math.min(H, y1) - Math.max(0, y0) });
    }
  }

  function up() {
    if (!drag) return;
    const b = live;
    setDrag(null); setLive(null);
    if (b && b.w > 20 && b.h > 20) onCrop({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) });
  }

  const box = live || crop;
  const px = pts.length === 2 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) : 0;

  // (this sits inside the upload <form>, so no nested form here, just a button)
  function applyMeasure() {
    const m = Number(metres);
    if (px > 0 && m > 0) onScale(m / px);
  }

  const used = crop || { w: W, h: H };
  // little squares on the corners so it's obvious the box can be dragged
  const corners = box && !live ? [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]] : [];

  return (
    <div className="prep">
      <div className="prep-bar">
        <div className="seg">
          <button type="button" className={tool === "crop" ? "on" : ""} onClick={() => setTool("crop")}>Crop</button>
          <button type="button" className={tool === "measure" ? "on" : ""} onClick={() => setTool("measure")}>Measure</button>
        </div>
        {tool === "crop" ? (
          <>
            <button type="button" className="quiet small" onClick={onAuto} disabled={autoBusy}>{autoBusy ? "Finding the plan..." : "Auto crop"}</button>
            {crop && <button type="button" className="quiet small" onClick={() => onCrop(null)}>No crop</button>}
            <label className="check small"><input type="checkbox" checked={shared} onChange={(e) => onShared(e.target.checked)} /> Same crop for every level</label>
          </>
        ) : (
          <span className="muted small">Click both ends of a known length</span>
        )}
      </div>
      {tool === "crop" && (
        <p className="muted small prep-help">{shared ? "Applies to all levels" : `${levelLabel} only`}</p>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={"prep-img tool-" + tool}
        style={tool === "crop" ? { cursor: drag ? cursorFor(drag) : hover } : undefined}
        onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <image href={floor.url} x="0" y="0" width={W} height={H} />
        {box && (
          <>
            {/* dim everything outside the crop */}
            <path fillRule="evenodd" className="prep-shade"
              d={`M0 0H${W}V${H}H0Z M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z`} />
            <rect x={box.x} y={box.y} width={box.w} height={box.h} className="prep-box" strokeWidth={2 * k} />
            {corners.map(([x, y], i) => (
              <rect key={i} x={x - 5 * k} y={y - 5 * k} width={10 * k} height={10 * k} className="prep-handle" strokeWidth={k} />
            ))}
          </>
        )}
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={6 * k} className="prep-pt" />)}
        {pts.length === 2 && <line x1={pts[0][0]} y1={pts[0][1]} x2={pts[1][0]} y2={pts[1][1]} className="prep-line" strokeWidth={3 * k} />}
      </svg>

      <div className="prep-foot">
        {tool === "measure" && (
          <div className="measure">
            <label>That line is
              <input type="number" step="any" min="0" value={metres} onChange={(e) => setMetres(e.target.value)} placeholder="18" disabled={px === 0}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyMeasure(); } }} />
            </label>
            <span>metres</span>
            <button type="button" onClick={applyMeasure} disabled={px === 0 || !(Number(metres) > 0)}>Set scale</button>
          </div>
        )}
        <p className="small">
          {scale
            ? <>Scale: 1 px = {(scale * 100).toFixed(2)} cm ({Math.round(used.w * scale)} × {Math.round(used.h * scale)} m)</>
            : <>Scale: not set (default 2 cm per px)</>}
          {crop ? <> · Crop: {crop.w} × {crop.h} px</> : null}
        </p>
      </div>
    </div>
  );
}

// cut the cropped part out of a picture and give back a new PNG file
export async function cropFile(floor, crop) {
  if (!crop) return floor.file;
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(`couldn't read ${floor.file.name}`));
    i.src = floor.url;
  });
  // the crop came from the first picture; keep it inside this one in case the sizes differ
  const x = Math.min(crop.x, img.naturalWidth - 1), y = Math.min(crop.y, img.naturalHeight - 1);
  const w = Math.min(crop.w, img.naturalWidth - x), h = Math.min(crop.h, img.naturalHeight - y);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return new File([blob], floor.file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
}
