/*!
 * \file waterDetails.ts
 * \brief Static reservoir ripple normals for the campus view.
 * Reuses the original water mesh, world-metre UVs and reflection capture.
 * AI declaration: ChatGPT assisted with implementation and synthetic tests.
 */
import * as THREE from 'three'

type Own = <T extends { dispose: () => void }>(resource: T) => T
const SIZE = 128
const TILE_METRES = 12

// Integer wave frequencies make the tile periodic in both directions.
// Each wave contains [u frequency, v frequency, slope amplitude, phase].
const WAVES: ReadonlyArray<readonly [number, number, number, number]> = [
  [3, 1, 0.14, 0.2], [5, -2, 0.09, 1.7], [2, 4, 0.07, 3.1],
  [9, 4, 0.045, 0.8], [4, -7, 0.035, 2.4],
]

// Generate tangent-space normals from the slopes of a periodic wave field.
export function ripplePixels(): Uint8Array {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const u = (x + 0.5) / SIZE, v = (y + 0.5) / SIZE
    let du = 0, dv = 0
    for (const [ku, kv, amplitude, phase] of WAVES) {
      const slope = amplitude * Math.cos(2 * Math.PI * (ku * u + kv * v) + phase)
      const length = Math.hypot(ku, kv)
      du += slope * ku / length
      dv += slope * kv / length
    }
    const inv = 1 / Math.hypot(du, dv, 1)
    const i = (y * SIZE + x) * 4
    pixels[i] = Math.round((-du * inv * 0.5 + 0.5) * 255)
    pixels[i + 1] = Math.round((-dv * inv * 0.5 + 0.5) * 255)
    pixels[i + 2] = Math.round((inv * 0.5 + 0.5) * 255)
    pixels[i + 3] = 255
  }
  return pixels
}

export function createReservoirMaterial(own: Own): THREE.MeshStandardMaterial {
  const normal = own(new THREE.DataTexture(ripplePixels(), SIZE, SIZE, THREE.RGBAFormat))
  normal.name = 'Reservoir ripple normals'
  normal.colorSpace = THREE.NoColorSpace // normals are data, not sRGB colours
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping
  // Bucket.flat uses metres directly as the UVs for the water mesh.
  normal.repeat.set(1 / TILE_METRES, 1 / TILE_METRES)
  normal.generateMipmaps = true
  normal.minFilter = THREE.LinearMipmapLinearFilter
  normal.magFilter = THREE.LinearFilter
  normal.anisotropy = 4
  normal.needsUpdate = true
  const material = own(new THREE.MeshStandardMaterial({
    color: '#739eae',
    roughness: 0.22,
    metalness: 0.12,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.8, 0.8),
    side: THREE.DoubleSide,
  }))
  material.name = 'Wayforge reservoir'
  return material
}
