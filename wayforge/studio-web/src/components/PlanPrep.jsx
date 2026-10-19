/*!
 * \file PlanPrep.jsx
 * \brief get a blueprint picture ready before it's sent to wf_cli
 *
 * real drawings have a border, title block, north arrow, notes... the engine
 * would read those as walls too. so here you:
 *   Crop    - drag a box around just the floor plan
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

export default function PlanPrep({ floor, crop, onCrop, scale, onScale }) {
  const svgRef = useRef(null);
  const [tool, setTool] = useState("crop");
  const [drag, setDrag] = useState(null);   // crop box being drawn
  const [pts, setPts] = useState([]);       // measure points
  const [metres, setMetres] = useState("");

  const W = floor.w, H = floor.h;
  if (!W) return <p className="muted">Loading picture...</p>;

  // screen -> picture pixels
  const toImg = (e) => {
    const p = svgRef.current.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform(svgRef.current.getScreenCTM().inverse());
    return [Math.max(0, Math.min(W, q.x)), Math.max(0, Math.min(H, q.y))];
  };

  function down(e) {
    if (tool === "crop") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const p = toImg(e);
      setDrag({ a: p, b: p });
    } else {
      const p = toImg(e);
      setPts((cur) => (cur.length >= 2 ? [p] : [...cur, p]));
    }
  }
  function move(e) { if (drag) setDrag({ ...drag, b: toImg(e) }); }
  function up() {
    if (!drag) return;
    const x = Math.min(drag.a[0], drag.b[0]), y = Math.min(drag.a[1], drag.b[1]);
    const w = Math.abs(drag.a[0] - drag.b[0]), h = Math.abs(drag.a[1] - drag.b[1]);
    setDrag(null);
    if (w > 20 && h > 20) onCrop({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  }

  const box = drag
    ? { x: Math.min(drag.a[0], drag.b[0]), y: Math.min(drag.a[1], drag.b[1]), w: Math.abs(drag.a[0] - drag.b[0]), h: Math.abs(drag.a[1] - drag.b[1]) }
    : crop;
  const px = pts.length === 2 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) : 0;
  const k = Math.max(W, H) / 900; // keeps lines and dots a readable size on big scans

  // (this sits inside the upload <form>, so no nested form here, just a button)
  function applyMeasure() {
    const m = Number(metres);
    if (px > 0 && m > 0) onScale(m / px);
  }

  const used = crop || { w: W, h: H };

  return (
    <div className="prep">
      <div className="prep-bar">
        <div className="seg">
          <button type="button" className={tool === "crop" ? "on" : ""} onClick={() => setTool("crop")}>Crop</button>
          <button type="button" className={tool === "measure" ? "on" : ""} onClick={() => setTool("measure")}>Measure</button>
        </div>
        {tool === "crop" ? (
          <span className="muted small">Drag a box around the floor plan. Leave out the border, title block and notes.</span>
        ) : (
          <span className="muted small">Click both ends of a dimension line or the scale bar.</span>
        )}
        {crop && tool === "crop" && <button type="button" className="quiet small" onClick={() => onCrop(null)}>Clear crop</button>}
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className={"prep-img tool-" + tool}
        onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <image href={floor.url} x="0" y="0" width={W} height={H} />
        {box && (
          <>
            {/* dim everything outside the crop */}
            <path fillRule="evenodd" className="prep-shade"
              d={`M0 0H${W}V${H}H0Z M${box.x} ${box.y}h${box.w}v${box.h}h${-box.w}Z`} />
            <rect x={box.x} y={box.y} width={box.w} height={box.h} className="prep-box" strokeWidth={2 * k} />
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
            ? <>1 pixel = {(scale * 100).toFixed(2)} cm, so this plan is about {Math.round(used.w * scale)} × {Math.round(used.h * scale)} m.</>
            : <>No scale set; the engine will guess 2 cm per pixel. Use Measure if the sizes look wrong.</>}
          {crop && <> Cropped to {crop.w} × {crop.h} px.</>}
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
