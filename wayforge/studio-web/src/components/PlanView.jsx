/*!
 * \file PlanView.jsx
 * \brief the 2D blueprint of one floor, drawn with SVG
 *
 * draws rooms (coloured by kind), walls, doors/windows and optionally the
 * navigation paths and a test route. you can zoom with the scroll wheel,
 * drag the empty space to pan and click things to select them.
 *
 * tools:
 *   select - click a room / wall / door
 *   wall   - click start point then end point to add a wall (Esc cancels)
 *   door   - click on a wall to put a door there
 *
 * plan coordinates are metres, same as the .wfb, so 1 svg unit = 1 m
 *
 * \author Katie Lim
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_COLOURS, levelBounds, openingEnds } from "../lib/wfb.js";

const SNAP = 0.4; // metres, how close you need to be to snap to a wall end

export default function PlanView({
  level, selection, tool, showPaths, route, onSelect, onAddWall, onAddDoor,
}) {
  const svgRef = useRef(null);
  const [view, setView] = useState(null); // {x, y, w, h} = the svg viewBox
  const [wallStart, setWallStart] = useState(null);
  const [mouse, setMouse] = useState(null);
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

  // fit the floor in the view when we switch floors
  const fit = () => {
    const pad = 2;
    setView({
      x: bounds.minX - pad, y: bounds.minY - pad,
      w: bounds.maxX - bounds.minX + pad * 2, h: bounds.maxY - bounds.minY + pad * 2,
    });
  };
  useEffect(fit, [level.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc cancels a half drawn wall
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setWallStart(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setWallStart(null), [tool, level.id]);

  // the wheel listener has to be non passive so the page doesn't scroll
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      const p = toPlan(e);
      const k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      setView((v) => v && ({ x: p[0] - (p[0] - v.x) * k, y: p[1] - (p[1] - v.y) * k, w: v.w * k, h: v.h * k }));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  });

  // screen pixel -> plan metres
  function toPlan(e) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return [p.x, p.y];
  }

  // snap to the nearest wall end so new walls join up properly
  function snap(p) {
    let best = null, bestD = SNAP;
    for (const w of level.walls || []) {
      for (const q of [w.a, w.b]) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    return best ? [...best] : [Math.round(p[0] * 20) / 20, Math.round(p[1] * 20) / 20];
  }

  function onPointerDown(e) {
    if (e.button !== 0 && e.button !== 1) return;
    drag.current = { sx: e.clientX, sy: e.clientY, view, moved: false, pointer: e.pointerId };
  }

  function onPointerMove(e) {
    setMouse(toPlan(e));
    const d = drag.current;
    if (!d || !d.view) return;
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
    // clicking empty space clears the selection
    onSelect(type ? { type, id } : null);
  }

  if (!view) return <div className="plan-wrap"><svg ref={svgRef} className="plan" /></div>;
  const isSel = (type, id) => selection && selection.type === type && selection.id === id;
  const font = Math.max(0.35, Math.min(view.w, view.h) / 45);
  const routeHere = route && route.ok ? route.steps.filter((s) => s.level === level.id) : [];

  return (
    <div className="plan-wrap">
    <button className="fit-btn" onClick={fit} title="Fit the whole level in view">Fit to screen</button>
    {tool === "wall" && <div className="plan-hint">{wallStart ? "Click where the wall ends. Esc cancels." : "Click where the wall starts."}</div>}
    {tool === "door" && <div className="plan-hint">Click on a wall to put a door there.</div>}
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

      {/* rooms first so walls draw on top */}
      {(level.rooms || []).map((r) => (
        <polygon
          key={r.id}
          points={r.polygon.map((p) => p.join(",")).join(" ")}
          fill={KIND_COLOURS[r.kind] || KIND_COLOURS.unknown}
          className={"room" + (isSel("room", r.id) ? " selected" : "")}
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

      {(level.walls || []).map((w) => (
        <g key={w.id} data-type="wall" data-id={w.id} className="wall-g">
          <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]}
            strokeWidth={Math.max(0.12, w.thickness || 0.15)}
            className={"wall" + (isSel("wall", w.id) ? " selected" : "") + ((w.confidence ?? 1) < 0.5 ? " unsure" : "")} />
          {/* fat invisible line so thin walls are easy to click */}
          <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} strokeWidth={font * 1.2} className="hit" />
        </g>
      ))}

      {(level.openings || []).map((o) => {
        const ends = openingEnds(level, o);
        if (!ends) return null;
        const th = Math.max(0.12, ends.wall.thickness || 0.15);
        return (
          <g key={o.id} data-type="opening" data-id={o.id} className="opening-g">
            {/* paint over the wall to make the gap, then draw the door itself */}
            <line x1={ends.a[0]} y1={ends.a[1]} x2={ends.b[0]} y2={ends.b[1]} strokeWidth={th + 0.06} className="gap" />
            <line x1={ends.a[0]} y1={ends.a[1]} x2={ends.b[0]} y2={ends.b[1]} strokeWidth={th * 0.5}
              className={`opening opening-${o.type}` + (isSel("opening", o.id) ? " selected" : "")} />
            <line x1={ends.a[0]} y1={ends.a[1]} x2={ends.b[0]} y2={ends.b[1]} strokeWidth={font} className="hit" />
          </g>
        );
      })}

      {routeHere.length > 1 && (
        <polyline points={routeHere.map((s) => `${s.x},${s.y}`).join(" ")} className="route" strokeWidth={font * 0.35} />
      )}
      {routeHere.length > 0 && (
        <>
          <circle cx={routeHere[0].x} cy={routeHere[0].y} r={font * 0.5} className="route-start" />
          <circle cx={routeHere.at(-1).x} cy={routeHere.at(-1).y} r={font * 0.5} className="route-end" />
        </>
      )}

      {/* labels last so nothing covers them */}
      {(level.rooms || []).map((r) => {
        const c = r.centroid || r.polygon[0];
        return (
          <text key={r.id} x={c[0]} y={c[1]} fontSize={font} className="label" textAnchor="middle">
            <tspan x={c[0]} dy="-0.2em" fontWeight="600">{r.code || r.id}</tspan>
            {r.name && <tspan x={c[0]} dy="1.15em" fontSize={font * 0.8}>{r.name}</tspan>}
          </text>
        );
      })}

      {tool === "wall" && wallStart && mouse && (
        <line x1={wallStart[0]} y1={wallStart[1]} x2={snap(mouse)[0]} y2={snap(mouse)[1]} className="wall preview" strokeWidth={0.15} />
      )}
      {tool === "wall" && wallStart && <circle cx={wallStart[0]} cy={wallStart[1]} r={font * 0.3} className="route-start" />}
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
