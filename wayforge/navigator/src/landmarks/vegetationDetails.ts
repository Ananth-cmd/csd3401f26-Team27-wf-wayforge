/*!
 * \file vegetationDetails.ts
 * \brief Varied procedural tree models for the campus exterior renderer.
 * Retains the existing tree positions from surroundings.ts. These models
 * are illustrative, not a survey of actual species or tree dimensions.
 * AI declaration: ChatGPT assisted with implementation and comments.
 */
import * as THREE from 'three'
import type { Vec2 } from '../types'

type Own = <T extends { dispose: () => void }>(resource: T) => T
type Part = { position: [number, number, number]; size: [number, number, number]; yaw: number; colour: string }
const GREENS = ['#4c793e', '#608e48', '#719b52', '#527e4b', '#83a75c']
const BARK = ['#80664d', '#715c48', '#92765b']
const GROUND = -0.24

// Stable pseudo-random variation based on plan coordinates, not frame time.
function sample(x: number, z: number, salt: number) {
  const n = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453
  return n - Math.floor(n)
}

export function vegetationPlacements(trees: readonly Vec2[]) {
  const trunks: Part[] = [], crowns: Part[] = []
  for (const [x, z] of trees) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue
    const r = (salt: number) => sample(x, z, salt)
    const style = Math.min(2, Math.floor(r(0) * 3))
    const height = 2.6 + 1.6 * r(1)
    const girth = 0.38 + 0.28 * r(2)
    const yaw = r(3) * Math.PI * 2
    const green = Math.floor(r(4) * GREENS.length)
    trunks.push({ position: [x, GROUND + height / 2, -z], size: [girth, height, girth], yaw, colour: BARK[Math.floor(r(5) * BARK.length)] })
    const add = (offset: number, angle: number, y: number, w: number, h: number, d: number, salt: number) => {
      crowns.push({ position: [x + Math.cos(angle) * offset, y, -z + Math.sin(angle) * offset], size: [w, h, d], yaw: angle, colour: GREENS[(green + salt) % GREENS.length] })
    }
    const top = GROUND + height
    const s = 0.82 + r(6) * 0.18
    if (style === 0) {
      // Broad spreading crown, three overlapping lobes.
      add(0, yaw, top + 0.8, 5.0 * s, 3.1 * s, 4.6 * s, 0)
      add(1.25, yaw, top + 0.55, 3.3 * s, 2.5 * s, 3.3 * s, 1)
      add(1.15, yaw + Math.PI, top + 1.15, 3.1 * s, 2.8 * s, 3.1 * s, 2)
    } else if (style === 1) {
      // Upright oval canopy with a smaller upper crown.
      add(0, yaw, top + 1.0, 3.7 * s, 4.5 * s, 3.5 * s, 0)
      add(0.45, yaw + 1, top + 2.2, 2.5 * s, 2.9 * s, 2.5 * s, 2)
    } else {
      // Compact rounded canopy with a slight asymmetry.
      add(0, yaw, top + 0.9, 4.8 * s, 3.8 * s, 4.5 * s, 0)
      add(0.85, yaw, top + 1.5, 3.1 * s, 2.8 * s, 3.2 * s, 1)
    }
  }
  return { trunks, crowns }
}

// Two instanced batches replace the original trunk and crown batches.
export function addVegetationDetails(scene: THREE.Scene, trees: readonly Vec2[], own: Own) {
  const { trunks, crowns } = vegetationPlacements(trees)
  for (const kind of ['trunks', 'crowns'] as const) {
    const parts = kind === 'trunks' ? trunks : crowns
    if (!parts.length) continue
    const geometry = own(kind === 'trunks'
      ? new THREE.CylinderGeometry(0.36, 0.5, 1, 7)
      : new THREE.IcosahedronGeometry(0.5, 1))
    const material = own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, flatShading: kind === 'crowns' }))
    const mesh = own(new THREE.InstancedMesh(geometry, material, parts.length))
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion()
    const axis = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scale = new THREE.Vector3(), colour = new THREE.Color()
    parts.forEach((part, i) => {
      pos.set(...part.position); scale.set(...part.size)
      rotation.setFromAxisAngle(axis, part.yaw)
      matrix.compose(pos, rotation, scale)
      mesh.setMatrixAt(i, matrix)
      mesh.setColorAt(i, colour.set(part.colour))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.name = `Campus landmarks - vegetation ${kind}`
    scene.add(mesh)
  }
}
