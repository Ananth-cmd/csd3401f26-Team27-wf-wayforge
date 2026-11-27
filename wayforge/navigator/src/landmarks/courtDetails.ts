/*!
 * \file courtDetails.ts
 * \brief Decorative planter ledges and vegetation for E2, E5 and E6.
 * Uses existing massing edges and the court texture's metre-based layout.
 * Does not modify floor plans, navigation, or map labels.
 * Dimensions are visual estimates, not measured campus geometry.
 * AI declaration: ChatGPT assisted with implementation and comments.
 */
import * as THREE from 'three'
import type { MassBlock } from '../massing'
import { FLOOR } from '../campusTextures'

type Own = <T extends { dispose: () => void }>(resource: T) => T
export type CourtPart = {
  block: string
  kind: 'ledge' | 'plant'
  position: [number, number, number]
  size: [number, number, number]
  yaw: number
  colour: string
}

const BLOCKS = new Set(['E2', 'E5', 'E6'])
const TILE = 9
const MARGIN = 0.10
// Two planted sections per repeat, matching the existing court texture.
const PLANTERS = [
  { start: 0.12, end: 3.38, plants: [0.6, 1.3, 2, 2.9] },
  { start: 4.92, end: 8.08, plants: [5.4, 6.1, 6.9, 7.6] },
]
const GREENS = ['#4f783c', '#65944b', '#3d6837', '#789f54']

// Pure placement calculation: plan coordinates [x,z] become world [x,y,-z].
export function courtDetailPlacements(mass: MassBlock[]): CourtPart[] {
  const parts: CourtPart[] = []
  for (const block of mass) {
    if (!BLOCKS.has(block.name.toUpperCase())) continue
    for (const level of block.levels) {
      const low = level.elev, high = low + level.h
      if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) continue
      for (const ring of level.rings) {
        if (ring.length < 3 || ring.some(p => !p.every(Number.isFinite))) continue
        const area2 = ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length]
          return sum + p[0] * q[1] - q[0] * p[1]
        }, 0)
        // Positive winding is the exterior. Skip courtyard holes.
        if (area2 <= 0) continue
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length]
          const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz)
          if (len < 3) continue
          const ux = dx / len, uz = dz / len, nx = uz, nz = -ux
          const yaw = Math.atan2(uz, ux)
          const add = (kind: CourtPart['kind'], s: number, y: number, w: number, h: number, d: number, offset: number, colour: string) => {
            parts.push({ block: block.name, kind, yaw, colour, size: [w, h, d],
              position: [a[0] + ux * s + nx * offset, y, -(a[1] + uz * s + nz * offset)] })
          }
          // Match the texture's absolute height phase, not a local floor index.
          // Skip ground-level planting so we do not add obstacles at entrances.
          for (let v = Math.floor(low / FLOOR); v * FLOOR < high; v++) {
            const y = v * FLOOR
            if (y < FLOOR - 0.01 || y + 0.36 < low + MARGIN || y + 1.45 > high - MARGIN) continue
            for (let u = 0; u * TILE < len; u++) {
              for (const planter of PLANTERS) {
                const start = u * TILE + planter.start, end = u * TILE + planter.end
                // Skip partial ledges at corners instead of protruding past the wall.
                if (start < MARGIN || end > len - MARGIN) continue
                add('ledge', (start + end) / 2, y + 0.52, end - start, 0.32, 0.95, 0.45, '#e5e5df')
                planter.plants.forEach((p, j) => {
                  const s = u * TILE + p
                  const seed = (i * 7 + u * 3 + v * 5 + j) % GREENS.length
                  const h = 0.58 + seed * 0.075
                  // The plant mesh has unit diameter, so size is the desired width, height and depth.
                  add('plant', s, y + 0.68 + h / 2 - 0.07, 0.80, h, 0.76, 0.48, GREENS[(seed + GREENS.length) % GREENS.length])
                })
              }
            }
          }
        }
      }
    }
  }
  return parts
}

export function addCourtBuildingDetails(
  scene: THREE.Scene,
  mass: MassBlock[],
  blockColours: Record<string, string> | undefined,
  own: Own,
) {
  const parts = courtDetailPlacements(mass)
  for (const kind of ['ledge', 'plant'] as const) {
    const batch = parts.filter(p => p.kind === kind)
    if (!batch.length) continue
    const geometry = own(kind === 'ledge' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.IcosahedronGeometry(0.5, 1))
    const material = own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, flatShading: kind === 'plant' }))
    const mesh = own(new THREE.InstancedMesh(geometry, material, batch.length))
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion()
    const axis = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scale = new THREE.Vector3()
    const colour = new THREE.Color(), tintColour = new THREE.Color()
    batch.forEach((part, i) => {
      pos.set(...part.position); scale.set(...part.size)
      rotation.setFromAxisAngle(axis, part.yaw)
      matrix.compose(pos, rotation, scale)
      mesh.setMatrixAt(i, matrix)
      colour.set(part.colour)
      // Studio block colours tint architectural pieces, not living plants.
      const tint = blockColours?.[part.block]
      if (kind === 'ledge' && tint) colour.multiply(tintColour.set(tint))
      mesh.setColorAt(i, colour)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = `Campus landmarks - E2 E5 E6 ${kind}s`
    scene.add(mesh)
  }
}
