/*!
 * \file heartDetails.ts
 * \brief Raised window hoods for the W3, W5 and W6 campus blocks.
 * Uses the existing heart texture's metre-based window layout, and avoids
 * the green wall sections. Geometry is decorative, not navigation data.
 * Hood projection depths are visual estimates, not surveyed measurements.
 * AI declaration: ChatGPT assisted with implementation and comments.
 */
import * as THREE from 'three'
import type { MassBlock } from '../massing'
import { FLOOR } from '../campusTextures'

type Own = <T extends { dispose: () => void }>(resource: T) => T
export type HoodPart = {
  block: string
  position: [number, number, number]
  size: [number, number, number]
  yaw: number
  colour: string
}

const BLOCKS = new Set(['W3', 'W5', 'W6'])
const TILE_WIDTH = 6
const TILE_HEIGHT = 2 * FLOOR
const EMBED = 0.025
const MARGIN = 0.06
// Same staggered window coordinates as the heart tile in campusTextures.ts.
const WINDOWS = [[0.4, 1], [3.4, 1], [1.9, FLOOR + 1], [4.4, FLOOR + 1]]

export function heartHoodPlacements(mass: MassBlock[]): HoodPart[] {
  const parts: HoodPart[] = []
  for (const block of mass) {
    if (!BLOCKS.has(block.name.toUpperCase())) continue
    for (const level of block.levels) {
      const low = level.elev, high = low + level.h
      if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) continue
      for (const ring of level.rings) {
        if (ring.length < 3 || ring.some(p => !p.every(Number.isFinite))) continue
        // The massing generator traces filled regions on the left; skip courtyard holes.
        const area2 = ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length]
          return sum + p[0] * q[1] - q[0] * p[1]
        }, 0)
        if (area2 <= 0) continue
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length]
          const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz)
          if (len < 2.2) continue
          const ux = dx / len, uz = dz / len
          const nx = uz, nz = -ux
          const yaw = Math.atan2(uz, ux)
          // Match Campus3D's greenEnds rule exactly. The UV origin remains
          // the start of the whole edge even for the smaller wall sections.
          const spans = len >= 6 && len <= 32
            ? [[0, len * 0.15], [len * 0.85, len]] : [[0, len]]
          const add = (x: number, y: number, w: number, h: number, depth: number, colour: string) => {
            const s = x + w / 2, offset = depth / 2 - EMBED
            parts.push({ block: block.name, yaw, colour,
              position: [a[0] + ux * s + nx * offset, y + h / 2, -(a[1] + uz * s + nz * offset)],
              size: [w, h, depth] })
          }
          for (let v = Math.floor(low / TILE_HEIGHT); v * TILE_HEIGHT < high; v++) {
            for (let u = 0; u * TILE_WIDTH < len; u++) {
              for (const [wx, wy] of WINDOWS) {
                const x = u * TILE_WIDTH + wx, y = v * TILE_HEIGHT + wy
                // Skip partial hoods at floor boundaries or green walls instead
                // of allowing the trim to float beyond the building surface.
                if (y - 0.15 < low + MARGIN || y + 2.58 > high - MARGIN) continue
                if (!spans.some(([lo, hi]) => x - 0.28 >= lo + MARGIN && x + 1.74 <= hi - MARGIN)) continue
                // Top and both side pieces match the painted hood dimensions.
                // The right side projects further, as in the existing texture.
                add(x - 0.28, y + 2.10, 2.0, 0.48, 0.70, '#d2412c')
                add(x - 0.28, y - 0.15, 0.14, 2.25, 0.30, '#b8382a')
                add(x + 1.40, y - 0.15, 0.34, 2.25, 0.70, '#a9311f')
              }
            }
          }
        }
      }
    }
  }
  return parts
}

export function addHeartBuildingDetails(
  scene: THREE.Scene,
  mass: MassBlock[],
  blockColours: Record<string, string> | undefined,
  own: Own,
) {
  const parts = heartHoodPlacements(mass)
  if (!parts.length) return
  const geometry = own(new THREE.BoxGeometry(1, 1, 1))
  const material = own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.82 }))
  const mesh = own(new THREE.InstancedMesh(geometry, material, parts.length))
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion()
  const axis = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scale = new THREE.Vector3()
  const colour = new THREE.Color(), tintColour = new THREE.Color()
  parts.forEach((part, i) => {
    pos.set(...part.position); scale.set(...part.size)
    rotation.setFromAxisAngle(axis, part.yaw)
    matrix.compose(pos, rotation, scale)
    mesh.setMatrixAt(i, matrix)
    colour.set(part.colour)
    const tint = blockColours?.[part.block]
    if (tint) colour.multiply(tintColour.set(tint))
    mesh.setColorAt(i, colour)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = 'Campus landmarks - W3 W5 W6 raised window hoods'
  scene.add(mesh)
}
