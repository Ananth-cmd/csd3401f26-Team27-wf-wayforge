/*!
 * \file renderPolish.ts
 * \brief Subtle procedural facade grain and fitted static sun shadow bounds.
 * AI declaration: ChatGPT assisted with implementation and synthetic checks.
 */
import * as THREE from 'three'

// Deterministic periodic noise, so repeated facade tiles remain seamless.
function noise(x: number, y: number, seed: number): number {
  let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function periodicNoise(u: number, v: number, nx: number, ny: number): number {
  const x = u * nx, y = v * ny
  const ix = Math.floor(x), iy = Math.floor(y)
  const fx = x - ix, fy = y - iy
  const a = fx * fx * (3 - 2 * fx), b = fy * fy * (3 - 2 * fy)
  const at = (dx: number, dy: number) => noise((ix + dx) % nx, (iy + dy) % ny, 19371)
  return (at(0, 0) * (1 - a) + at(1, 0) * a) * (1 - b)
    + (at(0, 1) * (1 - a) + at(1, 1) * a) * b
}

// Modify only rough, non-metallic pixels. Glass and metal keep their existing
// colour and surface values. No new textures or changes to geometry/UVs.
export function applyFacadeGrain(colour: CanvasRenderingContext2D, surface: CanvasRenderingContext2D): void {
  const w = colour.canvas.width, h = colour.canvas.height
  if (!w || !h || surface.canvas.width !== w || surface.canvas.height !== h) return
  const image = colour.getImageData(0, 0, w, h)
  const finish = surface.getImageData(0, 0, w, h).data
  const nx = Math.max(1, Math.round(w / 30)), ny = Math.max(1, Math.round(h / 30))
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    if (finish[i + 1] < 180 || finish[i + 2] > 25) continue
    const broad = periodicNoise((x + 0.5) / w, (y + 0.5) / h, nx, ny) - 0.5
    const fine = noise(x, y, 9157) - 0.5
    const factor = 1 + 0.065 * broad + 0.035 * fine
    for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(image.data[i + c] * factor)
  }
  colour.putImageData(image, 0, 0)
}

// Tighten the directional shadow camera around the actual scene bounding box.
// Call after all static meshes have been added, before the first shadow capture.
// Keep the existing camera settings if the bounds are invalid or behind the sun.
export function fitCampusShadow(sun: THREE.DirectionalLight, scene: THREE.Scene, padding = 12): boolean {
  scene.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(scene)
  if (bounds.isEmpty()) return false
  const camera = sun.shadow.camera
  sun.updateWorldMatrix(true, false)
  sun.target.updateWorldMatrix(true, false)
  const position = sun.getWorldPosition(new THREE.Vector3())
  const target = sun.target.getWorldPosition(new THREE.Vector3())
  if (position.distanceToSquared(target) < 1e-8) return false
  // Use a temporary camera so a failed fit leaves the existing one unchanged.
  const probe = new THREE.OrthographicCamera()
  probe.up.copy(camera.up)
  probe.position.copy(position)
  probe.lookAt(target)
  probe.updateMatrixWorld(true)
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity
  let near = Infinity, far = -Infinity
  const p = new THREE.Vector3()
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        p.set(x, y, z).applyMatrix4(probe.matrixWorldInverse)
        left = Math.min(left, p.x); right = Math.max(right, p.x)
        bottom = Math.min(bottom, p.y); top = Math.max(top, p.y)
        near = Math.min(near, -p.z); far = Math.max(far, -p.z)
      }
  if (![left, right, bottom, top, near, far, padding].every(Number.isFinite) || near <= 1 || padding < 0) return false
  Object.assign(camera, {
    left: left - padding, right: right + padding,
    bottom: bottom - padding, top: top + padding,
    near: Math.max(0.5, near - padding), far: far + padding,
  })
  camera.updateProjectionMatrix()
  return true
}
