/*!
 * \file App.tsx
 * \brief The WayForge Navigator app: every screen, the navigation flow and the layout
 *
 * Map first (Wayforge_SIT_1 designs, SIT red / charcoal / white): the map fills
 * the screen and everything floats on it. A "Where to?" bar and Toilets / Stairs /
 * Lifts at the top, the current location at the bottom. One picker sets both the
 * start ("Where are you?") and the destination ("Where to?"): building and level
 * are remembered and tapping a room commits straight away. Then a route preview
 * (stairs or lift), the guide (dark instruction at the top, one button at the
 * bottom), arrival, and "nearby" (closest toilet / stairs / lift by walking
 * distance from the start). Phones get bottom sheets; tablets and desktops get
 * the same cards in a column on the left of the map.
 * The address bar keeps your place (?to=, ?from=, ?step=) so refresh, Back and
 * shared links work.
 *
 * Links: data and routes from api.ts (loadBuilding, findRoute); stages from
 * legs.ts; place names and search from places.ts; directions text from
 * directions.ts; the map from MapView.tsx and the 3D route from Route3D.tsx.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan 100%
 *   - Screen flow, back stack and URL state
 *   - Map-first phone and desktop layouts
 *   - Start / destination picker (building, level, room), search, recent places, QR
 *   - Route preview, step-by-step guidance, arrival and nearby facilities
 *   - Accessibility: keyboard search, ARIA, Esc as Back
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-11-19
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Building, Route } from './types'
import { findRoute, loadBuilding } from './api'
import { toLegs, walkMetres } from './legs'
import type { Leg } from './legs'
import { buildPlaces, components, searchPlaces } from './places'
import type { Place } from './places'
import { landmarkFinder, sameRoute, verticalNames, walkSteps } from './directions'
import type { Step } from './directions'
import MapView from './MapView'
import type { MapProps, Vertical } from './MapView'
const Route3D = lazy(() => import('./Route3D')) // three.js only downloads when a route is shown

type Screen = 'explore' | 'where' | 'find' | 'blocks' | 'levels' | 'qr' | 'routes' | 'guide' | 'paused' | 'arrived' | 'nearby' | 'nearroute'
type Kind = 'toilet' | 'stairs' | 'lift'
const TYPE_WORD: Partial<Record<Place['kind'], string>> = { food: 'Food', library: 'Library', lecture: 'Lecture theatres' }
const KIND_NAME: Record<Kind, string> = { toilet: 'Toilets', stairs: 'Stairs', lift: 'Lifts' }

// storage (can throw in private mode)
const pref = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } } }
const sound = (name: string) => { try { const a = new Audio(`${import.meta.env.BASE_URL}audio/${name}.wav`); a.volume = 0.5; void a.play().catch(() => {}) } catch { /* ignore */ } }
const PAGE = 30
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
const qrSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

