// Turns the published places into something people can tell apart and search, without changing the data:
// - "Wc" -> "Toilet", block added to code-less names ("W1 Lift Lobby A"), corridors / "Room W1_r185" hidden
// - readable types ("Office", not "office"; never "unknown"), no empty code fields
// - search over names, codes (spaces/hyphens ignored), types and everyday words (toilet, LT, canteen...)
// - which places can reach which (the published map isn't always fully joined up)
import type { Building, Node, Poi } from './types'

export type PlaceKind = 'toilet' | 'food' | 'library' | 'lift' | 'stairs' | 'entrance' | 'lecture' | 'room'
export type Place = Poi & {
  title: string // what we show: "Toilet", "W1 Lift Lobby A", "Seminar Room"
  type: string // "Toilet", "Office", "Room"...
  kind: PlaceKind
  block: string // "W1" or ''
  level: number
  hidden: boolean // corridors and placeholder rooms: not offered as places
  words: string[] // search words (name, type, everyday words)
  meta: string[] // search words that only narrow (block, level, code parts)
  codeKey: string // code without spaces / hyphens, lowercase
}

const BLOCK = /^([A-Za-z]{1,2}\d{1,2})[-_\s]/
export const blockFrom = (s: string) => BLOCK.exec(s.trim() + ' ')?.[1]?.toUpperCase() ?? ''
const PLACEHOLDER = /^(room\s+)?[a-z]{1,2}\d{0,2}_[a-z]+\d+$/i // "Room W1_r185"
const tidy = (s: string) => s.replace(/\s*\(Level \d+\)/i, '').replace(/\s+/g, ' ').trim()
const titleCase = (s: string) => s.replace(/\b[a-z]/g, c => c.toUpperCase())
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const SYN: Record<PlaceKind, string[]> = {
  toilet: ['toilet', 'toilets', 'restroom', 'washroom', 'wc', 'loo', 'bathroom', 'lavatory'],
  food: ['food', 'canteen', 'cafe', 'eat', 'dining', 'drinks', 'coffee'],
  library: ['library', 'books'],
  lift: ['lift', 'elevator'],
  stairs: ['stairs', 'staircase', 'steps'],
  entrance: ['entrance', 'exit', 'main'],
  lecture: ['lt', 'lecture', 'theatre', 'theater', 'auditorium'],
  room: [],
}
const TYPE: Record<PlaceKind, string> = { toilet: 'Toilet', food: 'Food & drink', library: 'Library', lift: 'Lift', stairs: 'Stairs', entrance: 'Entrance', lecture: 'Lecture theatre', room: 'Room' }
const ABBR: Record<string, string> = { rm: 'room', rms: 'room', sr: 'seminar', mtg: 'meeting', lib: 'library', caf: 'cafe', ent: 'entrance', toilets: 'toilet', theater: 'theatre' }

function kindOf(name: string, cat: string, node?: Node): PlaceKind {
  const s = `${name} ${cat}`.toLowerCase()
  if (/\b(wc|w\.c\.|toilets?|restrooms?|washrooms?)\b/.test(s)) return 'toilet'
  if (/\b(canteen|food|caf[eé]|dining|kiosk|restaurant)\b/.test(s)) return 'food'
  if (/\blibrary\b/.test(s)) return 'library'
  if (/\b(lift|elevator)\b/.test(s) || node?.kind === 'lift') return 'lift'
  if (/\bstair/.test(s) || node?.kind === 'stairs') return 'stairs'
  if (/\bentrance\b/.test(s)) return 'entrance'
  if (/\blecture\b|^lt\s?\d/.test(s)) return 'lecture'
  return 'room'
}

