// Shared data contract. Building = the published .wfb (as JSON). Route = what #4's backend returns.
// Coordinates are metres, [x, z] on the floor plane, z = north.

export type Vec2 = [number, number]

export type Wall = { a: Vec2; b: Vec2; thickness: number; exterior?: boolean } // exterior: true when the wall has a room on one side only
export type Door = { a: Vec2; b: Vec2 } // door opening span in its wall: start and end points
export type Window = { a: Vec2; b: Vec2; sill: number; height: number; thickness: number } // window span on a wall; sill and height in metres above the floor

export type Level = {
  index: number
  name: string
  elevation: number
  height: number
  floors: Vec2[][] // floor slab outlines
  walls: Wall[]
  doors?: Door[]
  windows?: Window[]
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
  surroundings?: Site
  blockColours?: Record<string, string> // block name (E2) -> "#rrggbb", picked in the Studio. Drawing only
}

// Surroundings of the building (the .wfb "site" object) in level coordinates, metres. Used for drawing only, not for routing.
export type Site = {
  source: string
  bounds: [number, number, number, number] // x0, z0, x1, z1
  areas: { kind: string; name: string; polygon: Vec2[] }[] // kind: water, park, grass, trees or plaza
  roads: { kind: string; name: string; width: number; points: Vec2[] }[] // kind: road, path or cycle; width in metres
  buildings: { name: string; kind: string; levels: number; polygon: Vec2[] }[] // neighbouring buildings; levels is the storey count
  landmarks: { name: string; kind: string; pos: Vec2 }[] // kind: mrt, bus, food, shop or park
  bridges: { room: string; colour: string }[] // room: place id of a link bridge; colour: "#rrggbb"
}

// Same shape as the prototype's Route (BuildingDefinition.cs)
export type Route = {
  nodes: string[] // start ... destination (node ids)
  passages: EdgeKind[] // how each leg is travelled (nodes.length - 1)
  metres: number // total route cost in metres (includes lift wait penalty, like the prototype)
  minutes: number // max(1, ceil(metres / 65))
}
