/*!
 * \file eastDetails.ts
 * \brief Physical facade frames for E1 and bronze fins for E3.
 * Extends the existing metre-based facade textures without changing floor
 * plans, routes or map labels. Dimensions are visual estimates.
 * AI declaration: ChatGPT assisted with implementation and comments.
 */
import * as THREE from 'three'
import type { MassBlock } from '../massing'

type Own = <T extends { dispose: () => void }>(resource: T) => T
export type EastPart = {
  block: string
  position: [number, number, number]
  size: [number, number, number]
  yaw: number
  colour: string
}

const EMBED = 0.025
const MARGIN = 0.05

// Generate all the decorative pieces using the existing exterior wall edges.
export function eastDetailPlacements(mass: MassBlock[]): EastPart[] {
  const parts: EastPart[] = []
  for (const block of mass) {
    const name = block.name.toUpperCase()
    if (name !== 'E1' && name !== 'E3') continue
    for (const level of block.levels) {
      const low = level.elev, high = low + level.h
      if (!Number.isFinite(low) || !Number.isFinite(high) || high - low <= 2 * MARGIN) continue
      for (const ring of level.rings) {
        if (ring.length < 3 || ring.some(p => !p.every(Number.isFinite))) continue
        // Massing traces the filled side to the left. Skip courtyard holes.
        const area2 = ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length]
          return sum + p[0] * q[1] - q[0] * p[1]
        }, 0)
        if (area2 <= 0) continue
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length]
          const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz)
          if (len < 3) continue
          const ux = dx / len, uz = dz / len
          const nx = uz, nz = -ux
          const yaw = Math.atan2(uz, ux)
          // Local box X follows the edge; local Z faces away from the wall.
          // The existing map converts plan north to negative Three.js Z.
          const add = (x: number, y: number, w: number, h: number, depth: number, colour: string) => {
            if (w <= 0 || h <= 0 || x < MARGIN - 1e-8 || x + w > len - MARGIN + 1e-8) return
            const s = x + w / 2, d = depth / 2 - EMBED
            parts.push({ block: block.name, yaw, colour,
              position: [a[0] + ux * s + nx * d, y + h / 2, -(a[1] + uz * s + nz * d)],
              size: [w, h, depth] })
          }
          const y = low + MARGIN, h = high - low - 2 * MARGIN
          if (name === 'E1') {
            // Match the white end frames in Campus3D.tsx; the glass tile
            // starts at the origin of the entire edge, not the glass span.
            const frame = len >= 6 ? Math.min(2.2, len * 0.12) : 0
            const start = frame + MARGIN, end = len - frame - MARGIN
            if (frame > 0) {
              add(MARGIN, y, frame - MARGIN, h, 0.40, '#f1f3f4')
              add(len - frame, y, frame - MARGIN, h, 0.40, '#f1f3f4')
            }
            // One physical mullion per 1.5 m curtain-wall texture repeat.
            // Wider accent mullions every four panels help at campus scale.
            for (let s = 1.5; s < end; s += 1.5) {
              const major = Math.round(s / 1.5) % 4 === 0
              const w = major ? 0.22 : 0.10
              if (s - w / 2 < start || s + w / 2 > end) continue
              add(s - w / 2, y, w, h, major ? 0.28 : 0.13, '#d9e4ec')
            }
            // Raised pale floor edge ties the vertical frames together.
            const bandH = Math.min(0.30, h / 3)
            if (end > start) add(start, high - MARGIN - bandH, end - start, bandH, 0.32, '#f1f3f4')
          } else {
            // The auditorium texture repeats every 6 m, with bronze fins
            // at x=0.2, 0.8, ... and a light slit at 2.87..3.13 m.
            // Keep the existing red edge stripe and the light slit clear.
            const spans = len >= 4 ? [[MARGIN, len - 1.4], [len - 0.6, len - MARGIN]] : [[MARGIN, len - MARGIN]]
            for (let tile = 0; tile * 6 < len; tile++) {
              for (let j = 0; j < 10; j++) {
                const local = 0.2 + j * 0.6, w = 0.20
                if (local < 3.13 && local + w > 2.87) continue
                const s = tile * 6 + local
                if (!spans.some(([a0, b0]) => s >= a0 && s + w <= b0)) continue
                add(s, y, w, h, 0.42, '#715843')
              }
            }
          }
        }
      }
    }
  }
  return parts
}

export function addEastBuildingDetails(
  scene: THREE.Scene,
  mass: MassBlock[],
  blockColours: Record<string, string> | undefined,
  own: Own,
) {
  const parts = eastDetailPlacements(mass)
  if (!parts.length) return
  // All pieces share one unit cube and material, with per-instance colours.
  const geometry = own(new THREE.BoxGeometry(1, 1, 1))
  const material = own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.78 }))
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
  mesh.name = 'Campus landmarks - E1 frames and E3 fins'
  scene.add(mesh)
}
