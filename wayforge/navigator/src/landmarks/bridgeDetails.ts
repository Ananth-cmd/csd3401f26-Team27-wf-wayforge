/*!
 * \file bridgeDetails.ts
 * \brief Raised exterior framing for the campus link bridges.
 *
 * Adds visual detail using existing bridge outlines and colours. This does
 * not change the floor plan, navigation graph or walkable space. Frame sizes
 * are visual estimates, not surveyed structural dimensions.
 * AI declaration: ChatGPT assisted with the implementation and comments.
 */
import * as THREE from 'three'
import type { MassBlock } from '../massing'
import type { Vec2 } from '../types'
import { FLOOR } from '../campusTextures'

type Own = <T extends { dispose: () => void }>(resource: T) => T
export type BridgeFrame = {
  block: string
  kind: 'post' | 'rail' | 'roof'
  position: [number, number, number]
  size: [number, number, number]
  yaw: number
}

const MIN_EDGE = 3
const END_MARGIN = 0.55
const POST_SPACING = 2.5
const POST_WIDTH = 0.17
const POST_DEPTH = 0.14
const RAIL_HEIGHT = 0.19
const RAIL_DEPTH = 0.24
const ROOF_HEIGHT = 0.22
const ROOF_DEPTH = 0.38
const EMBED = 0.025

function cleanRing(raw: Vec2[]): Vec2[] {
  const ring: Vec2[] = []
  for (const p of raw) {
    if (!p.every(Number.isFinite)) return []
    const last = ring[ring.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.001) ring.push(p)
  }
  if (ring.length > 1 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) <= 0.001) ring.pop()
  return ring
}

// Calculate the frame placements without needing WebGL.
export function bridgeFramePlacements(mass: MassBlock[]): BridgeFrame[] {
  const frames: BridgeFrame[] = []
  for (const block of mass) {
    if (!/^BR/i.test(block.name)) continue
    const levels = [...block.levels].sort((a, b) => a.elev - b.elev)
    for (const [li, level] of levels.entries()) {
      const low = level.elev, high = low + level.h
      if (!Number.isFinite(low) || !Number.isFinite(high) || level.h < 0.5) continue
      for (const raw of level.rings) {
        const ring = cleanRing(raw)
        // The massing generator keeps the filled side on the left.
        // Only decorate outer rings, not internal courtyard boundaries.
        const area = ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length]
          return sum + p[0] * q[1] - q[0] * p[1]
        }, 0)
        if (ring.length < 3 || area <= 0) continue
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b = ring[(i + 1) % ring.length]
          const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz)
          if (len < MIN_EDGE) continue
          const ux = dx / len, uz = dz / len
          // Outward normal in plan coordinates, then flip z for Three.js.
          const nx = uz, nz = -ux
          const yaw = Math.atan2(uz, ux)
          const add = (kind: BridgeFrame['kind'], along: number, y: number, w: number, h: number, d: number) => {
            const outward = d / 2 - EMBED
            frames.push({ block: block.name, kind, yaw,
              position: [a[0] + ux * along + nx * outward, y, -(a[1] + uz * along + nz * outward)],
              size: [w, h, d] })
          }
          const span = len - 2 * END_MARGIN
          // Match the repeating glass band's height in bridgeTexture().
          // Clip against each actual storey rather than assuming a 4.5 m storey.
          for (let cycle = Math.floor(low / FLOOR); cycle * FLOOR < high; cycle++) {
            const lo = Math.max(low, cycle * FLOOR + 1)
            const hi = Math.min(high, cycle * FLOOR + 3.2)
            if (hi - lo < 0.45) continue
            const count = Math.max(1, Math.ceil(span / POST_SPACING))
            for (let j = 0; j <= count; j++) {
              add('post', END_MARGIN + span * j / count, (lo + hi) / 2, POST_WIDTH, hi - lo, POST_DEPTH)
            }
            for (const y of [lo + RAIL_HEIGHT / 2, hi - RAIL_HEIGHT / 2]) {
              add('rail', len / 2, y, span + POST_WIDTH, RAIL_HEIGHT, RAIL_DEPTH)
            }
          }
          // Raised fascia near the top of the highest bridge storey.
          // Stop short of each corner; do not span across branch openings.
          if (li === levels.length - 1) add('roof', len / 2, high - ROOF_HEIGHT / 2, span + POST_WIDTH, ROOF_HEIGHT, ROOF_DEPTH)
        }
      }
    }
  }
  return frames
}

export function addBridgeDetails(
  scene: THREE.Scene,
  mass: MassBlock[],
  bridgeColours: ReadonlyMap<string, string>,
  blockColours: Record<string, string> | undefined,
  own: Own,
) {
  const frames = bridgeFramePlacements(mass)
  if (!frames.length) return
  const geometry = own(new THREE.BoxGeometry(1, 1, 1))
  const material = own(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72, metalness: 0.08 }))
  const mesh = new THREE.InstancedMesh(geometry, material, frames.length)
  const transform = new THREE.Matrix4(), rotation = new THREE.Quaternion()
  const axis = new THREE.Vector3(0, 1, 0), position = new THREE.Vector3(), scale = new THREE.Vector3()
  const colour = new THREE.Color()
  frames.forEach((f, i) => {
    position.set(...f.position); scale.set(...f.size)
    rotation.setFromAxisAngle(axis, f.yaw)
    transform.compose(position, rotation, scale)
    mesh.setMatrixAt(i, transform)
    colour.set(bridgeColours.get(f.block.toUpperCase()) ?? '#c9ccc6')
    const tint = blockColours?.[f.block]
    if (tint) colour.multiply(new THREE.Color(tint))
    // Darker mullions and a slightly lighter fascia retain each bridge's hue.
    if (f.kind === 'post') colour.multiplyScalar(0.72)
    else if (f.kind === 'roof') colour.lerp(new THREE.Color('#ffffff'), 0.12)
    mesh.setColorAt(i, colour)
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  mesh.name = 'Campus landmarks - bridge frames and roof fascia'
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
}
