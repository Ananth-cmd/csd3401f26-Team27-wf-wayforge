/*!
 * \file facadePatterns.tsx
 * \brief SVG façade textures of the SIT Punggol blocks for the campus drawing without WebGL
 *
 * One <pattern> per finish in facades.ts, drawn from photographs of the built
 * campus. Used when the rendered campus (Campus3D.tsx) is not available; the
 * same designs are in campusTextures.ts for the rendered campus. Patterns are in wall coordinates, metres: x along the wall, y the
 * height above the ground (y grows upwards on screen because MapView.tsx draws
 * each wall through a matrix that flips it). Tiles start at height 0 and repeat
 * every floor (4.5 m) or every two floors, so the windows line up with the
 * floors of the campus model.
 *
 *   wf-fc-heart       W3, W5, W6: fluted beige precast, staggered windows in
 *                     white frames, each under a red hood
 *   wf-fc-hub         W1 library: red slats with light soffits between them
 *   wf-fc-court       E2, E5, E6: white slab bands, dark ribbon windows with
 *                     mullions, planting along the slab edge
 *   wf-fc-tower       E1: blue glass curtain wall with mullions and transoms
 *   wf-fc-auditorium  E3: bronze fins with a light slit every 6 m
 *   wf-fc-sports      E4: timber battens
 *   wf-fc-green       green wall with flowering creepers (W block end faces)
 *   wf-pv             roof photovoltaic panels
 *
 * Links: rendered inside the <defs> of MapView.tsx; finishes from facades.ts.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Façade textures of the campus blocks
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-11-24
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

const FLOOR = 4.5 // storey height of the campus model, metres

// path of vertical lines from y0 to y1 at every step from x0 to x1
const verticals = (x0: number, x1: number, step: number, y0: number, y1: number) => {
  let d = ''
  for (let x = x0; x <= x1 + 1e-6; x += step) d += `M${x.toFixed(2)} ${y0}V${y1}`
  return d
}

// W3, W5, W6: one window under a red hood. x, y: bottom left of the glass; w, h: glass size
function HoodWindow({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return <>
    <rect x={x - 0.09} y={y - 0.09} width={w + 0.18} height={h + 0.18} fill="#f5f3ef" />
    <rect x={x} y={y} width={w} height={h} fill="url(#wf-fc-glass)" />
    <rect x={x + w / 2 - 0.03} y={y} width={0.06} height={h} fill="#f5f3ef" />
    <rect x={x - 0.18} y={y + h + 0.1} width={w + 0.5} height={0.32} fill="#c8402d" />
    <rect x={x + w + 0.1} y={y - 0.1} width={0.22} height={h + 0.52} fill="#a9311f" />
    <rect x={x - 0.18} y={y + h + 0.1} width={w + 0.5} height={0.06} fill="#e7735d" />
  </>
}

export default function FacadePatterns() {
  const heartW = 6, heartWin = { w: 1.3, h: 2.0 }
  return <>
    <linearGradient id="wf-fc-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#2f3d45" /><stop offset="1" stopColor="#6f8794" />
    </linearGradient>
    <linearGradient id="wf-fc-glass-light" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#5d6d76" /><stop offset="1" stopColor="#9fb1ba" />
    </linearGradient>
    <linearGradient id="wf-fc-blue" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#456a88" /><stop offset="1" stopColor="#8fb3cf" />
    </linearGradient>

    {/* W3, W5, W6: two floors per tile so the windows can be staggered from floor to floor */}
    <pattern id="wf-fc-heart" patternUnits="userSpaceOnUse" width={heartW} height={2 * FLOOR}>
      <rect width={heartW} height={2 * FLOOR} fill="#e9e3d7" />
      <path d={verticals(0.15, heartW, 0.3, 0, 2 * FLOOR)} stroke="#d5cdbe" strokeWidth={0.07} />
      <rect y={0} width={heartW} height={0.14} fill="#cfc7b7" />
      <rect y={FLOOR} width={heartW} height={0.14} fill="#cfc7b7" />
      <HoodWindow x={0.4} y={1.0} {...heartWin} /><HoodWindow x={3.4} y={1.0} {...heartWin} />
      <HoodWindow x={1.9} y={FLOOR + 1.0} {...heartWin} /><HoodWindow x={4.4} y={FLOOR + 1.0} {...heartWin} />
    </pattern>

    {/* W1 library: red slats with light soffits between them */}
    <pattern id="wf-fc-hub" patternUnits="userSpaceOnUse" width={4} height={FLOOR}>
      <rect width={4} height={FLOOR} fill="#d9d3cb" />
      <path d={verticals(0, 4, 1, 0, FLOOR)} stroke="#6b5c55" strokeWidth={0.06} />
      {[0.3, 0.75, 1.2, 1.65, 2.1, 2.55, 3.0, 3.45, 3.9].map(y => <g key={y}>
        <rect y={y} width={4} height={0.34} fill="#cf4430" />
        <rect y={y + 0.28} width={4} height={0.06} fill="#ec7259" />
      </g>)}
      <rect width={4} height={0.2} fill="#9e2f20" />
    </pattern>

    {/* E2, E5, E6: slab band with planting, ribbon window with mullions, soffit band */}
    <pattern id="wf-fc-court" patternUnits="userSpaceOnUse" width={9} height={FLOOR}>
      <rect width={9} height={FLOOR} fill="#f3f3f0" />
      <rect y={1.35} width={9} height={1.95} fill="url(#wf-fc-glass-light)" />
      <path d={verticals(0, 9, 1.5, 1.35, 3.3)} stroke="#eef0ed" strokeWidth={0.1} />
      <rect y={3.3} width={9} height={0.14} fill="#d8dad5" />
      <rect y={1.28} width={9} height={0.07} fill="#c9ccc6" />
      <g fill="#4f8b3f">
        {[0.6, 1.3, 2.0, 2.9, 5.4, 6.1, 6.9, 7.6].map((x, i) => <ellipse key={x} cx={x} cy={0.85 - (i % 2) * 0.12} rx={0.42} ry={0.3} />)}
      </g>
      <g fill="#6aa653">
        {[0.9, 1.7, 2.5, 5.8, 6.5, 7.3].map(x => <ellipse key={x} cx={x} cy={0.98} rx={0.3} ry={0.2} />)}
      </g>
    </pattern>

    {/* E1: curtain wall, one 1.5 m panel per tile */}
    <pattern id="wf-fc-tower" patternUnits="userSpaceOnUse" width={1.5} height={FLOOR}>
      <rect width={1.5} height={FLOOR} fill="url(#wf-fc-blue)" />
      <rect width={1.5} height={0.38} fill="#3b5870" />
      <rect width={0.07} height={FLOOR} fill="#d9e4ec" />
      <rect y={0.38} width={1.5} height={0.04} fill="#c4d3de" />
    </pattern>

    {/* E3: bronze fins every 0.6 m, a light slit every 6 m */}
    <pattern id="wf-fc-auditorium" patternUnits="userSpaceOnUse" width={6} height={FLOOR}>
      <rect width={6} height={FLOOR} fill="#4d3b2d" />
      <path d={verticals(0.3, 6, 0.6, 0, FLOOR)} stroke="#715843" strokeWidth={0.2} />
      <path d={verticals(0.42, 6, 0.6, 0, FLOOR)} stroke="#3a2c21" strokeWidth={0.05} />
      <rect x={2.9} y={0.4} width={0.26} height={FLOOR - 0.8} fill="#e6d7b9" />
    </pattern>

    {/* E4: timber battens */}
    <pattern id="wf-fc-sports" patternUnits="userSpaceOnUse" width={1} height={FLOOR}>
      <rect width={1} height={FLOOR} fill="#b4854f" />
      <path d={verticals(0, 1, 0.25, 0, FLOOR)} stroke="#7f5a35" strokeWidth={0.05} />
      <rect width={1} height={0.3} fill="#6d4c2f" />
    </pattern>

    {/* green wall with pink-flowering creepers */}
    <pattern id="wf-fc-green" patternUnits="userSpaceOnUse" width={2} height={2}>
      <rect width={2} height={2} fill="#3d7535" />
      <g fill="#5c9a47">
        <ellipse cx={0.4} cy={0.4} rx={0.4} ry={0.3} /><ellipse cx={1.4} cy={0.7} rx={0.45} ry={0.32} />
        <ellipse cx={0.8} cy={1.4} rx={0.42} ry={0.3} /><ellipse cx={1.7} cy={1.7} rx={0.35} ry={0.28} />
      </g>
      <g fill="#2c5f2a"><ellipse cx={1.0} cy={0.9} rx={0.25} ry={0.18} /><ellipse cx={0.2} cy={1.7} rx={0.22} ry={0.16} /></g>
      <g fill="#d98bb0"><circle cx={0.6} cy={0.6} r={0.07} /><circle cx={1.5} cy={1.2} r={0.07} /><circle cx={0.3} cy={1.2} r={0.06} /></g>
    </pattern>

    {/* roof photovoltaic panels */}
    <pattern id="wf-pv" patternUnits="userSpaceOnUse" width="7" height="5"><rect width="7" height="5" fill="#eceeef" /><rect x="0.6" y="0.8" width="4.2" height="2.2" fill="#8798aa" /><path d="M2.7 0.8V3M0.6 1.9H4.8" stroke="#eceeef" strokeWidth="0.1" /></pattern>
  </>
}