// ---------- icons ----------
const ic = { className: 'ico', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const SearchIcon = () => <svg {...ic} strokeWidth={2.4}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
const Up = () => <svg {...ic} strokeWidth={2.2}><path d="M12 20V5m-6 6 6-6 6 6" /></svg>
const Down = () => <svg {...ic} strokeWidth={2.2}><path d="M12 4v15m-6-6 6 6 6-6" /></svg>
const TurnL = () => <svg {...ic} strokeWidth={2.2}><path d="M16 20v-7a3 3 0 0 0-3-3H6m4-4-4 4 4 4" /></svg>
const TurnR = () => <svg {...ic} strokeWidth={2.2}><path d="M8 20v-7a3 3 0 0 1 3-3h7m-4-4 4 4-4 4" /></svg>
const PinIcon = () => <svg {...ic}><path d="M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
const CloseIcon = () => <svg {...ic} strokeWidth={2.2}><path d="m7 7 10 10M17 7 7 17" /></svg>
const Caret = () => <svg viewBox="0 0 24 24" className="caret" aria-hidden><path d="M7 10l5 5 5-5z" fill="currentColor" /></svg>
const SwapIcon = () => <svg {...ic} strokeWidth={2.2}><path d="M7 4v14m0 0-3-3m3 3 3-3M17 20V6m0 0-3 3m3-3 3 3" /></svg>
const stepIcon = (s: Step) => s.turn === 'left' ? <TurnL /> : s.turn === 'right' ? <TurnR /> : s.turn === 'arrive' ? <PinIcon /> : <Up />

// sheet / card heading: big title, grey line under it, round x on the right
function Head({ title, sub, onClose, closeLabel = 'Close' }: { title: string; sub?: ReactNode; onClose?: () => void; closeLabel?: string }) {
  return <div className="sx-head"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{onClose && <button className="sx-x" onClick={onClose} aria-label={closeLabel}><CloseIcon /></button>}</div>
}

// grey place row (pink when it's the chosen one)
function Item({ title, sub, sel, dim, onClick, id, option }: { title: string; sub: string; sel?: boolean; dim?: boolean; onClick?: () => void; id?: string; option?: boolean }) {
  return <button className={`sx-item${sel ? ' sel' : ''}${dim ? ' dim' : ''}`} id={id} role={option ? 'option' : undefined} aria-selected={option ? !!sel : undefined} aria-pressed={option ? undefined : !!sel} tabIndex={option ? -1 : undefined} onClick={onClick} disabled={!onClick}><b>{title}</b><small>{sub}</small></button>
}

// camera + BarcodeDetector (Chrome on Android); the QR option only shows where it can work
function QrScanner({ onCode }: { onCode: (text: string) => string | null }) {
  const video = useRef<HTMLVideoElement>(null)
  const [msg, setMsg] = useState('Starting the camera…')
  // eslint-disable-next-line react-hooks/refs -- latest-value ref / one-off sync, intentional
  const cb = useRef(onCode); cb.current = onCode
  useEffect(() => {
    let stream: MediaStream | null = null, timer = 0, stop = false
    const W = window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(s => {
      if (stop) { s.getTracks().forEach(t => t.stop()); return }
      stream = s
      const v = video.current!; v.srcObject = s; void v.play()
      setMsg('Keep the checkpoint code inside the frame')
      const det = new W.BarcodeDetector({ formats: ['qr_code'] })
      const tick = async () => {
        if (stop) return
        try { const r = await det.detect(v); if (r[0]) { const err = cb.current(r[0].rawValue); if (err) setMsg(err); else return } } catch { /* frame not ready */ }
        timer = window.setTimeout(tick, 250)
      }
      void tick()
    }).catch(() => setMsg('Camera not available. Allow camera access, or pick a room instead.'))
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return <div className="sx-qr"><video ref={video} playsInline muted /><span className="sx-qr-frame" /><p aria-live="polite">{msg}</p></div>
}

type Near = { kind: Kind; node: string; title: string; level: number; metres: number; route: Route; place?: Place }

export default function App() {
  const [b, setB] = useState<Building | null>(null)
  const [err, setErr] = useState('')
  const [stack, setStack] = useState<Screen[]>(['explore'])
  const screen = stack[stack.length - 1]
  const [start, setStart] = useState<Place | null>(null)
  const [dest, setDest] = useState<Place | null>(null)
  const [choice, setChoice] = useState<'shortest' | 'stepfree'>(pref.get('wayforge.stepFree') === '1' ? 'stepfree' : 'shortest')
  const [legIdx, setLegIdx] = useState(0)
  const [floor, setFloor] = useState(0) // level being looked at (map, picker)
  const [block, setBlock] = useState('') // building being looked at in the picker ('' = all)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [hi, setHi] = useState(0) // highlighted search result (arrow keys)
  const [flat, setFlatState] = useState(pref.get('wayforge.topDown') !== '0') // 2D map instead of 3D
  const setFlat = useCallback((v: boolean) => { setFlatState(v); pref.set('wayforge.topDown', v ? '1' : '0') }, [])
  const [use3d, setUse3dState] = useState(pref.get('wayforge.walk3d') !== '0') // routes in real 3D (walk-through)
  const setUse3d = (v: boolean) => { setUse3dState(v); pref.set('wayforge.walk3d', v ? '1' : '0') }
  const [no3d, setNo3d] = useState(false) // this device can't do WebGL: always the map
  const [near, setNear] = useState<Near | null>(null) // closest toilet / stairs / lift
  const [nearKind, setNearKind] = useState<Kind | null>(null) // chip picked before the start was known
  const [hiKind, setHiKind] = useState<Kind | null>(null) // Toilets / Stairs / Lifts chip pressed: those icons are highlighted on the map
  const [nearList, setNearList] = useState<Near[]>([]) // every reachable facility of that kind, cheapest walk first
  const [asking, setAsking] = useState(false) // "End this route?"
  const [confirmed, setConfirmed] = useState(false) // "Starting point confirmed" under the map
  const [turnsOpen, setTurnsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false) // the full step list under the route preview
  const [tripOpen, setTripOpen] = useState(false) // the compact trip summary expanded while walking
  const [openGroups, setOpenGroups] = useState<string[]>([]) // expanded groups of same-named places
  const [dq, setDq] = useState('')
  useEffect(() => { const t = setTimeout(() => setDq(query), 250); return () => clearTimeout(t) }, [query])
  const readVp = () => {
    // foldables: the two screens of a spanned window (Viewport Segments API, where the browser has it)
    const segs = ((window as unknown as { viewport?: { segments?: DOMRect[] } }).viewport?.segments ?? []).map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height }))
    return { w: window.innerWidth, h: window.innerHeight, segs }
  }
  const [vp, setVp] = useState(readVp)
  // what the floating bits cover, so the map centres what's left (measured)
  const topRef = useRef<HTMLDivElement>(null), botRef = useRef<HTMLDivElement>(null)
  const [cover, setCover] = useState({ t: 0, b: 0 })

  useEffect(() => { loadBuilding().then(setB).catch(e => setErr(String(e))) }, [])
  useEffect(() => {
    if (document.querySelector('link[rel="manifest"]')) return
    const l = document.createElement('link'); l.rel = 'manifest'; l.href = `${import.meta.env.BASE_URL}manifest.webmanifest`; document.head.appendChild(l)
  }, [])

  // ---------- data the screens use (worked out once per building) ----------
  const nodeIndex = useMemo(() => new Map((b?.nodes ?? []).map(n => [n.id, n])), [b])
  const P = useMemo(() => {
    if (!b) return null
    const { places, blockOfNode } = buildPlaces(b, nodeIndex)
    const visible = places.filter(p => !p.hidden)
    const byNode = new Map<string, Place>()
    for (const p of visible) if (!byNode.has(p.node)) byNode.set(p.node, p)
    const vnames = verticalNames(b, blockOfNode)
    const names = new Map<string, string>() // what the map labels
    for (const p of visible) names.set(p.node, p.title)
    for (const [id, n] of vnames) names.set(id, n)
    const comp = components(b)
    const sizes = new Map<number, number>(); for (const p of visible) { const c = comp.get(p.node)!; sizes.set(c, (sizes.get(c) ?? 0) + 1) }
    const main = [...sizes].sort((x, y) => y[1] - x[1])[0]?.[0]
    const cut = visible.filter(p => comp.get(p.node) !== main)
    if (cut.length) console.info(`WayForge: ${cut.length} of ${visible.length} places have no path to the rest of the map (map data).`)
    const blocks = [...new Set(visible.map(p => p.block).filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
    return { places, visible, byNode, byId: new Map(visible.map(p => [p.id, p])), words: [...new Set(visible.flatMap(q => q.words))].filter(w => w.length > 3), vnames, names, comp, main, blocks, landmark: landmarkFinder(places, nodeIndex) }
  }, [b, nodeIndex])

  // ---------- navigation mode: keep the screen on and buzz once at the start (Android) ----------
  const guiding = screen === 'guide' || screen === 'paused'
  useEffect(() => {
    if (!guiding) return
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    const ask = () => { if (document.visibilityState === 'visible') nav.wakeLock?.request('screen').then(l => { lock = l }).catch(() => {}) }
    ask(); document.addEventListener('visibilitychange', ask)
    try { navigator.vibrate?.(40) } catch { /* ignore */ }
    return () => { document.removeEventListener('visibilitychange', ask); void lock?.release().catch(() => {}) }
  }, [guiding])
  useLayoutEffect(() => {
    const f = () => setVp(readVp())
    window.addEventListener('resize', f); return () => window.removeEventListener('resize', f)
  }, [])
  // How much of the window the on-screen keyboard covers. The sheets sit above it, so a result list is never hidden
  // behind the keyboard and the hit targets stay where they are drawn (handover 6).
  const [kb, setKb] = useState(0)
  useLayoutEffect(() => {
    const v = window.visualViewport
    if (!v) return
    const f = () => setKb(Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop)))
    f(); v.addEventListener('resize', f); v.addEventListener('scroll', f)
    return () => { v.removeEventListener('resize', f); v.removeEventListener('scroll', f) }
  }, [])
  useLayoutEffect(() => {
    const measure = () => {
      const t = topRef.current ? Math.round(topRef.current.getBoundingClientRect().bottom) : 0
      const bt = botRef.current ? Math.round(window.innerHeight - botRef.current.getBoundingClientRect().top) : 0
      setCover(c => (c.t === t && c.b === bt ? c : { t, b: bt }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (topRef.current) ro.observe(topRef.current)
    if (botRef.current) ro.observe(botRef.current)
    return () => ro.disconnect()
  })
  const first = useRef(true)
  useEffect(() => {
    document.querySelectorAll('.scroll').forEach(el => { el.scrollTop = 0 })
    if (first.current) { first.current = false; return }
    sound(screen === 'arrived' ? 'arrive' : 'screen')
  }, [screen, legIdx])
  const backRef = useRef<() => void>(() => {})
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement && e.target.value)) backRef.current() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  // ---------- the address bar keeps your place: ?to=W6-01-07&from=W1-01-12&step=3 (refresh, Back, share a room) ----------
  const placeKey = (p: Place) => (p.code && P?.visible.filter(x => x.codeKey === p.codeKey).length === 1 ? p.code : p.id)
  const findPlace = useCallback((s: string | null): Place | null => {
    if (!s || !P) return null
    const k = s.toLowerCase().replace(/[^a-z0-9]/g, '')
    return P.places.find(p => p.id === s) ?? P.visible.find(p => p.codeKey && p.codeKey === k) ?? null
  }, [P])
  const restored = useRef(false)
  useEffect(() => {
    if (!P || restored.current) return
    restored.current = true
    const q = new URLSearchParams(window.location.search)
    const to = findPlace(q.get('to')), from = findPlace(q.get('from') ?? q.get('at'))
    const step = Number(q.get('step') ?? 0)
    /* eslint-disable react-hooks/set-state-in-effect -- one-off: restore the place from the address */
    if (q.get('sf') === '1') setChoice('stepfree')
    if (from) { setStart(from); setFloor(from.level); setBlock(from.block) }
    if (to) { setDest(to); setFloor(to.level) }
    if (to && from) { setStack(step > 0 ? ['explore', 'routes', 'guide'] : ['explore', 'routes']); setLegIdx(Math.max(0, step - 1)) }
    else if (to) setStack(['explore', 'where'])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [P, findPlace])
  const pushed = useRef(0), depth = useRef(1), stackLen = useRef(1)
  // eslint-disable-next-line react-hooks/refs -- latest-value ref / one-off sync, intentional
  stackLen.current = stack.length
  useEffect(() => {
    if (!P || !restored.current) return
    const q = new URLSearchParams(window.location.search) // keeps ?b=<building> and anything else
    const set = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k))
    set('to', dest ? placeKey(dest) : null)
    set('from', start ? placeKey(start) : null)
    q.delete('at')
    set('step', screen === 'guide' ? String(legIdx + 1) : null)
    set('sf', screen === 'guide' && choice === 'stepfree' ? '1' : null)
    const qs = q.toString(), url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
    if (stack.length > depth.current) { window.history.pushState({ wf: stack.length }, '', url); pushed.current++ }
    else window.history.replaceState({ wf: stack.length }, '', url)
    depth.current = stack.length
  }, [stack, dest, start, legIdx, choice, P]) // eslint-disable-line
  useEffect(() => {
    const onPop = () => {
      if (pushed.current > 0) pushed.current--
      if (stackLen.current > 1) { depth.current = stackLen.current - 1; setStack(st => (st.length > 1 ? st.slice(0, -1) : st)) }
      else if (pushed.current > 0) { pushed.current--; window.history.back() }
    }
    window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop)
  }, [])

  // both route options (stairs / lift); one option when they're the same route
  const routes = useMemo(() => {
    if (!b || !start || !dest) return null
    const mk = (sf: boolean) => { const r = findRoute(b, start.node, dest.node, sf); return r ? { r, legs: toLegs(b, r) } : null }
    const shortest = mk(false), stepfree = mk(true)
    return { shortest, stepfree, same: sameRoute(shortest?.r, stepfree?.r) }
  }, [b, start, dest])

  // layout: phones get bottom sheets; tablets, unfolded foldables, landscape phones and desktops get the cards in a column
  // on the left; a window spanning two screens puts the column on the left screen and the map on the right one
  const segs = vp.segs
  const spanned = segs.length === 2 && segs[1].x > segs[0].x + 10
  const stackedFold = segs.length === 2 && segs[1].y > segs[0].y + 10
  const desktop = spanned || (!stackedFold && vp.w >= 720 && (vp.h >= 480 || vp.w >= vp.h * 1.6))
  const colW = spanned ? segs[0].w - 32 : Math.round(Math.min(420, Math.max(320, vp.w * 0.32)))
  const padL = spanned ? segs[1].x : colW + 32

  // search results (destination and start pickers)
  const startNode = start ? nodeIndex.get(start.node) ?? null : null
  const results = useMemo(() => (P && dq.trim() ? searchPlaces(P.visible, dq, nodeIndex, startNode) : []), [P, dq, nodeIndex, startNode])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- latest-value ref / one-off sync, intentional
  useEffect(() => { setLimit(PAGE); setHi(0) }, [dq, screen, floor, block])
  // Walking distance for the result rows, measured along the route graph from the confirmed start - not a straight
  // line (handover 2). Only the rows a person can see are measured; no start means no distance, and a place with no
  // route to the start shows an em dash rather than a made-up number.
  const WALK_ROWS = 20
  const walkTo = useMemo(() => {
    const m = new Map<string, { metres: number; minutes: number } | null>()
    if (!b || !start) return m
    for (const q of results.slice(0, WALK_ROWS)) {
      if (q.node === start.node) { m.set(q.id, { metres: 0, minutes: 0 }); continue }
      const r = findRoute(b, start.node, q.node, false)
      m.set(q.id, r ? { metres: r.metres, minutes: r.minutes } : null)
    }
    return m
  }, [b, start, results])

  if (err || !b || !P) return (
    <div className="sx sx-loading" role="status">
      <span className="sx-word">WayForge</span>
      {err ? <><b>Couldn't load the building.</b><p>{err}</p><button className="sx-btn red" onClick={() => window.location.reload()}>Try again</button></> : <><span className="sx-spin" /><p>Loading the campus map…</p></>}
    </div>
  )

  // ---------- helpers ----------
  const node = (id: string) => nodeIndex.get(id)!
  const L = (i: number) => b.levels[i]?.name ?? `Level ${i + 1}`
  const Lshort = (i: number) => { const m = /(\d+|[A-Z]\d*)\s*$/i.exec(L(i).replace(/^level\s*/i, '')); return m && m[1].length <= 3 ? `L${m[1].toUpperCase().replace(/^L/, '')}` : `L${i + 1}` }
  const blockName = (bl: string) => (bl ? `Block ${bl}` : b.name)
  const hasBlocks = P.blocks.length > 1
  const reach = (a: Place | null, c: Place | null) => !a || !c || P.comp.get(a.node) === P.comp.get(c.node)
  const vname = (id: string) => P.vnames.get(id) ?? P.byNode.get(id)?.title ?? node(id).label
  const recentKey = `wayforge.recent.${b.id}`
  const recent = (() => { try { return (JSON.parse(pref.get(recentKey) ?? '[]') as string[]).map(id => P.visible.find(p => p.id === id)).filter((p): p is Place => !!p) } catch { return [] } })()
  const addRecent = (p: Place) => pref.set(recentKey, JSON.stringify([p.id, ...recent.map(x => x.id).filter(id => id !== p.id)].slice(0, 3)))
  const levelsIn = (bl: string) => b.levels.map((_, i) => i).filter(i => !bl || P.visible.some(p => p.block === bl && p.level === i))
  const placesAt = (bl: string, f: number) => P.visible.filter(p => p.level === f && (!bl || p.block === bl))
  // Handover 2: a level row describes itself only with facilities that actually tell levels apart in this building's
  // data - a canteen or a library on this level and no other. Anything short of that shows the level number alone,
  // rather than listing three arbitrary room names as though they were a description.
  const DISTINCT: Place['kind'][] = ['food', 'library', 'lecture']
  const levelBlurb = (bl: string, f: number) => {
    const ls = levelsIn(bl)
    const kindsOn = (lv: number) => new Set(placesAt(bl, lv).filter(q => DISTINCT.includes(q.kind)).map(q => q.kind))
    const mine = kindsOn(f)
    const elsewhere = new Set(ls.filter(lv => lv !== f).flatMap(lv => [...kindsOn(lv)]))
    const only = [...mine].filter(k => !elsewhere.has(k)).map(k => TYPE_WORD[k] ?? k)
    const n = placesAt(bl, f).length
    if (!only.length) return `${n} place${n === 1 ? '' : 's'}`
    return `${only.length > 1 ? `${only.slice(0, -1).join(', ')} & ${only[only.length - 1]}` : only[0]} · ${n} place${n === 1 ? '' : 's'}`
  }

  // Handover 2: when nothing matches, offer a word the data actually contains rather than a dead end. Plain edit
  // distance over the words already indexed for search; only close misses are offered.
  const editDist = (a: string, c: string) => {
    const prev = Array.from({ length: c.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0]; prev[0] = i
      for (let j = 1; j <= c.length; j++) { const t = prev[j]; prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === c[j - 1] ? 0 : 1)); diag = t }
    }
    return prev[c.length]
  }
  const suggest = (q: string): string | null => {
    const w = q.trim().toLowerCase().split(/\s+/).pop() ?? ''
    if (w.length < 4) return null
    let best: string | null = null, bd = Math.min(3, Math.floor(w.length / 3) + 1)
    for (const word of P.words) { if (Math.abs(word.length - w.length) > bd) continue; const d = editDist(w, word); if (d > 0 && d <= bd) { bd = d; best = word } }
    return best
  }

  const go = (s: Screen) => setStack(st => [...st, s])
  const back = () => {
    if (asking) { setAsking(false); return }
    if (stack.length <= 1) return
    if (pushed.current > 0) window.history.back() // the popstate handler steps back (so phone Back and the x agree)
    else setStack(st => st.slice(0, -1))
  }
  // eslint-disable-next-line react-hooks/refs -- latest-value ref / one-off sync, intentional
  backRef.current = back
  const home = () => { setNear(null); setNearKind(null); setNearList([]); setHiKind(null); setStack(['explore']) }

  const picked = routes ? (routes.same ? routes.shortest : routes[choice] ?? null) : null
  // Walking distance for the result rows, from the confirmed start along the route graph - not a straight line.
  // Only the rows actually on screen are measured. No start means no distance to show; unreachable shows an em dash.
  const walkLabel = (p: Place) => {
    if (!start) return '' // no confirmed start, so no distance is claimed
    const d = walkTo.get(p.id)
    return d === undefined ? '' : d === null ? '—' : d.metres === 0 ? "you're here" : `${d.minutes} min · ${Math.round(d.metres)} m`
  }
  const legs: Leg[] = picked?.legs ?? []
  const li = Math.min(legIdx, Math.max(0, legs.length - 1))
  const leg = legs[li]

  // directions
  const legEnd = (l: Extract<Leg, { kind: 'walk' }>) => (l.final && dest ? dest.title : vname(l.nodes[l.nodes.length - 1]))
  const stepsOf = (l: Leg): Step[] => (l.kind === 'walk' ? walkSteps(nodeIndex, l.nodes, legEnd(l), P.landmark) : [])
  const turnText = (s: Step) => (s.turn !== 'arrive' && s.metres > 2 ? `${s.metres} m, then ${s.text[0].toLowerCase()}${s.text.slice(1)}` : s.text)
  // the dark instruction at the top of the guide: "Head to Central stairs · 45 m · stay on this level"
  const instruction = (i: number) => {
    const l = legs[i], n = legs[i + 1]
    if (l.kind !== 'walk') {
      const up = l.to > l.from
      return { icon: up ? <Up /> : <Down />, title: l.kind === 'lift' ? `Take lift to ${L(l.to)}` : `Go ${up ? 'up' : 'down'} to ${L(l.to)}`, sub: `${vname(l.nodes[0])} · check the floor sign before continuing` }
    }
    const m = Math.round(l.metres)
    if (l.final || !n) {
      const last = stepsOf(l).filter(s => s.turn === 'left' || s.turn === 'right').pop()
      return { icon: last?.turn === 'left' ? <TurnL /> : last?.turn === 'right' ? <TurnR /> : <Up />, title: `${dest?.title ?? legEnd(l)} ahead`, sub: `${m} m${dest?.code ? ` · look for ${dest.code}` : ''}` }
    }
    const to = vname(n.nodes[0])
    return { icon: <Up />, title: n.kind === 'lift' ? `Walk to ${to}` : `Head to ${to}`, sub: `${m} m · stay on this level` }
  }
  const confirmLabel = (i: number) => {
    const l = legs[i], n = legs[i + 1]
    if (!l) return 'Next'
    if (l.kind !== 'walk') return `I'm on ${L(l.to)} →`
    if (l.final || !n) return "I'm here ✓"
    return n.kind === 'lift' ? "I'm at the lift →" : "I'm at the stairs →"
  }
  const optionLabel = (o: typeof picked | undefined, sf: boolean) => {
    if (!o) return sf ? 'No step-free route' : 'No route'
    const t = o.legs.find(l => l.kind !== 'walk')
    const m = Math.round(walkMetres(o.legs))
    return `${o.r.minutes} min · ${m} m · ${t ? (t.kind === 'lift' ? 'lift' : 'stairs') : sf ? 'step-free' : 'walk'}`
  }
  // Handover 3: say out loud why the route goes up before it comes down, using the levels the route actually uses.
  // This is read off the legs, not written by hand, so it cannot drift from the route being drawn.
  const detourLine = (o: typeof picked): string | null => {
    if (!o) return null
    const hops = o.legs.filter(l => l.kind !== 'walk') as Extract<Leg, { kind: 'lift' | 'stairs' }>[]
    if (hops.length < 2 || !start || !dest) return null
    const peak = hops.reduce((h, l) => (l.to > h.to ? l : h), hops[0])
    if (peak.to <= Math.max(start.level, dest.level)) return null
    return `Via ${L(peak.to)}, then ${hops.map(h => L(h.to)).filter((v, i, arr) => arr.indexOf(v) === i && v !== L(peak.to)).join(', ')}.`
  }
  // the lifts / stairs the route uses, for the map: where each one takes you; the one you're heading for (or riding) moves
  const verticals = (cur?: number): Vertical[] => legs.flatMap((l, j) => {
    if (l.kind === 'walk') return []
    const up = l.to > l.from, firstT = legs.findIndex(x => x.kind !== 'walk')
    const active = cur === undefined ? j === firstT : j === cur || (j === cur + 1 && legs[cur].kind === 'walk')
    return [
      { node: l.nodes[0], kind: l.kind, up, label: `${vname(l.nodes[0])} · ${up ? 'up' : 'down'} to ${L(l.to)}`, active },
      { node: l.nodes[l.nodes.length - 1], kind: l.kind, up, label: '', active: false },
    ]
  })
  const legMap = (i: number): MapProps => {
    const l = legs[i]
    if (!l) return { building: b, floor }
    if (l.kind !== 'walk') { const prev = legs[i - 1]; const walked = prev ? legMap(i - 1) : null; return walked ? { ...walked, lines: [], done: walked.lines, here: l.nodes[0], pin: null, vertical: verticals(i) } : { building: b, floor: l.from, here: l.nodes[0], vertical: verticals(i) } }
    const end = l.nodes[l.nodes.length - 1]
    return { building: b, floor: l.level, lines: [l.nodes], here: l.nodes[0], pin: { node: end, label: legEnd(l) }, focus: l.nodes, vertical: verticals(i) }
  }
  const view3d = (stage?: number) => {
    const sl = stage === undefined ? null : legs[stage]
    const caption = (l: Leg) => l.kind === 'walk' ? `Walk to ${legEnd(l)}` : `${l.kind === 'lift' ? 'Lift' : 'Stairs'} to ${L(l.to)}`
    return <Suspense fallback={<div className="r3d-loading">Loading 3D…</div>}>
      <Route3D building={b} legs={legs} stage={stage} names={P.names} captions={legs.map(caption)} onFail={() => setNo3d(true)}
        start={sl ? { node: sl.nodes[0], title: 'You' } : start ? { node: start.node, title: start.title } : undefined}
        dest={dest ? { node: dest.node, title: dest.title } : undefined} />
    </Suspense>
  }

  // ---------- actions ----------
  const lostLeg = stack.includes('guide') || stack.includes('paused') ? leg : undefined // mid-route: you're somewhere along this step
  const openPicker = (s: 'where' | 'find') => {
    setQuery('')
    const at = s === 'where' ? (lostLeg ? (lostLeg.kind === 'walk' ? lostLeg.level : lostLeg.to) : start?.level) : dest?.level ?? start?.level
    const bl = s === 'where' ? start?.block : dest?.block ?? start?.block
    if (at !== undefined) setFloor(at)
    if (bl !== undefined && hasBlocks) setBlock(bl)
    go(s)
  }
  // Every reachable facility of this kind, cheapest walk first. The straight-line guess only picks which candidates
  // are worth routing; the order a person sees is the real walking cost (handover 5).
  const nearestList = (kind: Kind, from: Place): Near[] => {
    const here = node(from.node)
    const cands: { node: string; title: string; place?: Place }[] = kind === 'toilet'
      ? P.visible.filter(p => p.kind === 'toilet').map(p => ({ node: p.node, title: p.title, place: p }))
      : b.nodes.filter(n => n.kind === kind).map(n => ({ node: n.id, title: vname(n.id), place: P.byNode.get(n.id) }))
    const guess = (id: string) => { const n = node(id); return Math.abs(n.level - here.level) * 1000 + Math.hypot(n.pos[0] - here.pos[0], n.pos[1] - here.pos[1]) }
    const out: Near[] = []
    for (const c of cands.filter(c => P.comp.get(c.node) === P.comp.get(from.node)).sort((x, y) => guess(x.node) - guess(y.node)).slice(0, 12)) {
      const r: Route | null = c.node === from.node ? { nodes: [c.node], passages: [], metres: 0, minutes: 1 } : findRoute(b, from.node, c.node, false)
      if (r) out.push({ kind, node: c.node, title: c.title, level: node(c.node).level, metres: r.metres, route: r, place: c.place })
    }
    return out.sort((x, y) => x.metres - y.metres)
  }
  // every toilet / stairs / lift on the map (node ids), for the highlight
  const nodesOfKind = (kind: Kind): string[] => kind === 'toilet' ? P.visible.filter(p => p.kind === 'toilet').map(p => p.node) : b.nodes.filter(n => n.kind === kind).map(n => n.id)
  // pressing a chip lights up that kind of place on the map; pressing it again turns it off. If there are none on this
  // level the map moves to the closest level that has some.
  const toggleHi = (kind: Kind) => (hiKind === kind ? home() : showNearby(kind))
  // Handover 5: the chip selects the closest reachable facility and shows its card. The markers for that kind stay
  // lit on the map as a secondary cue, so the card and the map agree about what is being talked about.
  const showNearby = (kind: Kind, from: Place | null = start) => {
    setHiKind(kind)
    if (!from) { setNearKind(kind); openPicker('where'); return }
    const list = nearestList(kind, from)
    const n = list[0] ?? null
    setNearList(list); setNear(n); setNearKind(kind); setFloor(n ? n.level : from.level)
    setStack(st => [...st.filter(s => !['nearby', 'nearroute', 'where', 'blocks', 'levels', 'qr'].includes(s)), 'nearby'])
  }
  // tapping a room commits it: start -> back to the map (or the route / the guide), destination -> the route preview
  const setFrom = (p: Place) => {
    setStart(p); setLegIdx(0); setFloor(p.level); setConfirmed(true); setAsking(false); setTripOpen(false)
    if (nearKind && !dest) { showNearby(nearKind, p); return }
    setStack(st => { const base = st.filter(s => !['where', 'blocks', 'levels', 'qr', 'routes', 'guide', 'paused', 'arrived', 'nearby', 'nearroute'].includes(s)); const root: Screen[] = base.length ? base : ['explore']; return dest ? [...root, 'routes'] : root })
  }
  const setTo = (p: Place) => {
    setDest(p); setQuery(''); addRecent(p); setFloor(p.level); setNear(null); setNearKind(null); setLegIdx(0); setTripOpen(false)
    if (!start) { setStack(st => [...st.filter(s => !['find', 'blocks', 'levels', 'routes', 'guide', 'paused', 'nearby', 'nearroute'].includes(s)), 'where']); return }
    setStack(st => [...st.filter(s => !['find', 'blocks', 'levels', 'routes', 'guide', 'paused', 'nearby', 'nearroute'].includes(s)), 'routes'])
  }
  const pickOnMap = (id: string) => {
    const p = P.byNode.get(id)
    if (!p) return
    if (screen === 'where') setFrom(p)
    else setTo(p)
  }
  // Swap changes which two places the route is worked out between; it does not reverse the drawn line, because
  // one-way links and step-free connections can differ in the other direction. Only live with two valid endpoints.
  const swapEnds = () => {
    if (!start || !dest) return
    const a = start, z = dest
    setStart(z); setDest(a); setLegIdx(0); setConfirmed(false); setAsking(false); setPreviewOpen(false); setFloor(z.level)
    setStack(st => [...st.filter(s => !['where', 'find', 'blocks', 'levels', 'qr', 'guide', 'arrived', 'nearby', 'nearroute'].includes(s)), 'routes'])
  }
  const startGuide = () => { setLegIdx(0); setTurnsOpen(false); setTripOpen(false); go('guide') }
  const pauseTrip = () => { setTurnsOpen(false); setTripOpen(false); setStack(st => [...st.filter(s => s !== 'guide'), 'paused']) }
  const resumeTrip = () => setStack(st => [...st.filter(s => s !== 'paused'), 'guide'])
  const nextLeg = () => { setTurnsOpen(false); if (li + 1 >= legs.length) setStack(['explore', 'arrived']); else setLegIdx(li + 1) }
  const finish = () => { if (dest) setStart(dest); setDest(null); setConfirmed(false); setStack(['explore']) }
  const endRoute = () => { setAsking(false); setStack(st => st.filter(s => s !== 'guide' && s !== 'paused')) }
  const pickOption = (c: 'shortest' | 'stepfree') => { setChoice(c); pref.set('wayforge.stepFree', c === 'stepfree' ? '1' : '0') }
  const fromQr = (text: string): string | null => {
    let key: string | null = text.trim()
    try { const u = new URL(key); key = u.searchParams.get('from') ?? u.searchParams.get('at') ?? u.searchParams.get('to') } catch { /* plain text code */ }
    const p = findPlace(key)
    if (!p) return "That isn't a WayForge checkpoint for this building. Try another code."
    try { navigator.vibrate?.(30) } catch { /* ignore */ }
    setFrom(p)
    return null
  }
  const keys = (list: Place[], onPick: (p: Place) => void) => (e: React.KeyboardEvent) => {
    const n = Math.min(list.length, limit)
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(n - 1, h + 1)); document.getElementById(`opt-${Math.min(n - 1, hi + 1)}`)?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); document.getElementById(`opt-${Math.max(0, hi - 1)}`)?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'Enter' && list[hi]) { e.preventDefault(); onPick(list[hi]) }
  }

  // ---------- what each screen shows ----------
  const browseMap: MapProps = { building: b, floor, here: start && start.level === floor ? start.node : null, pin: dest && dest.level === floor ? { node: dest.node, label: dest.title } : null }
  let map: MapProps = browseMap
  let threeD: ReactNode = null
  let top: ReactNode = null // under the search bar (chips, the dark instruction)
  let sheet: ReactNode = null // the card / sheet at the bottom (phones) or in the column (desktop)
  let tall = false // picker sheets: most of the screen on phones
  let bar: 'trip' | 'campus' = 'campus'
  const chips = (on?: Kind) => <div className="sx-chips" role="group" aria-label="Nearby">{(['toilet', 'stairs', 'lift'] as Kind[]).map(k => <button key={k} className={on === k ? 'on' : ''} aria-pressed={on === k} onClick={() => toggleHi(k)}>{KIND_NAME[k]}</button>)}</div>

  // Handover 1: both endpoints live in one card, on the home screen and on the route preview. Dot = start,
  // pin = destination, a dotted connector ties them together. Each row is its own target and opens its own picker.
  const tripRow = (kind: 'from' | 'to', title: string, place: Place | null, placeholder: string, onClick: () => void) =>
    <button className={`sx-trip-row ${kind}`} onClick={onClick} aria-label={`${title} ${place ? place.title : placeholder}. Change`}>
      <i className={kind === 'from' ? 'sx-trip-dot' : 'sx-trip-pin'} aria-hidden />
      <span className="sx-trip-txt"><small>{title}</small><b className={place ? undefined : 'ph'}>{place ? `${place.title} · ${L(place.level)}` : placeholder}</b></span>
    </button>
  const tripCard = <section className="sx-trip" aria-label="Your trip">
    <div className="sx-trip-rows">
      {tripRow('from', 'Where are you?', start, 'Set your starting point', () => openPicker('where'))}
      {tripRow('to', 'Where to?', dest, 'Choose a destination', () => openPicker('find'))}
    </div>
    <button className="sx-trip-swap" onClick={swapEnds} disabled={!start || !dest} aria-label="Swap start and destination"><SwapIcon /></button>
  </section>

  switch (screen) {
    case 'explore': {
      bar = 'trip'; top = chips(hiKind ?? undefined)
      if (hiKind) { const ids = nodesOfKind(hiKind); map = { ...browseMap, highlight: { kind: hiKind, nodes: ids } } }
      const hiHere = hiKind ? nodesOfKind(hiKind).filter(id => node(id).level === floor).length : 0
      // the bottom card is gone (handover 1); what is left is the one short line of status
      sheet = <p className="sx-note">{hiKind ? `${hiHere} ${KIND_NAME[hiKind].toLowerCase()} on ${L(floor)}${hiHere ? '' : ' (none here)'}` : confirmed && start ? 'Starting point confirmed' : start ? `Last confirmed at ${start.title}` : 'Set a start, then choose where to go'}</p>
    } break

    case 'where': case 'find': {
      const isFrom = screen === 'where'
      const typing = !!query.trim()
      const mark = (p: Place) => (isFrom ? (dest && !reach(p, dest) ? `No route to ${dest.title}` : undefined) : (start && !reach(start, p) ? 'No route from your start' : undefined))
      const rank = (p: Place) => (mark(p) ? 10 : 0) + ({ entrance: 0, lift: 3, toilet: 2, stairs: 3, food: 1, library: 1, lecture: 1, room: 1 })[p.kind] + (/lobby|entrance/i.test(p.title) ? -1 : 0)
      const here = placesAt(hasBlocks ? block : '', floor).filter(p => (!isFrom || p.startingPoint) && p.kind !== 'lift' && p.kind !== 'stairs')
        .sort((x, y) => rank(x) - rank(y) || x.title.localeCompare(y.title, undefined, { numeric: true }))
      const cur = isFrom ? start : dest
      const shortcuts = isFrom ? [] : recent.filter(p => p.id !== dest?.id && (p.level !== floor || (hasBlocks && p.block !== block)))
      const list = typing ? results.filter(p => !isFrom || p.startingPoint) : here
      const pick = isFrom ? setFrom : setTo
      const subOf = (p: Place) => [p.code, typing ? L(p.level) : '', walkLabel(p), mark(p) ?? (cur?.id === p.id ? (isFrom ? 'Current start' : 'Current destination') : p.type !== 'Room' ? p.type : '')].filter(Boolean).join(' · ') || L(p.level)
      // Handover 2: several places with the same name on one level read as one destination. They collapse into a
      // single row that expands, the main entrance is named where the data shows one, and every room keeps its own
      // searchable id underneath.
      const baseName = (p: Place) => p.title.replace(/\s+([A-Z]|\d{1,2})$/, '').trim()
      const groups = new Map<string, Place[]>()
      for (const q of list) { const k = `${baseName(q)}|${q.block}|${q.level}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(q) }
      type Row = { group: string; base: string; members: Place[] } | { place: Place }
      const rows: Row[] = []
      const done = new Set<string>()
      for (const q of list) {
        const k = `${baseName(q)}|${q.block}|${q.level}`
        const g = groups.get(k)!
        if (g.length < 3) { rows.push({ place: q }); continue }
        if (done.has(k)) continue
        done.add(k); rows.push({ group: k, base: baseName(q), members: g })
      }
      const shown = rows.slice(0, limit)
      const groupSub = (g: Place[]) => `${g.length} places · ${hasBlocks && g[0].block ? `${blockName(g[0].block)} · ` : ''}${L(g[0].level)}`
      const isEntrance = (q: Place) => /lobby|entrance|main/i.test(`${q.title} ${q.type}`)
      // the arrow keys walk the rows a person can see, so a group counts as one stop; Enter on a group takes its
      // main entrance, which is the row named first when it opens
      const flat = rows.map(r => 'place' in r ? r.place : [...r.members].sort((x, y) => Number(isEntrance(y)) - Number(isEntrance(x)))[0])
      tall = true; map = { ...browseMap, focus: cur && cur.level === floor ? [cur.node] : undefined }
      sheet = <>
        {typing
          ? <div className="sx-head sx-head-sm"><div><h2>{isFrom ? 'Where are you?' : 'Where to?'}</h2></div><button className="sx-x" onClick={back} aria-label="Close"><CloseIcon /></button></div>
          : <Head title={isFrom ? 'Where are you?' : 'Where to?'} sub={'Pick a room. Building and level are remembered.'} onClose={back} />}
        {!typing && <div className="sx-filters">
          {hasBlocks && <button onClick={() => go('blocks')} aria-label={`Building: ${block ? blockName(block) : 'all'}. Change`}>{block ? blockName(block) : 'All buildings'}<Caret /></button>}
          <button onClick={() => go('levels')} aria-label={`Level: ${L(floor)}. Change`}>{L(floor)}<Caret /></button>
        </div>}
        <label className="sx-search"><SearchIcon />
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={keys(flat, pick)} placeholder="Search rooms, codes or facilities" aria-label="Search rooms"
            role="combobox" aria-expanded={typing && rows.length > 0} aria-controls="results" aria-autocomplete="list" aria-activedescendant={typing && list.length ? `opt-${hi}` : undefined} enterKeyHint="go" autoFocus />
          {query && <button className="sx-clear" onClick={() => setQuery('')} aria-label="Clear search"><CloseIcon /></button>}
        </label>
        {isFrom && qrSupported && !typing && <button className="sx-link" onClick={() => go('qr')}>Scan a QR checkpoint instead</button>}
        <div className="sx-list scroll" role={typing ? 'listbox' : undefined} id="results" aria-label={typing ? 'Results' : undefined}>
          <span className="sx-sect" role="status" aria-live="polite">{typing ? `${list.length} result${list.length === 1 ? '' : 's'}` : `${hasBlocks && block ? `${block} · ` : ''}${L(floor)} · ${here.length} place${here.length === 1 ? '' : 's'}`}</span>
          {!typing && cur && (cur.level !== floor || (hasBlocks && !!block && cur.block !== block)) && <Item title={`${cur.title} · ${L(cur.level)}`} sub={isFrom ? 'Current start' : 'Current destination'} sel onClick={() => pick(cur)} />}
          {!typing && shortcuts.map(p => <Item key={`r-${p.id}`} title={`${p.title} · ${L(p.level)}`} sub="Recent destination · skip filters" onClick={() => pick(p)} />)}
          {shown.map((r, i) => 'place' in r
            ? <Item key={r.place.id} id={typing ? `opt-${i}` : undefined} option={typing} title={r.place.title} sub={subOf(r.place)} sel={cur?.id === r.place.id || (typing && i === hi)} dim={!!mark(r.place)} onClick={() => pick(r.place)} />
            : <div key={r.group} className="sx-group">
              <Item title={r.base} sub={groupSub(r.members)} onClick={() => setOpenGroups(o => o.includes(r.group) ? o.filter(k => k !== r.group) : [...o, r.group])} />
              {openGroups.includes(r.group) && <div className="sx-group-kids">
                {[...r.members].sort((x, y) => Number(isEntrance(y)) - Number(isEntrance(x))).map(q =>
                  <Item key={q.id} title={q.title} sub={[isEntrance(q) ? 'Main entrance' : '', subOf(q)].filter(Boolean).join(' · ')} sel={cur?.id === q.id} dim={!!mark(q)} onClick={() => pick(q)} />)}
              </div>}
            </div>)}
          {rows.length > limit && <button className="sx-more" onClick={() => setLimit(l => l + PAGE)}>Show more ({rows.length - limit} left)</button>}
          {typing && !list.length && dq.trim() === query.trim() && <div className="sx-empty" role="status">
            <p>No places match "{query.trim()}".</p>
            {suggest(query) ? <button className="sx-link" onClick={() => setQuery(suggest(query)!)}>Did you mean "{suggest(query)}"?</button>
              : <p>Try a room code like W1-01-08, or a word like toilet.</p>}
            <button className="sx-link" onClick={() => setQuery('')}>Clear search</button>
          </div>}
          {!typing && !here.length && <p className="sx-empty">No {isFrom ? 'starting points' : 'places'} on this level. Choose another level.</p>}
        </div>
        <p className="sx-hint">{isFrom ? (nearKind && !dest ? `Tap a place to find the nearest ${KIND_NAME[nearKind].toLowerCase()}.` : dest ? 'Tap a place to preview your route.' : 'Tap a place to set your start.') : 'Tap a place to preview your route.'}</p>
      </>
    } break

    case 'blocks': {
      tall = true
      sheet = <>
        <Head title={'Choose a building'} sub={"Choose once. We'll keep it for your next trip."} onClose={back} />
        <div className="sx-list scroll">
          {P.blocks.map(bl => { const n = levelsIn(bl).length; return <Item key={bl} title={blockName(bl)} sub={`${bl === (start?.block ?? '') ? 'Current building · ' : ''}${n} level${n === 1 ? '' : 's'}`} sel={bl === block} onClick={() => { setBlock(bl); const ls = levelsIn(bl); if (!ls.includes(floor)) setFloor(ls[0] ?? 0); back() }} /> })}
        </div>
        <p className="sx-hint">Building → Level → Room</p>
      </>
    } break

    case 'levels': {
      tall = true
      const bl = hasBlocks && (stack.includes('where') || stack.includes('find')) ? block : ''
      const ls = levelsIn(bl)
      sheet = <>
        <Head title={'Choose a level'} sub={bl ? blockName(bl) : b.name} onClose={back} />
        <div className="sx-list scroll">
          {[...ls].reverse().map(i => <Item key={i} title={L(i)} sub={levelBlurb(bl, i)} sel={i === floor} onClick={() => { setFloor(i); back() }} />)}
        </div>
        <p className="sx-hint">{stack.includes('where') || stack.includes('find') ? 'Your room list updates to this level.' : 'The map shows this level.'}</p>
      </>
    } break

    case 'qr': {
      tall = true
      sheet = <>
        <Head title={'Scan a checkpoint'} sub={'Find a WayForge QR sign nearby.'} onClose={back} />
        <QrScanner onCode={fromQr} />
        <p className="sx-hint">We'll set that place as your start.</p>
      </>
    } break

    case 'routes': {
      bar = 'trip'
      const s = routes?.shortest, f = routes?.stepfree
      const cut = !!start && !!dest && !reach(start, dest)
      if (picked && legs.length) {
        map = { building: b, floor: start!.level, lines: legs.filter(l => l.kind === 'walk' && l.level === start!.level).map(l => l.nodes), here: start!.node, focus: legs[0].nodes, pin: legs[0].kind === 'walk' ? { node: legs[0].nodes[legs[0].nodes.length - 1], label: legEnd(legs[0]) } : null, vertical: verticals() }
        threeD = view3d()
      } else if (start) map = { building: b, floor: start.level, here: start.node, focus: [start.node] }
      sheet = <div className="sx-card">
        <Head title={dest?.title ?? 'Route'} sub={start && dest ? `From ${start.title} · ${dest.level !== start.level ? 'to ' : ''}${L(dest.level)}` : undefined} onClose={home} closeLabel={'Close route'} />
        {cut ? <p className="sx-red">This room isn't joined to {start!.title}'s part of the map yet. Try a different start.</p>
          : !picked ? <p className="sx-red">No route found between these places.</p>
          : <div className="sx-seg" role="group" aria-label="Route">
            {routes?.same ? <button className="on" aria-pressed>{optionLabel(s, false)}</button>
              : <><button className={choice === 'shortest' ? 'on' : ''} aria-pressed={choice === 'shortest'} disabled={!s} onClick={() => pickOption('shortest')}>{optionLabel(s, false)}</button>
                <button className={choice === 'stepfree' ? 'on' : ''} aria-pressed={choice === 'stepfree'} disabled={!f} onClick={() => pickOption('stepfree')}>{optionLabel(f, true)}</button></>}
          </div>}
        {/* a step-free route never quietly becomes a stairs route: if there is none, the app says so (handover 3) */}
        {picked && !routes?.same && !f && <p className="sx-note sx-inline">No step-free route is available between these two places. The route shown uses stairs.</p>}
        {picked && detourLine(picked) && <p className="sx-note sx-inline">{detourLine(picked)}</p>}
        {(previewOpen || desktop) && !!legs.length && <ol className="sx-steps scroll" aria-label="Every step of this route">
          {legs.flatMap((l, i) => l.kind === 'walk'
            ? stepsOf(l).map((st, j) => <li key={`${i}-${j}`}>{stepIcon(st)}<span>{turnText(st)}</span></li>)
            : [<li key={i}><Up /><span>{l.kind === 'lift' ? `Take the lift to ${L(l.to)}` : `Take the stairs to ${L(l.to)}`}</span></li>])}
        </ol>}
        <div className="sx-row">
          {!desktop && <button className="sx-btn plain" onClick={() => setPreviewOpen(o => !o)} aria-expanded={previewOpen} disabled={!picked || !legs.length}>{previewOpen ? 'Hide steps' : 'Preview route'}</button>}
          <button className="sx-btn red" onClick={startGuide} disabled={!picked || !legs.length}>Start navigation →</button>
        </div>
      </div>
    } break

    case 'guide': {
      if (!leg || !dest) {
        const same = !!picked && picked.r.nodes.length <= 1
        sheet = <div className="sx-card"><Head title={same ? "You're already here." : 'No route found'} sub={same && dest ? `${dest.title} · ${L(dest.level)}` : 'These two places are not connected in the map.'} /><button className="sx-btn red" onClick={same ? finish : back}>{same ? 'Done ✓' : 'Back'}</button></div>
        break
      }
      const t = instruction(li)
      const turns = leg.kind === 'walk' ? stepsOf(leg) : []
      const final = leg.kind === 'walk' && (leg.final || li === legs.length - 1)
      map = legMap(li); threeD = view3d(li)
      top = <section className="sx-banner" aria-live="polite">
        <button className="sx-banner-main" onClick={() => turns.length > 1 && setTurnsOpen(o => !o)} aria-expanded={turns.length > 1 ? turnsOpen : undefined} disabled={turns.length <= 1}>
          <span className="sx-banner-ico">{t.icon}</span><span className="sx-banner-txt"><b>{t.title}</b><small>{t.sub}</small></span>
          {turns.length > 1 && <span className={`sx-banner-more${turnsOpen ? ' open' : ''}`} aria-label="Turn by turn"><Caret /></span>}
        </button>
        {turnsOpen && <ul className="sx-turns">{turns.map((s, j) => <li key={j}>{stepIcon(s)}<span>{turnText(s)}</span></li>)}</ul>}
      </section>
      sheet = <div className="sx-card">
        <div className="sx-head"><div><h2>{final && legs.length > 1 ? 'Almost there' : dest.title}</h2><p>Step {li + 1} of {legs.length} · {!routes?.same && choice === 'stepfree' ? 'Step-free' : 'Shortest route'}</p></div><button className="sx-btn grey sm" onClick={pauseTrip}>Pause</button></div>
        <button className="sx-btn red" onClick={nextLeg}>{confirmLabel(li)}</button>
        <button className="sx-link" onClick={() => setAsking(true)}>End trip</button>
      </div>
    } break

    case 'paused': {
      // Handover 4: pausing keeps the exact step, both endpoints and the route preference. Resume returns to that
      // step; ending the trip asks first and then goes back to the preview, not to a blank map.
      map = legMap(li)
      sheet = <div className="sx-card">
        <Head title={'Paused'} sub={dest ? `Step ${li + 1} of ${legs.length} · ${dest.title} · ${!routes?.same && choice === 'stepfree' ? 'Step-free' : 'Shortest route'}` : undefined} />
        <p className="sx-note sx-inline">Your place in the route is kept. Resume picks up at the same step.</p>
        <div className="sx-row">
          <button className="sx-btn grey" onClick={() => setAsking(true)}>End trip</button>
          <button className="sx-btn red" onClick={resumeTrip}>Resume →</button>
        </div>
        <button className="sx-link" onClick={() => { setTripOpen(false); openPicker('where') }}>I'm lost · update my location</button>
      </div>
    } break

    case 'arrived': {
      if (dest) map = { building: b, floor: dest.level, pin: { node: dest.node, label: dest.title }, here: dest.node, focus: [dest.node] }
      sheet = <div className="sx-card">
        <Head title={"You've arrived"} sub={dest ? [dest.title, L(dest.level), dest.code].filter(Boolean).join(' · ') : undefined} />
        <div className="sx-row">
          {/* swaps the endpoint ids and works a fresh route out, rather than playing this one backwards */}
          <button className="sx-btn grey" onClick={swapEnds} disabled={!start || !dest}>Navigate back</button>
          <button className="sx-btn red" onClick={finish}>Done ✓</button>
        </div>
      </div>
    } break

    case 'nearby': {
      const kind = near?.kind ?? nearKind ?? 'toilet'
      top = chips(kind)
      // the markers of that kind stay lit on the map, behind the card (handover 5: map markers are secondary)
      if (near) map = { building: b, floor: near.level, here: start && start.level === near.level ? start.node : null, pin: { node: near.node, label: near.title }, focus: start && start.level === near.level ? [start.node, near.node] : [near.node], highlight: { kind, nodes: nodesOfKind(kind) } }
      // The card names where the facility is and what the walk costs. Nothing is hardcoded: the count is whatever
      // this building's data actually contains, and a facility on another floor says so rather than implying it is here.
      const facilitySub = (n: Near) => [n.place?.block ? blockName(n.place.block) : '', L(n.level), `${Math.round(walkMetres(toLegs(b, n.route)))} m`, `${n.route.minutes} min`].filter(Boolean).join(' · ')
      const sameFloor = near && start && near.level === start.level
      const others = nearList.filter(n => n.node !== near?.node)
      sheet = <div className="sx-card">
        <Head title={near ? near.title : `No ${KIND_NAME[kind].toLowerCase()} reachable`}
          sub={near ? facilitySub(near) : start ? `Nothing of this kind can be reached from ${start.title}.` : undefined} onClose={home} />
        {near && <p className="sx-note sx-inline">{sameFloor ? `Closest by walking distance · on ${L(near.level)} with you`
          : `Closest by walking distance · ${near.level > (start?.level ?? 0) ? 'up' : 'down'} to ${L(near.level)}${near.place?.block ? ` in ${blockName(near.place.block)}` : ''}`}</p>}
        {near && <button className="sx-btn red" onClick={() => go('nearroute')}>Go →</button>}
        {!!others.length && <>
          <span className="sx-sect" role="status" aria-live="polite">{nearList.length} reachable · others</span>
          <div className="sx-list scroll sx-list-sm">
            {others.map(n => <Item key={n.node} title={n.title} sub={facilitySub(n)} onClick={() => { setNear(n); setFloor(n.level) }} />)}
          </div>
        </>}
      </div>
    } break

    case 'nearroute': {
      top = chips(near?.kind)
      if (near && start) {
        const nl = toLegs(b, near.route)
        const lvl = start.level
        // the person's own dot and the facility both stay on screen (handover 5)
        map = { building: b, floor: lvl, lines: nl.filter(l => l.kind === 'walk' && l.level === lvl).map(l => l.nodes), here: start.node, pin: near.level === lvl ? { node: near.node, label: near.title } : null, focus: nl.filter(l => l.kind === 'walk' && l.level === lvl).flatMap(l => l.nodes), highlight: { kind: near.kind, nodes: nodesOfKind(near.kind) } }
        const multi = near.level !== lvl
        sheet = <div className="sx-card">
          <Head title={near.title} sub={`${Math.round(walkMetres(nl))} m · ${near.route.minutes} min · ${L(near.level)}`} onClose={back} />
          <p className="sx-note sx-inline">{multi ? `Follow the line, then ${near.level > lvl ? 'up' : 'down'} to ${L(near.level)}.` : 'Follow the line along the corridor.'}</p>
          <div className="sx-row">
            {near.place && <button className="sx-btn plain" onClick={() => setTo(near.place!)}>Step by step</button>}
            {/* arriving at a facility makes it the confirmed location the next lookup starts from (handover 5) */}
            <button className="sx-btn red" onClick={() => { const p = near.place; if (p) { setStart(p); setConfirmed(true) } setNear(null); setNearList([]); setHiKind(null); setStack(['explore']) }}>I'm here ✓</button>
          </div>
        </div>
      }
    } break
  }

  // ---------- drawing ----------
  const onClickCapture = (e: React.MouseEvent) => { if ((e.target as Element).closest('button')) sound('tap') }
  // Handover 6: a screen reader hears the things that happen without being asked - a route being worked out again,
  // a scan landing, arrival, and anything that failed.
  const liveMsg = screen === 'arrived' && dest ? `Arrived at ${dest.title}.`
    : screen === 'paused' ? `Trip paused at step ${li + 1} of ${legs.length}.`
    : screen === 'routes' && picked ? `Route ready. ${optionLabel(picked, choice === 'stepfree')}.`
    : screen === 'routes' && start && dest ? 'No route between these places.'
    : screen === 'nearby' ? (near ? `Nearest ${KIND_NAME[near.kind].toLowerCase().replace(/s$/, '')}: ${near.title}, ${Math.round(near.metres)} metres.` : 'Nothing of that kind can be reached.')
    : screen === 'guide' && leg ? `Step ${li + 1} of ${legs.length}.`
    : ''
  const show3d = !!threeD && use3d && !no3d
  const mapFloor = map.floor
  const pad: MapProps['pad'] = desktop ? { l: padL } : { t: cover.t, b: cover.b }
  const barEl = bar === 'trip'
    ? tripCard
    : guiding
      ? <div className="sx-tripsum">
        <button className="sx-tripsum-main" onClick={() => setTripOpen(o => !o)} aria-expanded={tripOpen} aria-label="Your trip. Expand to change the start or destination">
          <i className="sx-trip-dot" aria-hidden /><span className="sx-tripsum-txt"><b>{dest ? dest.title : 'Your trip'}</b><small>{start ? `From ${start.title} · step ${li + 1} of ${Math.max(1, legs.length)}` : `Step ${li + 1} of ${Math.max(1, legs.length)}`}</small></span>
          <span className={`sx-tripsum-more${tripOpen ? ' open' : ''}`} aria-hidden><Caret /></span>
        </button>
        {tripOpen && tripCard}
      </div>
      : <div className="sx-barrow">
        <button className="sx-bar sx-campus" onClick={() => go('levels')} disabled={guiding} aria-label={`${b.name}, ${L(mapFloor)}${guiding ? '' : '. Change level'}`}>
          <span className="sx-w" aria-hidden>W</span><span><b>{b.name}</b><small>{[hasBlocks && (start?.block || block) ? blockName(start?.block || block) : '', L(mapFloor)].filter(Boolean).join(' · ')}{!guiding && <Caret />}</small></span>
        </button>
        <button className="sx-round" onClick={() => (guiding ? setAsking(true) : openPicker('find'))} aria-label={guiding ? 'Route options' : 'Search'}><SearchIcon /></button>
      </div>
  const mapLayer = show3d
    ? <div className="sx-r3d" style={desktop ? { left: padL } : { top: cover.t, bottom: cover.b }}>{threeD}</div>
    : <MapView {...map} pad={pad} names={P.names} topDown={map.topDown ?? flat} onTopDown={setFlat} onPick={['explore', 'where', 'find'].includes(screen) ? pickOnMap : undefined} />
  const fixedFloor = guiding || screen === 'routes' || screen === 'arrived' || screen === 'nearby' || screen === 'nearroute'
  const side = (
    <div className="sx-side" style={desktop ? undefined : { top: cover.t + 12 }}>
      {!show3d && <button className="sx-floor" onClick={() => go('levels')} disabled={fixedFloor} aria-label={`${L(mapFloor)}${fixedFloor ? '' : '. Change level'}`}>{Lshort(mapFloor)}</button>}
      {threeD && !no3d && <button className="sx-pill" onClick={() => setUse3d(!show3d)} aria-label={show3d ? 'Show the map' : 'Show the 3D walk-through'}>{show3d ? 'Map' : '3D'}</button>}
    </div>
  )
  const endSheet = asking && <>
    <div className="sx-dim" onClick={() => setAsking(false)} aria-hidden />
    <section className="sx-sheet sx-modal" role="dialog" aria-modal="true" aria-labelledby="end-t">
      <i className="sx-grab" aria-hidden />
      <div className="sx-head"><div><h1 id="end-t">End this route?</h1><p>Your start and destination will stay in the route planner.</p></div></div>
      <div className="sx-row"><button className="sx-btn red" onClick={() => setAsking(false)} autoFocus>Keep going</button><button className="sx-btn grey" onClick={endRoute}>End route</button></div>
      <button className="sx-link" onClick={() => { setAsking(false); openPicker('where') }}>Lost? Update my location</button>
    </section>
  </>

  return (
    <div className={`sx ${desktop ? 'sx-desk' : 'sx-phone'}${spanned ? ' spanned' : ''}${show3d ? ' is-3d' : ''}`} style={{ '--col': `${colW}px`, '--sx-ctl': `${(desktop ? 16 : cover.t + 12) + 60 + (threeD && !no3d ? 44 : 0)}px`, '--sx-bot': `${desktop ? 16 : cover.b + 12}px`, '--sx-kb': `${desktop ? 0 : kb}px` } as React.CSSProperties} onClickCapture={onClickCapture}>
      <p className="sx-sr" role="status" aria-live="polite">{liveMsg}</p>
      <div className="sx-map">{mapLayer}</div>
      {!guiding && <div className="sx-brand" aria-hidden style={desktop || tall ? undefined : { bottom: cover.b + 14 }}>
        <img className="sx-brand-mark" src={`${import.meta.env.BASE_URL}logo.svg`} alt="" width="34" height="20" />
        <span><b>WayForge</b><small>{b.name}</small></span>
      </div>}
      <div className="sx-top" ref={topRef}>{barEl}{top}</div>
      {side}
      <div className={`sx-bottom${tall ? ' tall' : ''}`} ref={botRef}>
        {tall ? <section className="sx-sheet" aria-label="Picker"><i className="sx-grab" aria-hidden />{sheet}</section> : sheet}
      </div>
      {endSheet}
    </div>
  )
}