function cleanName(name: string): string {
  let n = tidy(name)
  const toilet = /^(wc|w\.c\.|toilets?)\b\s*/i.exec(n)
  if (toilet) {
    const rest = n.slice(toilet[0].length).replace(/^[-–(]\s*|\s*\)$/g, '')
    const r = rest.toLowerCase()
    if (/\b(acc|accessible|handicap|disabled|hc|ambulant)\b/.test(r)) return 'Accessible toilet'
    if (/\b(f|female|ladies|women)\b/.test(r)) return 'Toilet (Female)'
    if (/\b(m|male|gents|men)\b/.test(r)) return 'Toilet (Male)'
    return rest ? `Toilet ${rest}` : 'Toilet'
  }
  if (n === n.toLowerCase()) n = titleCase(n)
  return n
}

const typeLabel = (kind: PlaceKind, cat: string, name: string) => {
  if (kind !== 'room') return TYPE[kind]
  if (/seminar/i.test(name)) return 'Seminar room'
  if (/\blab\b|laboratory/i.test(name)) return 'Lab'
  if (/meeting/i.test(name)) return 'Meeting room'
  if (/lobby/i.test(name)) return 'Lobby'
  const c = cat.trim().toLowerCase()
  if (!c || c === 'unknown' || c === 'room' || c === 'rooms' || c === 'other') return 'Room'
  if (c === 'facilities') return 'Facility'
  return titleCase(c.replace(/[_-]+/g, ' ')).replace(/s$/, '')
}

// names that need a block (and a letter) to be told apart when there's no room code
const GENERIC = /^(lift lobby|lift|lobby|stairs?|toilet.*|accessible toilet|pantry|corridor|entrance lobby|seminar room|meeting room|study area|lounge)$/i

export function buildPlaces(b: Building, nodeIndex: Map<string, Node>) {
  // block of every node: from its id / label, else the nearest place with a room code on that floor
  const coded = b.pois.map(p => ({ p, n: nodeIndex.get(p.node), bl: blockFrom(p.code) })).filter(x => x.n && x.bl)
  const byLevel = new Map<number, { x: number; z: number; bl: string }[]>()
  for (const c of coded) { const a = byLevel.get(c.n!.level) ?? []; a.push({ x: c.n!.pos[0], z: c.n!.pos[1], bl: c.bl }); byLevel.set(c.n!.level, a) }
  const blockCache = new Map<string, string>()
  const blockOfNode = (id: string): string => {
    const hit = blockCache.get(id)
    if (hit !== undefined) return hit
    const n = nodeIndex.get(id)
    let bl = blockFrom(id.replace(/^[^:]*:/, '')) || (n ? blockFrom(n.label.replace(/^Room\s+/i, '')) : '')
    if (!bl && n) {
      let d = 60 * 60
      for (const c of byLevel.get(n.level) ?? []) { const e = (c.x - n.pos[0]) ** 2 + (c.z - n.pos[1]) ** 2; if (e < d) { d = e; bl = c.bl } }
    }
    blockCache.set(id, bl)
    return bl
  }

  const places: Place[] = b.pois.filter(p => nodeIndex.has(p.node)).map(p => {
    const n = nodeIndex.get(p.node)!
    const name = cleanName(p.name)
    const kind = kindOf(name, p.category, n)
    const block = blockFrom(p.code) || blockOfNode(p.node)
    const hidden = p.category.toLowerCase() === 'corridor' || /^corridor\b/i.test(p.name) || PLACEHOLDER.test(p.name.trim())
    const type = typeLabel(kind, p.category, name)
    const code = p.code.trim()
    const title = !code && block && GENERIC.test(name) && !name.toUpperCase().startsWith(block) ? `${block} ${name}` : name
    const levelName = b.levels[n.level]?.name ?? ''
    return {
      ...p, code, title, type, kind, block, level: n.level, hidden,
      words: [...new Set([...norm(`${title} ${p.name} ${type}`).split(' '), ...SYN[kind]])].filter(Boolean),
      meta: [...new Set([...norm(`${block} ${levelName} ${code}`).split(' '), `l${n.level + 1}`])].filter(Boolean),
      codeKey: code.toLowerCase().replace(/[^a-z0-9]/g, ''),
    }
  })
  // same title, same floor, no code -> add A, B, C... (west to east)
  const groups = new Map<string, Place[]>()
  for (const p of places) if (!p.hidden && !p.code) { const k = `${p.level}|${p.title}`; const g = groups.get(k) ?? []; g.push(p); groups.set(k, g) }
  for (const g of groups.values()) if (g.length > 1 && g.length <= 26) {
    g.sort((a, c) => { const na = nodeIndex.get(a.node)!.pos, nc = nodeIndex.get(c.node)!.pos; return na[0] - nc[0] || na[1] - nc[1] })
    g.forEach((p, i) => { p.title = `${p.title} ${String.fromCharCode(65 + i)}`; p.meta.push(String.fromCharCode(97 + i)) })
  }
  return { places, blockOfNode }
}

