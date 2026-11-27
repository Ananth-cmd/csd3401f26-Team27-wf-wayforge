import * as THREE from 'three'
import type { MassBlock } from '../massing'
import type { Site, Vec2 } from '../types'

// Surface colours are already supplied by the ground mesh's vertex colours.
// These grayscale patterns only modulate brightness; they never repaint a road
// or change the existing green/beige/grey colour scheme.
type Surface = 'grass' | 'asphalt' | 'concrete' | 'path'
const SURFACES: Record<Surface, { base: number; broad: number; grain: number; metres: number; seed: number }> = {
  grass:    { base: 247, broad: 22, grain: 7, metres: 10, seed: 11 },
  asphalt:  { base: 250, broad: 9, grain: 12, metres: 7, seed: 23 },
  concrete: { base: 252, broad: 6, grain: 5, metres: 9, seed: 37 },
  path:     { base: 250, broad: 8, grain: 8, metres: 5, seed: 47 },
}

// A deterministic, periodic hash. Identical data gives identical textures.
function hash(x: number, y: number, seed: number) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function noise(x: number, y: number, cells: number, seed: number) {
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = hash(ix % cells, iy % cells, seed)
  const b = hash((ix + 1) % cells, iy % cells, seed)
  const c = hash(ix % cells, (iy + 1) % cells, seed)
  const d = hash((ix + 1) % cells, (iy + 1) % cells, seed)
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v
}

function makeSurfacePattern(ctx: CanvasRenderingContext2D, kind: Surface, scale: number) {
  const spec = SURFACES[kind]
  const size = 256
  const tile = document.createElement('canvas')
  tile.width = tile.height = size
  const t = tile.getContext('2d')
  if (!t) return '#ffffff'
  const img = t.createImageData(size, size)
  const cells = Math.max(2, Math.min(64, Math.round(size / (scale * spec.metres))))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = noise(x * cells / size, y * cells / size, cells, spec.seed)
    const medium = noise(x * cells * 3 / size, y * cells * 3 / size, cells * 3, spec.seed + 1)
    const grain = hash(x, y, spec.seed + 2)
    const value = Math.max(0, Math.min(255, Math.round(spec.base +
      (broad - 0.5) * spec.broad + (medium - 0.5) * spec.broad * 0.45 +
      (grain - 0.5) * spec.grain)))
    const i = 4 * (y * size + x)
    img.data[i] = img.data[i + 1] = img.data[i + 2] = value
    img.data[i + 3] = 255
  }
  t.putImageData(img, 0, 0)
  return ctx.createPattern(tile, 'repeat') ?? '#ffffff'
}

// Paint the same footprints and road strips as Campus3D's ground bucket.
// This is a brightness atlas, not an extra layer of terrain geometry.
function paintSurfaceMap(ctx: CanvasRenderingContext2D, site: Site, sx: number, sz: number, scale: number) {
  const [x0, z0] = site.bounds
  const patterns = new Map<Surface, CanvasPattern | string>()
  const pattern = (kind: Surface) => {
    let p = patterns.get(kind)
    if (!p) { p = makeSurfacePattern(ctx, kind, scale); patterns.set(kind, p) }
    return p
  }
  const polygon = (ring: Vec2[], kind: Surface) => {
    if (ring.length < 3 || !ring.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z))) return
    ctx.beginPath()
    ring.forEach(([x, z], i) => {
      const px = (x - x0) * sx, py = (z - z0) * sz
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.closePath()
    ctx.fillStyle = pattern(kind)
    ctx.fill()
  }
  ctx.fillStyle = pattern('concrete')
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  // Match the original ground heights so overlaps follow the same ordering.
  const layers: { y: number; draw: () => void }[] = []
  site.areas.forEach((a, i) => {
    if (a.kind === 'water') return // water has a separate material
    const kind: Surface = a.kind === 'plaza' ? 'concrete' : 'grass'
    layers.push({ y: -0.26 + i * 0.002, draw: () => polygon(a.polygon, kind) })
  })
  for (const r of site.roads) {
    if (!Number.isFinite(r.width) || r.width <= 0) continue
    const y = r.kind === 'road' ? -0.12 : -0.15
    const kind: Surface = r.kind === 'road' ? 'asphalt' : 'path'
    layers.push({ y, draw: () => {
      const hw = r.width / 2
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1], b = r.points[i]
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz)
        if (!Number.isFinite(len) || len < 0.05) continue
        const nx = -dz / len * hw, nz = dx / len * hw
        polygon([[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz],
          [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]], kind)
        // The original renderer uses eight-sided round joins at segment ends.
        polygon(Array.from({ length: 8 }, (_, j) => [
          b[0] + Math.cos(j * Math.PI / 4) * hw,
          b[1] + Math.sin(j * Math.PI / 4) * hw,
        ] as Vec2), kind)
      }
    } })
  }
  layers.sort((a, b) => a.y - b.y)
  for (const layer of layers) layer.draw()
}

/**
 * Bake a subtle ambient-contact shading texture from ground-level footprints.
 * Also bake subtle procedural ground-surface textures into the same map.
 * This is an artistic approximation of AO, not a ray-traced lighting solution.
 * The ground mesh's existing UVs are world coordinates [x, z] in metres.
 * No routing geometry or map labels are modified.
 */
export function createGroundContactMap(site: Site, mass: MassBlock[]): THREE.CanvasTexture | null {
  const [x0, z0, x1, z1] = site.bounds
  const width = x1 - x0, height = z1 - z0
  if (![x0, z0, x1, z1, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null

  // Use a proportional canvas so the blur has the same scale along both axes.
  const scale = Math.min(2048 / Math.max(width, height), 5)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const sx = canvas.width / width, sz = canvas.height / height

  const mask = document.createElement('canvas')
  mask.width = canvas.width
  mask.height = canvas.height
  const m = mask.getContext('2d')
  if (!m) return null
  const path = (rings: Vec2[][]) => {
    m.beginPath()
    let valid = false
    for (const ring of rings) {
      if (ring.length < 3 || !ring.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue
      ring.forEach(([x, z], i) => {
        const px = (x - x0) * sx, py = (z - z0) * sz
        if (i === 0) m.moveTo(px, py)
        else m.lineTo(px, py)
      })
      m.closePath()
      valid = true
    }
    if (valid) m.fill('evenodd')
  }
  m.fillStyle = '#000000'
  for (const block of mass) {
    if (/^BR/i.test(block.name)) continue
    // Skip elevated masses and underground-only levels.
    const ground = block.levels.filter(l => l.elev <= 0.5 && l.elev + l.h > 0)
      .sort((a, b) => Math.abs(a.elev) - Math.abs(b.elev))[0]
    if (ground) path(ground.rings)
  }
  for (const b of site.buildings ?? []) path([b.polygon])

  // Paint the surface atlas first, then composite the existing contact mask.
  paintSurfaceMap(ctx, site, sx, sz, scale)
  // Composite two soft scales once; no additional GPU texture is needed.
  ctx.globalAlpha = 0.22
  ctx.filter = `blur(${Math.max(0.5, 2.8 * scale)}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.globalAlpha = 0.25
  ctx.filter = `blur(${Math.max(0.5, 0.9 * scale)}px)`
  ctx.drawImage(mask, 0, 0)
  ctx.filter = 'none'
  ctx.globalAlpha = 1

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  // Canvas top corresponds to z0; the ground UV is [world x, world z].
  texture.flipY = false
  texture.repeat.set(1 / width, 1 / height)
  texture.offset.set(-x0 / width, -z0 / height)
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
