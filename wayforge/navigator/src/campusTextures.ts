/*!
 * \file campusTextures.ts
 * \brief Material textures for the 3D campus view (Campus3D.tsx)
 *
 * Each texture is one repeating tile of a façade, drawn on a canvas at PX_PER_M
 * pixels per metre from photographs of the built campus, together with a
 * surface map of the same tile: green channel = roughness, blue channel =
 * metalness, as three.js reads them. Glass is smooth and partly metallic so
 * it reflects the sky and the buildings around it; precast, timber and
 * planting are rough. A tile is `w` metres along the wall by `h` metres high
 * and starts at ground level, so with uv = (metres along the wall / w,
 * height / h) the windows line up with the floors.
 *
 *   heart       W3, W5, W6: fluted beige precast, staggered windows in white
 *               frames, each under a red hood (two floors per tile)
 *   hub         W1 library: red slats with light soffits between them
 *   court       E2, E5, E6: white slab bands, ribbon windows with mullions,
 *               planting along the slab edge
 *   tower       E1: blue curtain-wall panel with mullion and transom
 *   auditorium  E3: bronze fins with a light slit every 6 m
 *   sports      E4: timber battens
 *   green       green wall with pink-flowering creepers
 *   pv          roof with arrays of photovoltaic panels
 *   office      neighbouring buildings: grey bands with window strips
 *   bridge      link bridge in its colour with a glass band
 *
 * Links: used by Campus3D.tsx; the finish of each block is chosen in
 * facades.ts.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Façade, roof and surface textures of the 3D campus
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-11-24
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

import * as THREE from 'three'
import { applyFacadeGrain } from './landmarks/renderPolish'

export const PX_PER_M = 48
export const FLOOR = 4.5 // storey height of the campus model, metres

export type Tile = { w: number; h: number; map: THREE.CanvasTexture; surface: THREE.CanvasTexture }

// Surface values for the surface map: [roughness, metalness], 0..1.
const ROUGH: [number, number] = [0.85, 0]
const GLASS: [number, number] = [0.16, 0.22]
const MATT_METAL: [number, number] = [0.45, 0.5]

// A tile drawer gets two pens that draw rectangles in wall metres (x along the wall, y height above the tile's
// bottom, both measured from the bottom left), one on the colour canvas and one on the surface canvas.
type Pen = {
  rect: (x: number, y: number, w: number, h: number, colour: string | CanvasGradient, surface?: [number, number]) => void
  ellipse: (x: number, y: number, rx: number, ry: number, colour: string, surface?: [number, number]) => void
  glass: (y0: number, y1: number, top: string, bottom: string) => CanvasGradient
}

function tile(w: number, h: number, draw: (p: Pen) => void, base: string, baseSurface: [number, number] = ROUGH): Tile {
  const cw = Math.round(w * PX_PER_M), ch = Math.round(h * PX_PER_M)
  const make = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c }
  const colour = make(), surface = make()
  const g = colour.getContext('2d')!, s = surface.getContext('2d')!
  const surf = ([r, m]: [number, number]) => `rgb(0, ${Math.round(r * 255)}, ${Math.round(m * 255)})`
  g.fillStyle = base; g.fillRect(0, 0, cw, ch)
  s.fillStyle = surf(baseSurface); s.fillRect(0, 0, cw, ch)
  const X = (x: number) => x * PX_PER_M, Y = (y: number) => (h - y) * PX_PER_M
  draw({
    rect: (x, y, rw, rh, c, sv) => {
      g.fillStyle = c; g.fillRect(X(x), Y(y + rh), rw * PX_PER_M, rh * PX_PER_M)
      if (sv) { s.fillStyle = surf(sv); s.fillRect(X(x), Y(y + rh), rw * PX_PER_M, rh * PX_PER_M) }
    },
    ellipse: (x, y, rx, ry, c, sv) => {
      g.fillStyle = c; g.beginPath(); g.ellipse(X(x), Y(y), rx * PX_PER_M, ry * PX_PER_M, 0, 0, Math.PI * 2); g.fill()
      if (sv) { s.fillStyle = surf(sv); s.beginPath(); s.ellipse(X(x), Y(y), rx * PX_PER_M, ry * PX_PER_M, 0, 0, Math.PI * 2); s.fill() }
    },
    glass: (y0, y1, top, bottom) => { const gr = g.createLinearGradient(0, Y(y1), 0, Y(y0)); gr.addColorStop(0, top); gr.addColorStop(1, bottom); return gr },
  })
  // Add subtle material variation to rough surfaces.
  applyFacadeGrain(g, s)
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  return { w, h, map: tex(colour, true), surface: tex(surface, false) }
}

// W3, W5, W6: window x, y (bottom left of the glass), glass 1.3 x 2.0 m, white frame, red hood box over the top and
// both sides (deeper on the right)
function hoodWindow(p: Pen, x: number, y: number) {
  const w = 1.3, h = 2.0
  p.rect(x - 0.09, y - 0.09, w + 0.18, h + 0.18, '#f5f3ef')
  p.rect(x, y, w, h, p.glass(y, y + h, '#56707e', '#a9bfca'), GLASS)
  p.rect(x + w / 2 - 0.03, y, 0.06, h, '#f5f3ef', ROUGH)
  p.rect(x - 0.28, y + h + 0.1, w + 0.7, 0.48, '#d2412c')
  p.rect(x + w + 0.1, y - 0.15, 0.34, h + 0.73, '#a9311f')
  p.rect(x - 0.28, y - 0.15, 0.14, h + 0.73, '#b8382a')
  p.rect(x - 0.28, y + h + 0.52, w + 0.7, 0.06, '#e7735d')
}

export type TextureSet = Record<string, Tile>

// All textures, made once per page and shared.
let cache: TextureSet | null = null
export function campusTextures(): TextureSet {
  if (cache) return cache
  const set: TextureSet = {
    heart: tile(6, 2 * FLOOR, p => {
      for (let x = 0.15; x < 6; x += 0.3) p.rect(x, 0, 0.07, 2 * FLOOR, '#e2dbcf')
      p.rect(0, 0, 6, 0.14, '#cfc7b7'); p.rect(0, FLOOR, 6, 0.14, '#cfc7b7')
      hoodWindow(p, 0.4, 1.0); hoodWindow(p, 3.4, 1.0); hoodWindow(p, 1.9, FLOOR + 1.0); hoodWindow(p, 4.4, FLOOR + 1.0)
    }, '#f0ebe2'),
    hub: tile(4, FLOOR, p => {
      for (let x = 0; x <= 4; x += 1) p.rect(x, 0, 0.06, FLOOR, '#6b5c55')
      for (const y of [0.3, 0.75, 1.2, 1.65, 2.1, 2.55, 3.0, 3.45, 3.9]) { p.rect(0, y, 4, 0.34, '#cf4430'); p.rect(0, y + 0.28, 4, 0.06, '#ec7259') }
      p.rect(0, 0, 4, 0.2, '#9e2f20')
    }, '#d9d3cb'),
    court: tile(9, FLOOR, p => {
      p.rect(0, 1.35, 9, 1.95, p.glass(1.35, 3.3, '#55656e', '#a3b5be'), GLASS)
      for (let x = 0; x <= 9; x += 1.5) p.rect(x - 0.05, 1.35, 0.1, 1.95, '#eef0ed', ROUGH)
      p.rect(0, 3.3, 9, 0.14, '#d8dad5'); p.rect(0, 1.28, 9, 0.07, '#c9ccc6')
      ;[0.6, 1.3, 2.0, 2.9, 5.4, 6.1, 6.9, 7.6].forEach((x, i) => p.ellipse(x, 0.85 - (i % 2) * 0.12, 0.42, 0.3, '#4f8b3f'))
      ;[0.9, 1.7, 2.5, 5.8, 6.5, 7.3].forEach(x => p.ellipse(x, 0.98, 0.3, 0.2, '#6aa653'))
    }, '#f3f3f0'),
    tower: tile(1.5, FLOOR, p => {
      p.rect(0, 0, 1.5, FLOOR, p.glass(0, FLOOR, '#456a88', '#93b6d1'), GLASS)
      p.rect(0, 0, 1.5, 0.38, '#3b5870', MATT_METAL)
      p.rect(0, 0, 0.07, FLOOR, '#d9e4ec', MATT_METAL)
      p.rect(0, 0.38, 1.5, 0.04, '#c4d3de', MATT_METAL)
    }, '#6f93b0', GLASS),
    auditorium: tile(6, FLOOR, p => {
      for (let x = 0.2; x < 6; x += 0.6) { p.rect(x, 0, 0.2, FLOOR, '#715843'); p.rect(x + 0.2, 0, 0.05, FLOOR, '#3a2c21') }
      p.rect(2.87, 0.4, 0.26, FLOOR - 0.8, '#e6d7b9', ROUGH)
    }, '#4d3b2d', MATT_METAL),
    sports: tile(1, FLOOR, p => {
      for (let x = 0; x < 1; x += 0.25) p.rect(x, 0, 0.05, FLOOR, '#7f5a35')
      p.rect(0, 0, 1, 0.3, '#6d4c2f')
    }, '#b4854f'),
    green: tile(2, 2, p => {
      p.ellipse(0.4, 1.6, 0.4, 0.3, '#5c9a47'); p.ellipse(1.4, 1.3, 0.45, 0.32, '#5c9a47')
      p.ellipse(0.8, 0.6, 0.42, 0.3, '#5c9a47'); p.ellipse(1.7, 0.3, 0.35, 0.28, '#5c9a47')
      p.ellipse(1.0, 1.1, 0.25, 0.18, '#2c5f2a'); p.ellipse(0.2, 0.3, 0.22, 0.16, '#2c5f2a')
      p.ellipse(0.6, 1.4, 0.07, 0.07, '#d98bb0'); p.ellipse(1.5, 0.8, 0.07, 0.07, '#d98bb0'); p.ellipse(0.3, 0.8, 0.06, 0.06, '#d98bb0')
    }, '#3d7535'),
    // Plain concrete roof without solar panel patterns.
    pv: tile(14, 10, () => {}, '#dedbd2', ROUGH),
    office: tile(3, 3.6, p => {
      p.rect(0, 1.0, 3, 1.9, p.glass(1.0, 2.9, '#5a6b75', '#9aaab3'), GLASS)
      p.rect(1.47, 1.0, 0.06, 1.9, '#d7dad6', ROUGH)
    }, '#d3d6d0'),
  }
  cache = set
  return set
}

// Link bridge texture in the bridge colour: solid body with a glass band, one floor high. Cached per colour.
const bridgeCache = new Map<string, Tile>()
export function bridgeTexture(colour: string): Tile {
  let t = bridgeCache.get(colour)
  if (!t) {
    t = tile(4, FLOOR, p => {
      p.rect(0, 1.0, 4, 2.2, p.glass(1.0, 3.2, '#4d5d66', '#a0b2bb'), GLASS)
      for (let x = 0; x < 4; x += 1) p.rect(x, 1.0, 0.06, 2.2, colour, ROUGH)
    }, colour)
    bridgeCache.set(colour, t)
  }
  return t
}
