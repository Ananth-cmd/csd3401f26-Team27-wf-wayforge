// Shared data contract. Building = the published .wfb (as JSON). Route = what #4's backend returns.
// Coordinates are metres, [x, z] on the floor plane, z = north.

export type Vec2 = [number, number]

export type Wall = { a: Vec2; b: Vec2; thickness: number }

export type Level = {
  index: number
  name: string
  elevation: number
  height: number
  floors: Vec2[][] // floor slab outlines
  walls: Wall[]
}

export type NodeKind = 'room' | 'turn' | 'stairs' | 'lift'
export type Node = { id: string; label: string; level: number; pos: Vec2; kind: NodeKind }

export type EdgeKind = 'walk' | 'stairs' | 'lift'
export type Edge = { from: string; to: string; kind: EdgeKind; bidirectional: boolean; blocked: boolean; extraCost: number }

export type Poi = { id: string; name: string; code: string; node: string; category: string }

export type Building = {
  format: string
  version: number
  id: string
  name: string
  site: string
  illustrative: boolean
  units: 'm'
  levels: Level[]
  nodes: Node[]
  edges: Edge[] // same-floor
  links: Edge[] // between floors (stairs, lift)
  pois: Poi[]
}

export type RouteStep = {
  node: string
  level: number
  pos: Vec2
  text: string // "Continue to Demo lift"
  metres: number // distance of this leg
  via?: 'stairs' | 'lift' // set when this step changes floor
}

export type Route = {
  from: string
  to: string
  stepFree: boolean
  metres: number
  minutes: number
  steps: RouteStep[] // steps[0] is the start
}
