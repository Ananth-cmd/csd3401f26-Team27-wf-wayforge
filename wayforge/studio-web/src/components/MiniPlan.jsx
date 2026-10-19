/*!
 * \file MiniPlan.jsx
 * \brief small read-only drawing of one level, for the buildings page
 *
 * just rooms and walls, no clicking. tabs on top switch the level.
 * the .wfb has y pointing up, so it's drawn flipped like in PlanView
 *
 * \author Katie Lim
 */
import { useState } from "react";
import { KIND_COLOURS, levelBounds } from "../lib/wfb.js";

export default function MiniPlan({ doc }) {
  const [levelId, setLevelId] = useState(doc.levels[0]?.id);
  const level = doc.levels.find((l) => l.id === levelId) || doc.levels[0];
  if (!level) return null;
  const b = levelBounds(level);
  const pad = 1;
  const box = `${b.minX - pad} ${-b.maxY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`;

  return (
    <div className="mini">
      {doc.levels.length > 1 && (
        <div className="mini-levels">
          {doc.levels.map((l) => (
            <button key={l.id} className={l.id === level.id ? "on" : ""} onClick={() => setLevelId(l.id)}>{l.id}</button>
          ))}
        </div>
      )}
      <svg viewBox={box} className="mini-svg" role="img" aria-label={`Plan of ${level.name || level.id}`}>
        <g transform="scale(1,-1)">
          {(level.rooms || []).map((r) => (
            <polygon key={r.id} points={r.polygon.map((p) => p.join(",")).join(" ")} fill={KIND_COLOURS[r.kind] || KIND_COLOURS.unknown} />
          ))}
          {(level.walls || []).map((w) => (
            <line key={w.id} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} className="wall" strokeWidth={Math.max(0.15, w.thickness || 0.15)} />
          ))}
        </g>
      </svg>
    </div>
  );
}