// "Level 1 · W1-01-08" (no dangling dots when there's no code)
export const placeSub = (p: Place, levelName: string, extra?: string) =>
  [extra, p.block && !p.code && !p.title.startsWith(p.block) ? `${p.block} block` : '', levelName, p.code].filter(Boolean).join(' · ')

// ---------- search ----------
export function searchPlaces(places: Place[], query: string, nodeIndex: Map<string, Node>, near?: Node | null): Place[] {
  const qn = norm(query)
  if (!qn) return []
  const compact = qn.replace(/ /g, '')
  const tokens = qn.split(' ').map(t => ABBR[t] ?? t)
  const hasDigit = /\d/.test(compact)
  const out: { p: Place; s: number; d: number }[] = []
  const pre = (list: string[], t: string) => list.some(w => w.startsWith(t)) || (t.length > 3 && t.endsWith('s') && list.some(w => w.startsWith(t.slice(0, -1))))
  for (const p of places) {
    if (p.hidden) continue
    let s = -1
    if (p.codeKey && compact.length >= 2 && p.codeKey === compact) s = 0
    else if (p.codeKey && hasDigit && compact.length >= 3 && p.codeKey.startsWith(compact)) s = 1
    else if (p.codeKey && hasDigit && compact.length >= 4 && p.codeKey.includes(compact)) s = 2
    else {
      const t = p.title.toLowerCase()
      if (t === qn) s = 3
      else if (t.startsWith(qn)) s = 4
      else {
        let nameHit = false, ok = true
        for (const tok of tokens) {
          if (pre(p.words, tok)) nameHit = true
          else if (!pre(p.meta, tok)) { ok = false; break }
        }
        if (ok) s = nameHit ? 5 : 6
      }
    }
    if (s < 0) continue
    let d = p.level * 1e5
    if (near) { const n = nodeIndex.get(p.node)!; d = Math.hypot(n.pos[0] - near.pos[0], n.pos[1] - near.pos[1]) + Math.abs(n.level - near.level) * 60 }
    out.push({ p, s, d })
  }
  out.sort((a, c) => a.s - c.s || (a.s >= 5 && !near ? a.p.level - c.p.level || a.p.block.localeCompare(c.p.block) : 0) || a.d - c.d || a.p.title.localeCompare(c.p.title))
  return out.map(x => x.p)
}

// ---------- which points are joined up ----------
export function components(b: Building): Map<string, number> {
  const parent = new Map<string, string>()
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r)!; let c = x; while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n } return r }
  for (const n of b.nodes) parent.set(n.id, n.id)
  for (const e of [...b.edges, ...b.links]) {
    if (e.blocked || !parent.has(e.from) || !parent.has(e.to)) continue
    const a = find(e.from), c = find(e.to)
    if (a !== c) parent.set(a, c)
  }
  const ids = new Map<string, number>(), out = new Map<string, number>()
  for (const n of b.nodes) { const r = find(n.id); if (!ids.has(r)) ids.set(r, ids.size); out.set(n.id, ids.get(r)!) }
  return out
}
