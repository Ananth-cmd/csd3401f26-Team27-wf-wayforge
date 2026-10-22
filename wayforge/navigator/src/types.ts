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

export type Poi = { id: string; name: string; code: string; node: string; category: string; description: string; startingPoint: boolean }

export type Building = {
  format: string
  version: number
  id: string
  name: string
  site: string
  floorHeight: number
  illustrative: boolean
  units: 'm'
  levels: Level[]
  nodes: Node[]
  edges: Edge[] // same-floor
  links: Edge[] // between floors (stairs, lift)
  pois: Poi[]
}

// Same shape as the prototype's Route (BuildingDefinition.cs)
export type Route = {
  nodes: string[] // start ... destination (node ids)
  passages: EdgeKind[] // how each leg is travelled (nodes.length - 1)
  metres: number // total route cost in metres (includes lift wait penalty, like the prototype)
  minutes: number // max(1, ceil(metres / 65))
}
