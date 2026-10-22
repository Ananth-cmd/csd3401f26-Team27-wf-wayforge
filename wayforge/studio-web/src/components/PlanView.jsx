/*!
 * \file PlanView.jsx
 * \brief the 2D blueprint of one floor, drawn with SVG
 *
 * draws the uploaded blueprint underneath (optional), rooms coloured by
 * kind, walls, doors/windows, stair/lift links, labels and the walking
 * paths / a test route. scroll to zoom, drag empty space to pan.
 * anything the engine wasn't sure about (confidence under 0.7) is orange.
 *
 * tools:
 *   select - click a room / wall / door. a selected wall can be dragged to
 *            move it, or its end dots dragged to move one end
 *   wall   - click start point then end point to add a wall (Esc cancels)
 *   door   - click on a wall to put a door there
 *   room   - click the corners of a new room, click the first corner again
 *            (or press Enter) to finish. Backspace undoes a corner, Esc cancels
 *
 * the .wfb is in metres with y pointing up (north), the screen has y pointing
 * down. so everything is drawn inside a <g> flipped with scale(1,-1), and
 * toPlan() flips the mouse back. text is drawn outside the flip so it isn't
 * upside down.
 *
 * \author Katie Lim
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_COLOURS, levelBounds, openingEnds } from "../lib/wfb.js";

const SNAP = 0.4;   // metres, how close you need to be to snap to a wall end
const UNSURE = 0.7; // confidence below this is shown in orange

const unsure = (x) => (x.confidence ?? 1) < UNSURE;

export default function PlanView({
  level, selection, tool, showPaths, route, underlay, links = [],
  onSelect, onAddWall, onAddDoor, onMoveWall, onAddRoom,
}) {
  const svgRef = useRef(null);
  const [view, setView] = useState(null); // {x, y, w, h} = the svg viewBox (screen space, y down)
  const [wallStart, setWallStart] = useState(null);
  const [roomPts, setRoomPts] = useState([]);
  const [mouse, setMouse] = useState(null);   // plan coords
  const [moving, setMoving] = useState(null); // {id, a, b} wall being dragged (preview)
  const drag = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 }); // svg size in pixels, for the scale bar

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(svg);
    return () => ro.disconnect();
  }, [view === null]);

  const bounds = useMemo(() => levelBounds(level), [level]);

  // fit the floor in the view when we switch floors (y flipped: top of the view is -maxY)
  const fit = () => {
    const pad = 2;
    setView({
      x: bounds.minX - pad, y: -bounds.maxY - pad,
      w: bounds.maxX - bounds.minX + pad * 2, h: bounds.maxY - bounds.minY + pad * 2,
    });
  };
  useEffect(fit, [level.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // keys for the drawing tools
  useEffect(() => {
    const onKey = (e) => {
      if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
      if (e.key === "Escape") { setWallStart(null); setRoomPts([]); }
      if (tool === "room" && e.key === "Enter") finishRoom();
      if (tool === "room" && e.key === "Backspace" && roomPts.length) { e.stopPropagation(); setRoomPts((p) => p.slice(0, -1)); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => { setWallStart(null); setRoomPts([]); }, [tool, level.id]);

  // the wheel listener has to be non passive so the page doesn't scroll
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      const p = toSvg(e);
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView((v) => v && ({ x: p[0] - (p[0] - v.x) * k, y: p[1] - (p[1] - v.y) * k, w: v.w * k, h: v.h * k }));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });

  // screen pixel -> svg units, and -> plan metres (y up)
  function toSvg(e) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }
  const toPlan = (e) => { const [x, y] = toSvg(e); return [x, -y]; };

  // snap to the nearest wall end so walls join up properly (skip the wall being moved)
  function snap(p, skipId) {
    let best = null, bestD = SNAP;
    for (const w of level.walls || []) {
      if (w.id === skipId) continue;
      for (const q of [w.a, w.b]) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    return best ? [...best] : [Math.round(p[0] * 20) / 20, Math.round(p[1] * 20) / 20];
  }

  function finishRoom() {
    if (roomPts.length >= 3) onAddRoom(roomPts);
    setRoomPts([]);
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const hit = e.target.closest ? e.target.closest("[data-type]") : null;
    // grabbing a selected wall (or one of its end dots) moves it instead of panning
    if (tool === "select" && e.button === 0 && hit && selection?.type === "wall") {
      const w = (level.walls || []).find((x) => x.id === selection.id);
      const t = hit.dataset.type;
      if (w && (t === "handle" || (t === "wall" && hit.dataset.id === w.id))) {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { wall: w, end: t === "handle" ? hit.dataset.id : "both", start: toPlan(e), moved: false };
        return;
      }
    }
    drag.current = { sx: e.clientX, sy: e.clientY, view, moved: false, pointer: e.pointerId };
  }

  function onPointerMove(e) {
    const p = toPlan(e);
    setMouse(p);
    const d = drag.current;
    if (!d) return;
    if (d.wall) {
      const dx = p[0] - d.start[0], dy = p[1] - d.start[1];
      if (Math.abs(dx) + Math.abs(dy) > 0.05) d.moved = true;
      const w = d.wall;
      let a = w.a, b = w.b;
      if (d.end === "a") a = snap(p, w.id);
      else if (d.end === "b") b = snap(p, w.id);
      else { a = [w.a[0] + dx, w.a[1] + dy]; b = [w.b[0] + dx, w.b[1] + dy]; }
      setMoving({ id: w.id, a, b });
      return;
    }
    if (!d.view) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      d.moved = true;
      // only grab the pointer once it's really a pan, so normal clicks still hit the room/wall
      svgRef.current.setPointerCapture(d.pointer);
    }
    if (!d.moved) return;
    const rect = svgRef.current.getBoundingClientRect();
    // the viewBox keeps its aspect ratio, so use the bigger scale
    const scale = Math.max(d.view.w / rect.width, d.view.h / rect.height);
    setView({ ...d.view, x: d.view.x - dx * scale, y: d.view.y - dy * scale });
  }

  function onPointerUp(e) {
    const d = drag.current;
    drag.current = null;
    if (d && d.wall) {
      if (d.moved && moving) onMoveWall(moving.id, moving.a, moving.b);
      setMoving(null);
      return;
    }
    if (d && d.moved) return; // it was a pan, not a click
    if (tool === "wall") {
      const p = snap(toPlan(e));
      if (!wallStart) setWallStart(p);
      else {
        if (Math.hypot(p[0] - wallStart[0], p[1] - wallStart[1]) > 0.1) onAddWall(wallStart, p);
        setWallStart(null);
      }
      return;
    }
    if (tool === "room") {
      const p = snap(toPlan(e));
      // clicking near the first corner closes the room
      if (roomPts.length >= 3 && Math.hypot(p[0] - roomPts[0][0], p[1] - roomPts[0][1]) < SNAP * 1.5) finishRoom();
      else setRoomPts((cur) => [...cur, p]);
      return;
    }
    // what did we click on? every clickable shape has data-type + data-id
    const hit = e.target.closest ? e.target.closest("[data-type]") : null;
    const type = hit?.dataset.type, id = hit?.dataset.id;
    if (tool === "door") {
      // put a door where you clicked on the wall
      const w = type === "wall" && (level.walls || []).find((x) => x.id === id);
      if (!w) return;
      const p = toPlan(e);
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1];
      const len = Math.hypot(dx, dy);
      const t = ((p[0] - w.a[0]) * dx + (p[1] - w.a[1]) * dy) / (len * len);
      onAddDoor(w, t * len);
      return;
    }
    if (type === "handle") return;
    // clicking empty space clears the selection
    onSelect(type ? { type, id } : null);
  }

  if (!view) return <div className="plan-wrap"><svg ref={svgRef} className="plan" /></div>;
  const isSel = (type, id) => selection && selection.type === type && selection.id === id;
  const font = Math.max(0.35, Math.min(view.w, view.h) / 45);
  const routeHere = route && route.ok ? route.steps.filter((s) => s.level === level.id) : [];
  // while a wall is being dragged, draw it where it's going
  const wallsShown = (level.walls || []).map((w) => (moving && moving.id === w.id ? { ...w, a: moving.a, b: moving.b } : w));
  const levelShown = moving ? { ...level, walls: wallsShown } : level;
  const selWall = selection?.type === "wall" && tool === "select" ? wallsShown.find((w) => w.id === selection.id) : null;

  return (
    <div className="plan-wrap">
    <button className="fit-btn" onClick={fit} title="Fit the whole level in view">Fit to screen</button>
    <div className="legend"><i className="lg-unsure" /> Low confidence</div>
    {tool === "wall" && <div className="plan-hint">{wallStart ? "Click the end point (Esc to cancel)" : "Click the start point"}</div>}
    {tool === "door" && <div className="plan-hint">Click a wall to add a door</div>}
    {tool === "room" && <div className="plan-hint">{roomPts.length < 3 ? "Click each corner" : "Click the first corner or press Enter to finish"}</div>}
    {tool === "select" && selWall && <div className="plan-hint">Drag to move, or drag an end point</div>}
    <svg
      ref={svgRef}
      className={`plan tool-${tool}`}
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setMouse(null)}
    >
      {/* graph paper: thin line every metre, darker every 5 m. drawn in metres so it zooms with the plan */}
      <defs>
        <pattern id="grid1" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" className="grid-minor" />
        </pattern>
        <pattern id="grid5" width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill="url(#grid1)" />
          <path d="M 5 0 L 0 0 0 5" className="grid-major" />
        </pattern>
      </defs>
      <rect data-bg="1" x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} className="paper" />
      <rect x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#grid5)" pointerEvents="none" />

      {/* the uploaded picture. wf_cli puts picture pixel (u,v) at (u*scale, (height-v)*scale),
          which in screen space is just the picture at (0, -height*scale), the right way up */}
      {underlay && underlay.w > 0 && (
        <image href={underlay.url} x={0} y={-underlay.h * underlay.scale} width={underlay.w * underlay.scale}
          height={underlay.h * underlay.scale} opacity={underlay.opacity} preserveAspectRatio="none" pointerEvents="none" />
      )}

      <g transform="scale(1,-1)">
        {/* rooms first so walls draw on top */}
        {(level.rooms || []).map((r) => (
          <polygon
            key={r.id}
            points={r.polygon.map((p) => p.join(",")).join(" ")}
            fill={KIND_COLOURS[r.kind] || KIND_COLOURS.unknown}
            className={"room" + (isSel("room", r.id) ? " selected" : "") + (unsure(r) ? " unsure" : "") + (underlay?.opacity > 0.5 ? " see-through" : "")}
            data-type="room" data-id={r.id}
          />
        ))}

        {showPaths && (level.edges || []).map((e, i) => {
          const a = level.nodes.find((n) => n.id === e.a), b = level.nodes.find((n) => n.id === e.b);
          if (!a || !b) return null;
          return <line key={i} x1={a.pos[0]} y1={a.pos[1]} x2={b.pos[0]} y2={b.pos[1]} className="edge" />;
        })}
        {showPaths && (level.nodes || []).map((n) => (
          <circle key={n.id} cx={n.pos[0]} cy={n.pos[1]} r={font * 0.25} className={`node node-${n.kind}`} />
        ))}

        {wallsShown.map((w) => (
          <g key={w.id} data-type="wall" data-id={w.id} className="wall-g">
            <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]}
              strokeWidth={Math.max(0.12, w.thickness || 0.15)}
              className={"wall" + (isSel("wall", w.id) ? " selected" : "") + (unsure(w) ? " unsure" : "")} />
            {/* fat invisible line so thin walls are easy to click */}
            <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} strokeWidth={font * 1.2} className="hit" />
          </g>
        ))}

        {(level.openings || []).map((o) => {
          const ends = openingEnds(levelShown, o);
          if (!ends) return null;
          const th = Math.max(0.12, ends.wall.thickness || 0.15);
          return (
            <g key={o.id} data-type="opening" data-id={o.id} className="opening-g">
              {/* paint over the wall to make the gap, then draw the door itself */}
              <line x1={ends.a[0]} y1={ends.a[1]} x2={ends.b[0]} y2={ends.b[1]} strokeWidth={th + 0.06} className="gap" />
              <line x1={ends.a[0]} y1={ends.a[1]} x2={ends.b[0]} y2={ends.b[1]} strokeWidth={th * 0.5}
                className={`opening opening-${o.type}` + (isSel("opening", o.id) ? " selected" : "") + (unsure(o) ? " unsure" : "")} />
              <line x1={ends.a[0]} y1={ends.a[1]} x2={ends.b[0]} y2={ends.b[1]} strokeWidth={font} className="hit" />
            </g>
          );
        })}

        {/* stairs/lifts that go to another floor */}
        {links.map((k, i) => (
          <circle key={i} cx={k.pos[0]} cy={k.pos[1]} r={font * 0.55} className={`link-dot link-${k.kind}`} />
        ))}

        {routeHere.length > 1 && (
          <polyline points={routeHere.map((s) => `${s.x},${s.y}`).join(" ")} className="route" strokeWidth={font * 0.35} />
        )}
        {routeHere.length > 0 && (
          <>
            <circle cx={routeHere[0].x} cy={routeHere[0].y} r={font * 0.5} className="route-start" />
            <circle cx={routeHere.at(-1).x} cy={routeHere.at(-1).y} r={font * 0.5} className="route-end" />
          </>
        )}

        {/* end dots of the selected wall, drag them to move that end */}
        {selWall && ["a", "b"].map((end) => (
          <circle key={end} cx={selWall[end][0]} cy={selWall[end][1]} r={font * 0.45} className="handle" data-type="handle" data-id={end} />
        ))}

        {tool === "wall" && wallStart && mouse && (
          <line x1={wallStart[0]} y1={wallStart[1]} x2={snap(mouse)[0]} y2={snap(mouse)[1]} className="wall preview" strokeWidth={0.15} />
        )}
        {tool === "wall" && wallStart && <circle cx={wallStart[0]} cy={wallStart[1]} r={font * 0.3} className="route-start" />}

        {tool === "room" && roomPts.length > 0 && (
          <>
            <polyline points={[...roomPts, ...(mouse ? [snap(mouse)] : [])].map((p) => p.join(",")).join(" ")} className="room-draft" strokeWidth={font * 0.12} />
            {roomPts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={font * (i === 0 ? 0.4 : 0.25)} className="room-draft-pt" />)}
          </>
        )}
      </g>

      {/* labels last so nothing covers them. outside the flip, so y is negated by hand */}
      {(level.rooms || []).map((r) => {
        const c = r.centroid || r.polygon[0];
        return (
          <text key={r.id} x={c[0]} y={-c[1]} fontSize={font} className="label" textAnchor="middle">
            <tspan x={c[0]} dy="-0.2em" fontWeight="600">{r.code || r.id}</tspan>
            {r.name && <tspan x={c[0]} dy="1.15em" fontSize={font * 0.8}>{r.name}</tspan>}
          </text>
        );
      })}
      {links.map((k, i) => (
        <text key={i} x={k.pos[0] + font * 0.8} y={-k.pos[1] + font * 0.3} fontSize={font * 0.8} className="link-label">
          {k.kind === "lift" ? "lift" : "stairs"} to {k.to}
        </text>
      ))}
    </svg>
    <ScaleBar view={view} size={size} />
    </div>
  );
}

// "how long is 1 metre on screen" so people can tell if a room size looks right.
// picks a round length that ends up roughly 80-160 px wide
function ScaleBar({ view, size }) {
  if (!size.w || !view) return null;
  const pxPerM = Math.min(size.w / view.w, size.h / view.h);
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const metres = steps.find((m) => m * pxPerM >= 80) || steps.at(-1);
  return (
    <div className="scalebar" aria-hidden="true">
      <div className="bar" style={{ width: metres * pxPerM }} />
      <span>{metres} m</span>
    </div>
  );
}
