/*!
 * \file Campus3D.tsx
 * \brief Rendered 3D campus view (three.js / WebGL) behind the map
 *
 * Draws the campus blocks, link bridges, ground, water, roads, neighbouring
 * buildings and trees as a lit 3D scene: sunlight with shadows, sky light,
 * and reflections. Walls carry the façade textures of their block
 * (campusTextures.ts, finishes from facades.ts) with a surface map, so glass
 * is smooth and reflects; roofs carry photovoltaic panels. Reflections come
 * from two environment maps: the sky, and a capture of the campus taken once
 * from its centre, which glass and water use so they show the buildings
 * around them.
 *
 * The camera is orthographic and follows the map exactly: MapView.tsx passes
 * its own camera (right, up and forward vectors, the point at the middle of
 * the view and the view size in metres), so labels, markers and routes drawn
 * by the map's SVG on top land in the right place. The scene is redrawn only
 * when the camera, the size, the floor or the page visibility changes. The
 * current floor of every block is outlined in teal. If WebGL is not available,
 * onFail() is called and the map keeps its own drawing.
 *
 * Coordinates: the map's plan [x, z] (z north) becomes three.js (x, y, -z).
 *
 * Links: used by MapView.tsx (lazy loaded); block outlines from massing.ts;
 * textures from campusTextures.ts; finishes from facades.ts; trees from
 * surroundings.ts.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Campus scene: blocks, bridges, ground, water, roads, neighbours, trees
 *   - Sun, shadows, sky and campus reflections
 *   - Camera that follows the map's projection
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-11-24
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { Building, Vec2 } from './types'
import type { MassBlock } from './massing'
import { facadeOf } from './facades'
import { campusTextures, bridgeTexture } from './campusTextures'
import type { Tile } from './campusTextures'
import { treesOf } from './surroundings'

type V3 = [number, number, number]
export type CampusView = { centre: V3; right: V3; up: V3; fwd: V3; at: Vec2; vw: number; vh: number }

type Props = {
  building: Building
  mass: MassBlock[]
  floor: number
  view: CampusView
  width: number
  height: number
  visible: boolean
  onReady: () => void // first frame drawn
  onFail: () => void  // no WebGL: the map keeps its own drawing
}

const AREA: Record<string, string> = { water: '#8fc1dc', grass: '#cfe3bb', park: '#c2dcab', trees: '#b4d39f', plaza: '#ece5d5' }
const ROAD: Record<string, string> = { road: '#f6f6f2', path: '#f1e9d7', cycle: '#e4d9bf' }
const CANOPY = 0.9    // roof edge height above the top floor on the Campus Heart blocks, metres
const PARAPET = 0.5   // roof edge height above the top floor on the other blocks, metres

const inPoly = (x: number, z: number, poly: Vec2[]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

// Geometry collected per material: positions, normals and uvs of triangles.
class Bucket {
  pos: number[] = []; nor: number[] = []; uv: number[] = []
  // Upright quad over the plan edge a-b from height y0 to y1, facing out (the filled side of the outline is on the
  // left of a-b). u runs along the wall from s0 metres, v with the height; both divided by the tile size.
  wall(a: Vec2, b: Vec2, y0: number, y1: number, s0: number, w: number, h: number) {
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz)
    if (len < 0.02 || y1 <= y0) return
    const n = [dz / len, 0, dx / len]
    const A = [a[0], y0, -a[1]], B = [b[0], y0, -b[1]], C = [b[0], y1, -b[1]], D = [a[0], y1, -a[1]]
    const u0 = s0 / w, u1 = (s0 + len) / w, v0 = y0 / h, v1 = y1 / h
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]
    for (const i of [0, 1, 2, 0, 2, 3]) { this.pos.push(...[A, B, C, D][i]); this.nor.push(...n); this.uv.push(...uvs[i]) }
  }
  // Flat polygon (outline and holes) at height y, uv in metres divided by the tile size.
  flat(outline: Vec2[], holes: Vec2[][], y: number, w: number, h: number) {
    const contour = outline.map(([x, z]) => new THREE.Vector2(x, z)), hs = holes.map(r => r.map(([x, z]) => new THREE.Vector2(x, z)))
    let tris: number[][]
    try { tris = THREE.ShapeUtils.triangulateShape(contour, hs) } catch { return }
    const all = [...contour, ...hs.flat()]
    for (const t of tris) for (const k of t) { const p = all[k]; this.pos.push(p.x, y, -p.y); this.nor.push(0, 1, 0); this.uv.push(p.x / w, p.y / h) }
  }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    return g
  }
}

// Outer rings of a level and the holes (courtyards) inside each
function outlines(rings: Vec2[][]) {
  const holeOf = rings.map((r, i) => rings.findIndex((o, j) => j !== i && inPoly(r[0][0], r[0][1], o)))
  return rings.map((r, i) => ({ r, i })).filter(x => holeOf[x.i] < 0).map(({ r, i }) => ({ outer: r, holes: rings.filter((_, j) => holeOf[j] === i) }))
}

// Sky for lighting and reflections: blue overhead fading to a pale horizon and a warm ground.
function skyEnvironment(pmrem: THREE.PMREMGenerator) {
  const scene = new THREE.Scene()
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#5f9bd3') }, horizon: { value: new THREE.Color('#e9f1f6') }, ground: { value: new THREE.Color('#b9b8a6') } },
    vertexShader: 'varying vec3 d; void main() { d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 d; void main() { float h = d.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, ground, pow(-h, 0.4)); gl_FragColor = vec4(c, 1.0); }',
  })
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat)
  scene.add(sphere)
  const env = pmrem.fromScene(scene, 0.02).texture
  sphere.geometry.dispose(); mat.dispose()
  return env
}

export default function Campus3D({ building, mass, floor, view, width, height, visible, onReady, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const st = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera; outline: THREE.Group; draw: () => void } | null>(null)
  const latest = useRef({ floor, view, width, height, visible })
  latest.current = { floor, view, width, height, visible } // eslint-disable-line react-hooks/refs -- latest-value ref read by draw()
  const cb = useRef({ onReady, onFail })
  cb.current = { onReady, onFail } // eslint-disable-line react-hooks/refs -- latest callbacks

  // scene: built once per building
  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    // preserveDrawingBuffer keeps the last frame on the canvas, as the scene is drawn only on change
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }) } catch { cb.current.onFail(); return }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.85
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.shadowMap.autoUpdate = false // static scene: the shadow map is rendered once
    renderer.setClearColor(0x000000, 0)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const sky = skyEnvironment(pmrem)
    scene.environment = sky
    scene.environmentIntensity = 0.6
    const owned: { dispose: () => void }[] = [sky]
    const own = <T extends { dispose: () => void }>(x: T) => { owned.push(x); return x }

    const tex = campusTextures()
    const site = building.surroundings
    const bridgeColour = new Map<string, string>()
    for (const x of site?.bridges ?? []) { const bl = /^[^:]*:([A-Za-z]{1,2}\d{1,2})[-_]/.exec(x.room)?.[1]?.toUpperCase(); if (bl) bridgeColour.set(bl, x.colour) }

    // ---- materials ----
    const reflective: THREE.MeshStandardMaterial[] = []
    // double-sided: roofs and ground are triangulated without a fixed winding order
    const textured = (t: Tile) => { const m = own(new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.surface, metalnessMap: t.surface, roughness: 1, metalness: 1, side: THREE.DoubleSide })); reflective.push(m); return m }
    const plain = (colour: string, roughness = 0.85, metalness = 0) => own(new THREE.MeshStandardMaterial({ color: colour, roughness, metalness, side: THREE.DoubleSide }))
    const tiles = new Map<string, Tile>(Object.entries(tex))
    const mats = new Map<string, THREE.Material>()
    const matFor = (key: string): THREE.Material => {
      let m = mats.get(key)
      if (!m) {
        if (key.startsWith('plain:')) { const [, colour, r, mm] = key.split(':'); m = plain(colour, Number(r), Number(mm)) }
        else m = textured(tiles.get(key)!)
        mats.set(key, m)
      }
      return m
    }
    const buckets = new Map<string, Bucket>()
    const bucket = (key: string) => { let b = buckets.get(key); if (!b) { b = new Bucket(); buckets.set(key, b) } return b }
    const sizeOf = (key: string): [number, number] => { const t = tiles.get(key); return t ? [t.w, t.h] : [1, 1] }

    // ---- campus blocks and link bridges ----
    const box = new THREE.Box3()
    for (const m of mass) {
      const fc = facadeOf(m.name), isBridge = /^BR/i.test(m.name)
      let key = fc?.key ?? 'court'
      if (isBridge) { const c = bridgeColour.get(m.name.toUpperCase()) ?? '#c9ccc6'; key = `bridge:${c}`; if (!tiles.has(key)) tiles.set(key, bridgeTexture(c)) }
      m.levels.forEach((L, li) => {
        const top = li === m.levels.length - 1
        const y0 = L.elev, y1 = L.elev + L.h
        for (const r of L.rings) r.forEach((p, i) => {
          const q = r[(i + 1) % r.length], len = Math.hypot(q[0] - p[0], q[1] - p[1])
          if (len < 0.05) return
          const at = (s: number): Vec2 => [p[0] + ((q[0] - p[0]) * s) / len, p[1] + ((q[1] - p[1]) * s) / len]
          // wall pieces as [from, to, material], in metres along the wall
          let pieces: [number, number, string][] = [[0, len, key]]
          if (fc?.greenEnds && len >= 6 && len <= 32) pieces = [[0, len * 0.15, key], [len * 0.15, len * 0.85, 'green'], [len * 0.85, len, key]]
          else if (fc?.frame && len >= 6) { const w = Math.min(2.2, len * 0.12); pieces = [[0, w, `plain:${fc.frame}:0.5:0.2`], [w, len - w, key], [len - w, len, `plain:${fc.frame}:0.5:0.2`]] }
          else if (fc?.edgeStripe && len >= 4) pieces = [[0, len - 1.4, key], [len - 1.4, len - 0.6, `plain:${fc.edgeStripe}:0.6:0`], [len - 0.6, len, key]]
          for (const [s0, s1, k] of pieces) { const [w, h] = sizeOf(k); bucket(k).wall(at(s0), at(s1), y0, y1, s0, w, h) }
          // roof edge: CANOPY high on the Campus Heart blocks (white roof canopy), PARAPET high elsewhere
          if (top) bucket(`plain:${fc?.rim ?? '#d6d8d3'}:0.7:0`).wall(p, q, y1, y1 + (fc?.key === 'heart' || fc?.key === 'hub' ? CANOPY : PARAPET), 0, 1, 1)
          box.expandByPoint(new THREE.Vector3(p[0], y1, -p[1]))
        })
        for (const { outer, holes } of outlines(L.rings)) {
          if (top && !isBridge) bucket('pv').flat(outer, holes, y1 + 0.02, ...sizeOf('pv'))
          else bucket(`plain:${isBridge ? bridgeColour.get(m.name.toUpperCase()) ?? '#c9ccc6' : fc?.roof ?? '#eceeea'}:0.8:0`).flat(outer, holes, y1 + 0.02, 1, 1)
        }
      })
    }

    // ---- neighbouring buildings ----
    for (const nb of site?.buildings ?? []) {
      const h = Math.min(50, nb.levels * 3.6), ccw = nb.polygon.reduce((a, p, i) => { const q = nb.polygon[(i + 1) % nb.polygon.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0) > 0
      const ring = ccw ? nb.polygon : [...nb.polygon].reverse()
      ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]; bucket('office').wall(p, q, 0, h, 0, ...sizeOf('office')) })
      bucket('plain:#e4e7e2:0.85:0').flat(ring, [], h, 1, 1)
    }

    const group = new THREE.Group()
    for (const [key, b] of buckets) {
      const mesh = new THREE.Mesh(own(b.geometry()), matFor(key))
      mesh.castShadow = true; mesh.receiveShadow = true
      group.add(mesh)
    }
    scene.add(group)

    // ---- ground, areas, roads ----
    if (site) {
      const ground = new Bucket(), colours: number[] = [], water = new Bucket()
      const paint = (b: Bucket, colour: string, from: number) => { const c = new THREE.Color(colour); for (let i = from; i < b.pos.length / 3; i++) colours.push(c.r, c.g, c.b) }
      const [x0, z0, x1, z1] = site.bounds
      let n = 0
      const add = (poly: Vec2[], y: number, colour: string) => { ground.flat(poly, [], y, 1, 1); paint(ground, colour, n); n = ground.pos.length / 3 }
      add([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], -0.3, '#e2e6db')
      site.areas.forEach((a, i) => { if (a.kind === 'water') water.flat(a.polygon, [], -0.22, 1, 1); else add(a.polygon, -0.26 + i * 0.002, AREA[a.kind] ?? AREA.grass) })
      for (const r of site.roads) {
        const y = r.kind === 'road' ? -0.12 : -0.15, hw = r.width / 2, colour = ROAD[r.kind] ?? ROAD.path
        for (let i = 1; i < r.points.length; i++) {
          const a = r.points[i - 1], c = r.points[i], dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz)
          if (len < 0.05) continue
          const nx = (-dz / len) * hw, nz = (dx / len) * hw
          add([[a[0] + nx, a[1] + nz], [c[0] + nx, c[1] + nz], [c[0] - nx, c[1] - nz], [a[0] - nx, a[1] - nz]], y, colour)
          add(Array.from({ length: 8 }, (_, j) => [c[0] + Math.cos((j * Math.PI) / 4) * hw, c[1] + Math.sin((j * Math.PI) / 4) * hw] as Vec2), y, colour)
        }
      }
      const g = own(ground.geometry()); g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
      const gm = new THREE.Mesh(g, own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide })))
      gm.receiveShadow = true; scene.add(gm)
      const waterMat = own(new THREE.MeshStandardMaterial({ color: '#7fb2d0', roughness: 0.08, metalness: 0.35, side: THREE.DoubleSide }))
      reflective.push(waterMat)
      const wm = new THREE.Mesh(own(water.geometry()), waterMat); wm.receiveShadow = true; scene.add(wm)
      box.expandByPoint(new THREE.Vector3(x0, 0, -z0)).expandByPoint(new THREE.Vector3(x1, 0, -z1))

      // trees: trunk and crown
      const trees = treesOf(building)
      if (trees.length) {
        const crowns = new THREE.InstancedMesh(own(new THREE.IcosahedronGeometry(2.8, 1)), own(new THREE.MeshStandardMaterial({ color: '#5b9550', roughness: 0.9, flatShading: true })), trees.length)
        const trunks = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(0.25, 0.38, 3, 6)), own(new THREE.MeshStandardMaterial({ color: '#7d6047', roughness: 0.9 })), trees.length)
        const tm = new THREE.Matrix4()
        trees.forEach(([x, z], i) => { const s = 0.8 + ((i * 7919) % 100) / 250; crowns.setMatrixAt(i, tm.makeScale(s, s, s).setPosition(x, 4.2 * s, -z)); trunks.setMatrixAt(i, tm.makeTranslation(x, 1.5, -z)) })
        crowns.castShadow = trunks.castShadow = true
        scene.add(crowns, trunks)
      }
    }

    // ---- light: sky, sun with shadows over the whole campus ----
    scene.add(new THREE.HemisphereLight(0xeaf3ff, 0xbab3a0, 0.55))
    const centre = box.getCenter(new THREE.Vector3()), extent = box.getSize(new THREE.Vector3()).length() / 2
    const sun = new THREE.DirectionalLight(0xfff2de, 2.4)
    sun.position.copy(centre).add(new THREE.Vector3(0.55, 0.85, 0.4).normalize().multiplyScalar(extent * 1.5))
    sun.target.position.copy(centre)
    sun.castShadow = true
    sun.shadow.mapSize.set(4096, 4096)
    Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: extent * 4 })
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.4
    sun.shadow.camera.updateProjectionMatrix()
    scene.add(sun, sun.target)

    // ---- campus reflections: one capture from the middle of the campus, used by glass and water ----
    const cubeRT = own(new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }))
    const cubeCam = new THREE.CubeCamera(1, extent * 4, cubeRT)
    cubeCam.position.set(centre.x, 25, centre.z)
    renderer.shadowMap.needsUpdate = true
    cubeCam.update(renderer, scene)
    const campusEnv = own(pmrem.fromCubemap(cubeRT.texture).texture)
    for (const m of reflective) { m.envMap = campusEnv; m.envMapIntensity = 0.8; m.needsUpdate = true }
    pmrem.dispose()

    // ---- outline of the current floor ----
    const outline = new THREE.Group()
    scene.add(outline)

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20000)
    camera.matrixAutoUpdate = false
    const basis = new THREE.Matrix4(), r3 = new THREE.Vector3(), u3 = new THREE.Vector3(), b3 = new THREE.Vector3(), p3 = new THREE.Vector3()
    let shownFloor = -1, first = true, sizeW = 0, sizeH = 0
    const outlineMat = own(new THREE.LineBasicMaterial({ color: 0x0b7a6b }))
    const draw = () => {
      const { floor: fl, view: v, width: w, height: h, visible: vis } = latest.current
      if (!vis || w < 2 || h < 2) return
      if (fl !== shownFloor) {
        shownFloor = fl
        for (const c of outline.children) (c as THREE.LineSegments).geometry.dispose()
        outline.clear()
        const pts: number[] = []
        for (const m of mass) for (const L of m.levels) if (L.level === fl) for (const r of L.rings) r.forEach((p, i) => {
          const q = r[(i + 1) % r.length]
          for (const y of [L.elev + 0.05, L.elev + L.h - 0.05]) pts.push(p[0], y, -p[1], q[0], y, -q[1])
        })
        if (pts.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); outline.add(new THREE.LineSegments(g, outlineMat)) }
      }
      if (w !== sizeW || h !== sizeH) { sizeW = w; sizeH = h; renderer.setSize(w, h, false) }
      const t = (x: V3, out: THREE.Vector3) => out.set(x[0], x[1], -x[2])
      t(v.right, r3); t(v.up, u3); t(v.fwd, b3).negate()
      // camera position: the world point at the centre of the view, moved 5000 m back along the view direction
      p3.set(v.centre[0] + v.right[0] * v.at[0] - v.up[0] * v.at[1], v.centre[1] + v.right[1] * v.at[0] - v.up[1] * v.at[1], -(v.centre[2] + v.right[2] * v.at[0] - v.up[2] * v.at[1]))
      p3.addScaledVector(b3, 5000)
      camera.matrix.copy(basis.makeBasis(r3, u3, b3).setPosition(p3))
      camera.left = -v.vw / 2; camera.right = v.vw / 2; camera.top = v.vh / 2; camera.bottom = -v.vh / 2
      camera.near = 1; camera.far = 12000
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true)
      renderer.render(scene, camera)
      if (first) { first = false; cb.current.onReady() }
    }
    // drawing is scheduled with requestAnimationFrame: at most one frame per display refresh
    let raf = 0
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw() }) }
    st.current = { renderer, scene, camera, outline, draw: schedule }
    schedule()
    const redraw = () => { if (!document.hidden) { sizeW = 0; schedule() } } // redraw when the page becomes visible again
    document.addEventListener('visibilitychange', redraw)

    return () => {
      document.removeEventListener('visibilitychange', redraw)
      cancelAnimationFrame(raf)
      st.current = null
      for (const c of outline.children) (c as THREE.LineSegments).geometry.dispose()
      for (const x of owned) x.dispose()
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
    }
  }, [building, mass])

  // redraw after every render: the camera, size, floor or visibility may have changed
  useEffect(() => { st.current?.draw() })

  return <div className="campus3d" ref={host} style={{ visibility: visible ? 'visible' : 'hidden' }} />
}
