// WayForge Navigator, layouts from Wayforge_SIT (desktop web) and Wayforge_SIT_1 (mobile).
// Each screen is described once (title, panel content, actions, map) and drawn by
// the desktop/tablet layout (top nav + side panel + large map) or the phone layout
// (header + map card + actions). Following a route has its own look (navigation mode) on both.
// Place names, search and directions come from places.ts / route.ts; the data itself is never changed.
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Building } from './types'
import { loadBuilding } from './api'
import { toLegs, walkMetres } from './legs'
import type { Leg } from './legs'
import { buildPlaces, components, placeSub, searchPlaces } from './places'
import type { Place } from './places'
import { landmarkFinder, planRoute, routeSummary, sameRoute, verticalNames, walkSteps } from './route'
import type { Step } from './route'
import MapView from './MapView'
import type { MapProps } from './MapView'

type Screen = 'explore' | 'find' | 'where' | 'qr' | 'routes' | 'guide' | 'arrived' | 'saved' | 'prefs' | 'lost' | 'help'
type Tab = 'explore' | 'saved' | 'prefs' | 'help'
const TAB_OF: Record<Screen, Tab> = { explore: 'explore', find: 'explore', where: 'explore', qr: 'explore', routes: 'explore', guide: 'explore', arrived: 'explore', lost: 'explore', saved: 'saved', prefs: 'prefs', help: 'help' }
const TAB_NAME: Record<Tab, string> = { explore: 'Explore', saved: 'Saved', prefs: 'Settings', help: 'Help' }

// storage (can throw in private mode)
const pref = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } } }
const sound = (name: string) => { try { const a = new Audio(`${import.meta.env.BASE_URL}audio/${name}.wav`); a.volume = 0.5; void a.play().catch(() => {}) } catch { /* ignore */ } }
const PAGE = 40
type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
const qrSupported = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

// ---------- small UI pieces ----------
const ic = { className: 'ico', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
const PinIcon = () => <svg {...ic}><path d="M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
const Arrow = ({ d }: { d: 'up' | 'down' | 'left' | 'right' }) => <svg {...ic}>{d === 'right' ? <path d="M5 12h13m-5-5 5 5-5 5" /> : d === 'left' ? <path d="M19 12H6m5-5-5 5 5 5" /> : d === 'up' ? <path d="M12 20V5m-6 6 6-6 6 6" /> : <path d="M12 4v15m-6-6 6 6 6-6" />}</svg>
const TurnL = () => <svg {...ic}><path d="M16 20v-7a3 3 0 0 0-3-3H6m4-4-4 4 4 4" /></svg>
const TurnR = () => <svg {...ic}><path d="M8 20v-7a3 3 0 0 1 3-3h7m-4-4 4 4-4 4" /></svg>
const Stairs = () => <svg {...ic}><path d="M4 19h4v-4h4v-4h4V7h4" /></svg>
const Lift = () => <svg {...ic}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m9 9 3-3 3 3M9 15l3 3 3-3" /></svg>
const Check = () => <svg {...ic} strokeWidth={2.2}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
const Bookmark = ({ on }: { on?: boolean }) => <svg {...ic} fill={on ? 'currentColor' : 'none'}><path d="M6 3.5h12v17l-6-4.2-6 4.2z" /></svg>
const SearchIcon = () => <svg {...ic}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
const ToiletIcon = () => <svg {...ic}><circle cx="8" cy="5" r="1.8" /><circle cx="16" cy="5" r="1.8" /><path d="M8 8.5v12M5.5 9h5v6h-5zM16 8.5l-3 7h6zM16 15.5v5" /></svg>
const FoodIcon = () => <svg {...ic}><path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 21V3c-2.5 1.5-3.5 4-3.5 7.5h3.5" /></svg>
const BookIcon = () => <svg {...ic}><path d="M3.5 5.5c3-1 6-1 8.5.8 2.5-1.8 5.5-1.8 8.5-.8v13c-3-1-6-1-8.5.8-2.5-1.8-5.5-1.8-8.5-.8zM12 6.3v13.3" /></svg>
const DoorIcon = () => <svg {...ic}><path d="M6 21V4.5L14 3v18M6 21h12V6h-4M11 12h.01" /></svg>
const RouteIcon = () => <svg {...ic}><circle cx="6" cy="18" r="2" /><circle cx="18" cy="6" r="2" /><path d="M8 18h6.5a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7H16" /></svg>
const MenuIcon = () => <svg {...ic}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
const CloseIcon = () => <svg {...ic}><path d="m6 6 12 12M18 6 6 18" /></svg>
const Logo = () => <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" aria-hidden><path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z" /><path d="M9 4v13.5M15 6.5V20" /></svg>
const stepIcon = (s: Step) => s.turn === 'left' ? <TurnL /> : s.turn === 'right' ? <TurnR /> : s.turn === 'arrive' ? <PinIcon /> : <Arrow d="up" />

function Field({ label, value, onClick, children }: { label: string; value?: string; onClick?: () => void; children?: ReactNode }) {
  const inner = <><span className="f-label">{label}</span>{children ?? <span className="f-value">{value}</span>}</>
  return onClick ? <button className="field" onClick={onClick}>{inner}</button> : <div className="field">{inner}</div>
}
type RowProps = { title: string; sub: string; onClick?: () => void; selected?: boolean; icon?: ReactNode; saved?: boolean; onSave?: () => void; onClear?: () => void; id?: string; option?: boolean; dim?: boolean }
function Row({ title, sub, onClick, selected, icon, saved, onSave, onClear, id, option, dim }: RowProps) {
  return (
    <div className={`place${selected ? ' sel' : ''}${dim ? ' dim' : ''}`} id={id} role={option ? 'option' : undefined} aria-selected={option ? !!selected : undefined}>
      <button className="place-main" onClick={onClick} disabled={!onClick} aria-pressed={option || !onClick ? undefined : !!selected} tabIndex={option ? -1 : undefined}>
        <span className="place-ico">{icon ?? <PinIcon />}</span><span><b>{title}</b><small>{sub}</small></span>
      </button>
      {onSave && <button className={`bm${saved ? ' on' : ''}`} onClick={onSave} aria-label={saved ? `Remove ${title} from saved` : `Save ${title}`} aria-pressed={!!saved}><Bookmark on={saved} /></button>}
      {onClear && <button className="bm clear" onClick={onClear} aria-label={`Clear ${title}`}><CloseIcon /></button>}
    </div>
  )
}
function Info({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className={`info${action ? ' with-action' : ''}`}><div><b>{title}</b><p>{children}</p></div>{action}</div>
}
function FloorSelect({ names, value, onChange, compact }: { names: string[]; value: number; onChange: (f: number) => void; compact?: boolean }) {
  return (
    <label className={`floor-select${compact ? ' compact' : ''}`}>
      {!compact && <span className="f-label">FLOOR</span>}
      <select value={value} onChange={e => onChange(Number(e.target.value))} aria-label="Floor">
        {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
      </select>
      <svg className="chev" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M7 10l5 5 5-5z" /></svg>
    </label>
  )
}
function Option({ title, sub, selected, onClick, icon }: { title: string; sub: string; selected?: boolean; onClick?: () => void; icon?: ReactNode }) {
  return <button className={`option${selected ? ' sel' : ''}`} onClick={onClick} aria-pressed={!!selected} disabled={!onClick}>{icon}<span><b>{title}</b><small>{sub}</small></span></button>
}
function Chips<T extends string | number>({ items, value, onChange, label }: { items: { v: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return <div className="chips" role="group" aria-label={label}>{items.map(i => <button key={String(i.v)} aria-pressed={i.v === value} className={i.v === value ? 'on' : ''} onClick={() => onChange(i.v)}>{i.label}</button>)}</div>
}
function SearchBox({ value, onChange, placeholder, label, count, active, onKey, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; count: number; active: number; onKey: (e: React.KeyboardEvent) => void; autoFocus?: boolean }) {
  return (
    <label className="searchbox"><SearchIcon />
      <input autoFocus={autoFocus} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKey} aria-label={label}
        role="combobox" aria-expanded={!!value.trim() && count > 0} aria-controls="results" aria-autocomplete="list" aria-activedescendant={value.trim() && count ? `opt-${active}` : undefined} enterKeyHint="go" />
      {value && <button className="clear-q" onClick={e => { e.preventDefault(); onChange('') }} aria-label="Clear search"><CloseIcon /></button>}
    </label>
  )
}

// camera + BarcodeDetector (Chrome on Android); the button is hidden where it can't work
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
    }).catch(() => setMsg("Camera not available. Allow camera access, or set your location manually."))
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()) }
  }, [])
  return <div className="camera live"><video ref={video} playsInline muted /><div className="frame-box"><span className="corners" /></div><p aria-live="polite">{msg}</p></div>
}

type Action = { label: string; onClick: () => void; kind?: 'pri' | 'sec'; disabled?: boolean; hint?: string }
type Spec = {
  eyebrow: string; title: string; sub?: string
  top?: ReactNode // mobile: above the map · desktop: in the panel
  body?: ReactNode // mobile: below the map · desktop: in the panel
  desk?: ReactNode // desktop panel only
  mobile?: ReactNode // mobile only (below the map)
  actions: Action[]; mobileActions?: Action[]
  map?: MapProps | null
  pane?: ReactNode // replaces the desktop map (QR camera)
  floorTabs?: boolean // floor picker on the desktop map (otherwise "ROUTE FLOOR Level n")
  hero?: { title: ReactNode; sub: string }
  tallMap?: boolean // mobile: give the map more height
  showMapOnMobile?: boolean
}

export default function App() {
  const [b, setB] = useState<Building | null>(null)
  const [err, setErr] = useState('')
  const [stack, setStack] = useState<Screen[]>(['explore'])
  const screen = stack[stack.length - 1]
  const [start, setStart] = useState<Place | null>(null)
  const [dest, setDest] = useState<Place | null>(null)
  const [choice, setChoice] = useState<'shortest' | 'stepfree'>(pref.get('wayforge.stepFree') === '1' ? 'stepfree' : 'shortest')
  const [legIdx, setLegIdx] = useState(0)
  const [floor, setFloor] = useState(0) // browsing floor (explore / find / where)
  const [query, setQuery] = useState('')
  const [startQuery, setStartQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [hi, setHi] = useState(0) // highlighted search result (arrow keys)
  const [pending, setPending] = useState<Place | null>(null) // start chosen on "Where are you?" (not yet confirmed)
  const [, bump] = useState(0)
  const [menu, setMenu] = useState(false) // mobile hamburger drawer
  const [flat, setFlatState] = useState(pref.get('wayforge.topDown') === '1') // 2D map instead of 3D
  const setFlat = useCallback((v: boolean) => { setFlatState(v); pref.set('wayforge.topDown', v ? '1' : '0') }, [])
  const dq = useDeferredValue(query) // typing stays smooth, the list catches up
  const dsq = useDeferredValue(startQuery)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => { loadBuilding().then(setB).catch(e => setErr(String(e))) }, [])
  // web app manifest (the page already asks iOS to run it as a home-screen app)
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
    return { places, visible, byNode, vnames, names, comp, main, landmark: landmarkFinder(places, nodeIndex) }
  }, [b, nodeIndex])

  // ---------- navigation mode: keep the screen on and buzz once at the start (Android) ----------
  const guiding = screen === 'guide'
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
    const f = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', f); return () => window.removeEventListener('resize', f)
  }, [])
  const first = useRef(true)
  useEffect(() => {
    document.querySelectorAll('.scroll').forEach(el => { el.scrollTop = 0 })
    if (first.current) { first.current = false; return }
    sound(screen === 'arrived' ? 'arrive' : 'screen')
  }, [screen])
  const backRef = useRef<() => void>(() => {})
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement && e.target.value)) { setMenu(false); backRef.current() } }
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
    if (from) { setStart(from); setFloor(from.level) }
    if (to) { setDest(to); setFloor(to.level) }
    if (to && from) { setStack(step > 0 ? ['explore', 'routes', 'guide'] : ['explore', 'routes']); setLegIdx(Math.max(0, step - 1)) }
    else if (to || from) setStack(['explore', 'find'])
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

  // both route options (shortest / step-free); one card when they're the same route
  const routes = useMemo(() => {
    if (!b || !start || !dest) return null
    const mk = (sf: boolean) => { const r = planRoute(b, nodeIndex, start.node, dest.node, sf); return r ? { r, legs: toLegs(b, r) } : null }
    const shortest = mk(false), stepfree = mk(true)
    return { shortest, stepfree, same: sameRoute(shortest?.r, stepfree?.r) }
  }, [b, nodeIndex, start, dest])

  const desktop = vp.w >= 768 && vp.h >= 500 // tablets get the side-panel layout too
  const tablet = desktop && vp.w < 1180

  // search results (destination and start)
  const near = start ? nodeIndex.get(start.node) ?? null : null
  const results = useMemo(() => (P && dq.trim() ? searchPlaces(P.visible, dq, nodeIndex, near) : []), [P, dq, nodeIndex, near])
  const startResults = useMemo(() => (P && dsq.trim() ? searchPlaces(P.visible, dsq, nodeIndex, dest ? nodeIndex.get(dest.node) : null) : []), [P, dsq, nodeIndex, dest])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- latest-value ref / one-off sync, intentional
  useEffect(() => { setLimit(PAGE); setHi(0) }, [dq, dsq, screen])

  if (err || !b || !P) return <div className="loading" role="status">{err ? `Couldn't load the building. ${err}` : <><span className="spinner" />Loading the campus map…</>}</div>

  // ---------- helpers ----------
  const node = (id: string) => nodeIndex.get(id)!
  const L = (i: number) => b.levels[i]?.name ?? `Level ${i + 1}`
  const sub = (p: Place, extra?: string) => placeSub(p, L(p.level), extra)
  const saveKey = (p: Place) => `wayforge.saved.${b.id}.${p.id}`
  const isSaved = (p: Place | null) => !!p && pref.get(saveKey(p)) === '1'
  const toggleSave = (p: Place) => { pref.set(saveKey(p), isSaved(p) ? '0' : '1'); bump(x => x + 1) }
  const reach = (a: Place | null, c: Place | null) => !a || !c || P.comp.get(a.node) === P.comp.get(c.node)
  const placesOn = (f: number) => P.visible.filter(p => p.level === f)
  const zone = (f: number) => { const n = placesOn(f).filter(p => p.kind !== 'lift' && p.kind !== 'stairs').length; return `${n} place${n === 1 ? '' : 's'}` }
  const vname = (id: string) => P.vnames.get(id) ?? P.byNode.get(id)?.title ?? node(id).label
  const levelChips = (v: number, on: (f: number) => void, short?: boolean) => short && b.levels.length <= 5
    ? <Chips label="Floor" value={v} onChange={on} items={b.levels.map((_, i) => ({ v: i, label: `L${i + 1}` }))} />
    : <FloorSelect names={b.levels.map(l => l.name)} value={v} onChange={on} compact={short} />
  const saveBtn = (p: Place) => ({ saved: isSaved(p), onSave: () => toggleSave(p) })
  const placeIcon = (p: Place) => ({ toilet: <ToiletIcon />, food: <FoodIcon />, library: <BookIcon />, lift: <Lift />, stairs: <Stairs />, entrance: <DoorIcon />, lecture: undefined, room: undefined })[p.kind]
  const pickOnMap = (id: string) => {
    const p = P.byNode.get(id)
    if (!p) return
    if (screen === 'where') { setPending(p); return }
    setDest(p); setQuery(''); if (screen !== 'find') go('find')
  }
  const mapEl = (m: MapProps, pick = false) => <MapView {...m} names={P.names} topDown={m.topDown ?? flat} onTopDown={setFlat} onPick={pick ? pickOnMap : undefined} />

  const go = (s: Screen) => setStack(st => [...st, s])
  const tab = (t: Tab) => setStack([t === 'explore' ? 'explore' : t])
  const back = () => {
    if (stack.length <= 1) return
    if (pushed.current > 0) window.history.back() // the popstate handler steps back (so phone Back and ‹ agree)
    else setStack(st => st.slice(0, -1))
  }
  // eslint-disable-next-line react-hooks/refs -- latest-value ref / one-off sync, intentional
  backRef.current = back

  const picked = routes ? (routes.same ? routes.shortest : routes[choice] ?? null) : null
  const legs: Leg[] = picked?.legs ?? []
  const li = Math.min(legIdx, Math.max(0, legs.length - 1))
  const leg = legs[li]
  const walkM = picked ? walkMetres(picked.legs) : 0
  const optSub = (o: typeof picked | undefined, sf: boolean) => (o ? routeSummary(o.legs, L, walkMetres(o.legs)) : sf ? 'No step-free route' : 'No route')
  const optTitle = (o: typeof picked | undefined, name: string) => (o ? `${name} · ${o.r.minutes} min` : name)

  // directions for each leg
  const legEnd = (l: Extract<Leg, { kind: 'walk' }>) => (l.final && dest ? dest.title : vname(l.nodes[l.nodes.length - 1]))
  const stepsOf = (l: Leg): Step[] => (l.kind === 'walk' ? walkSteps(nodeIndex, l.nodes, legEnd(l), P.landmark) : [])
  const legText = (l: Leg) => {
    if (l.kind === 'walk') {
      const mid = l.nodes[Math.floor(l.nodes.length / 2)], lm = l.nodes.length > 3 ? P.landmark(mid, [l.nodes[0], l.nodes[l.nodes.length - 1]]) : null
      return { icon: <Arrow d="up" />, title: `Walk to ${legEnd(l)}`, sub: `${Math.round(l.metres)} m${lm && lm.title !== legEnd(l) ? ` · past ${lm.title}` : ''}${l.final && dest?.code ? ` · room ${dest.code}` : ''}` }
    }
    const up = l.to > l.from, n = Math.abs(l.to - l.from)
    return l.kind === 'lift'
      ? { icon: <Lift />, title: `Take ${vname(l.nodes[0])} ${up ? 'up' : 'down'} to ${L(l.to)}`, sub: `Get out at ${L(l.to)} · check the floor sign` }
      : { icon: <Stairs />, title: `Take ${vname(l.nodes[0])} ${up ? 'up' : 'down'} to ${L(l.to)}`, sub: `${n} floor${n > 1 ? 's' : ''} ${up ? 'up' : 'down'} · check the ${L(l.to)} sign` }
  }
  const thenText = (i: number) => {
    const n = legs[i + 1]
    if (!n) return dest ? `you've arrived at ${dest.title}` : "you've arrived"
    if (n.kind === 'walk') return `walk to ${legEnd(n)}`
    return `${n.kind === 'lift' ? 'lift' : 'stairs'} ${n.to > n.from ? 'up' : 'down'} to ${L(n.to)}`
  }
  const confirmLabel = (i: number) => {
    const l = legs[i], n = legs[i + 1]
    if (!l) return 'Next'
    if (l.kind !== 'walk') return `I've reached ${L(l.to)}`
    if (l.final) return "I've arrived"
    return n?.kind === 'lift' ? "I'm at the lift" : "I'm at the stairs"
  }
  // what the map shows for a leg
  const legMap = (i: number): MapProps => {
    const l = legs[i]
    if (!l) return { building: b, floor }
    if (l.kind !== 'walk') {
      const prev = legs[i - 1]
      return { building: b, floor: l.from, lines: prev && prev.kind === 'walk' ? [prev.nodes] : [], here: l.nodes[0], focus: [l.nodes[0]] }
    }
    const end = l.nodes[l.nodes.length - 1]
    return { building: b, floor: l.level, lines: [l.nodes], here: l.nodes[0], pin: { node: end, label: legEnd(l) }, focus: l.nodes }
  }
  const stepList = (current?: number, compact?: boolean) => (
    <ol className="steps">
      {legs.map((l, i) => {
        const t = legText(l), cur = i === current
        return <li key={i} className={cur ? 'cur' : i < (current ?? -1) ? 'done' : ''} aria-current={cur ? 'step' : undefined}>
          <span className="n">{i < (current ?? -1) ? <Check /> : i + 1}</span>
          <div><b>{t.title}</b><small>{t.sub}</small>
            {(cur || !compact) && l.kind === 'walk' && <ul className="turns">{stepsOf(l).map((s, j) => <li key={j}>{stepIcon(s)}<span>{s.turn !== 'arrive' && s.metres > 2 ? `${s.metres} m, then ` : ''}{s.turn !== 'arrive' && s.metres > 2 ? s.text[0].toLowerCase() + s.text.slice(1) : s.text}</span></li>)}</ul>}
          </div>
        </li>
      })}
    </ol>
  )

  // ---------- navigation actions ----------
  const openWhere = () => { setPending(start); setStartQuery(''); setFloor(start ? start.level : dest ? dest.level : 0); go('where') }
  const planIt = () => { if (!dest) go('find'); else openWhere() }
  const confirmStart = () => {
    if (!pending) return
    setStart(pending); setLegIdx(0)
    setStack(st => {
      const wasGuiding = st.includes('guide')
      const base = st.filter(s => !['where', 'qr', 'lost', 'routes', 'guide', 'arrived'].includes(s)); const root: Screen[] = base.length ? base : ['explore']
      return dest ? (wasGuiding ? [...root, 'routes', 'guide'] : [...root, 'routes']) : root
    })
  }
  const startGuide = () => { setLegIdx(0); go('guide') }
  const nextLeg = () => { if (li + 1 >= legs.length) setStack(['explore', 'arrived']); else setLegIdx(li + 1) }
  const finish = () => { if (dest) setStart(dest); setDest(null); setStack(['explore']) }
  const endRoute = () => { if (window.confirm('End this route?')) setStack(st => st.filter(s => s !== 'guide' && s !== 'lost')) }
  const setDefault = (c: 'shortest' | 'stepfree') => { setChoice(c); pref.set('wayforge.stepFree', c === 'stepfree' ? '1' : '0') }
  const chooseDest = (p: Place) => { setDest(p); setFloor(p.level); setQuery('') }
  const fromQr = (text: string): string | null => {
    let key: string | null = text.trim()
    try { const u = new URL(key); key = u.searchParams.get('from') ?? u.searchParams.get('at') ?? u.searchParams.get('to') } catch { /* plain text code */ }
    const p = findPlace(key)
    if (!p) return "That isn't a WayForge checkpoint for this building. Try another code."
    setPending(p); setFloor(p.level)
    setStack(st => [...st.filter(s => s !== 'qr' && s !== 'where'), 'where'])
    try { navigator.vibrate?.(30) } catch { /* ignore */ }
    return null
  }

  // ---------- suggestions: nearest toilets, the Canteen, the Library ----------
  const suggestions = (() => {
    const here = start ? node(start.node) : null
    const far = (p: Place) => { const n = node(p.node); return here ? Math.hypot(n.pos[0] - here.pos[0], n.pos[1] - here.pos[1]) + Math.abs(n.level - here.level) * 60 : n.level * 1000 + n.pos[0] * 0.001 }
    const ok = (p: Place) => (start ? reach(start, p) : P.comp.get(p.node) === P.main)
    const best = (test: (p: Place) => boolean) => { let pick: Place | null = null, d = Infinity; for (const p of P.visible) if (test(p) && ok(p)) { const x = far(p); if (x < d) { d = x; pick = p } } return pick }
    const out: { p: Place; why?: string }[] = []
    const toilet = best(p => p.kind === 'toilet')
    if (toilet) out.push({ p: toilet, why: start ? 'Nearest' : undefined })
    const food = best(p => /^canteen\b/i.test(p.title)) ?? best(p => p.kind === 'food')
    if (food) out.push({ p: food })
    const lib = best(p => /^library$/i.test(p.title)) ?? best(p => p.kind === 'library')
    if (lib) out.push({ p: lib })
    for (const p of [...P.visible.filter(isSaved), ...P.visible]) { if (out.length >= 3) break; if (!out.some(o => o.p === p)) out.push({ p }) }
    return out.slice(0, 3)
  })()

  // result list with arrow keys / Enter (combobox)
  const resultList = (list: Place[], onPick: (p: Place) => void, mark: (p: Place) => string | undefined, selectedId?: string) => {
    const shown = list.slice(0, limit)
    return <div className="list" role="listbox" id="results" aria-label="Results">
      {shown.map((p, i) => <Row key={p.id} id={`opt-${i}`} option title={p.title} sub={sub(p, mark(p))} icon={placeIcon(p)} selected={i === hi || selectedId === p.id} dim={!!mark(p)?.startsWith('No route')} onClick={() => onPick(p)} {...saveBtn(p)} />)}
      {list.length > limit && <button className="more" onClick={() => setLimit(l => l + PAGE)}>Show more ({list.length - limit} left)</button>}
    </div>
  }
  const keys = (list: Place[], onPick: (p: Place) => void) => (e: React.KeyboardEvent) => {
    const n = Math.min(list.length, limit)
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(n - 1, h + 1)); document.getElementById(`opt-${Math.min(n - 1, hi + 1)}`)?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); document.getElementById(`opt-${Math.max(0, hi - 1)}`)?.scrollIntoView({ block: 'nearest' }) }
    else if (e.key === 'Enter' && list[hi]) { e.preventDefault(); onPick(list[hi]) }
  }
  const noMatch = <p className="muted" role="status">No matching places. Try a room code like W1-01-08, or a word like toilet or canteen.</p>

  let spec: Spec
  switch (screen) {
    case 'explore': spec = {
      eyebrow: 'EXPLORE THE BUILDING', title: 'Find your way.', sub: desktop ? "Choose a place. We'll help you get there." : b.name,
      top: <>
        {desktop && <Field label="FROM · YOUR START" value={start ? `${start.title} · ${L(start.level)}` : 'Set starting location'} onClick={openWhere} />}
        <Field label={desktop ? 'TO · DESTINATION' : 'DESTINATION'} value={dest ? `${dest.title} · ${L(dest.level)}` : 'Search rooms or facilities'} onClick={() => go('find')} />
        {!desktop && levelChips(floor, setFloor)}
      </>,
      desk: <>
        <span className="eyebrow muted">SUGGESTED</span>
        {suggestions.map(({ p, why }) => <Row key={p.id} title={p.title} sub={sub(p, why)} icon={placeIcon(p)} onClick={() => { chooseDest(p); go('find') }} {...saveBtn(p)} />)}
      </>,
      mobile: dest ? <Row title={dest.title} sub={sub(dest)} icon={placeIcon(dest)} onClick={() => go('find')} {...saveBtn(dest)} /> : <p className="muted small center">Tap a room on the map to pick it.</p>,
      actions: [{ label: desktop ? 'Plan a route →' : dest ? 'Next: choose start' : 'Find a destination', onClick: planIt }],
      map: { building: b, floor, here: start && start.level === floor ? start.node : null, pin: dest && dest.level === floor ? { node: dest.node, label: dest.title } : null },
      floorTabs: true, hero: { title: <>A little direction.<br />A lot less wandering.</>, sub: 'Explore rooms and facilities floor by floor. Tap a room to pick it.' },
    }; break

    case 'find': spec = {
      eyebrow: 'DESTINATION', title: dest && desktop && !query.trim() ? dest.title : 'Find a destination', sub: dest && desktop && !query.trim() ? `${b.name} · ${sub(dest)}` : 'Search by room name, code or facility.',
      top: <>
        <SearchBox value={query} onChange={setQuery} placeholder="Room name or code" label="Search rooms" count={results.length} active={hi} onKey={keys(results, chooseDest)} autoFocus={!dest} />
        {query.trim() ? (results.length ? resultList(results, chooseDest, p => (start && !reach(start, p) ? 'No route from your start' : undefined), dest?.id) : dq.trim() === query.trim() && noMatch)
          : dest ? <Row title={dest.title} sub={sub(dest, !reach(start, dest) ? 'No route from your start' : undefined)} icon={placeIcon(dest)} selected {...saveBtn(dest)} onClear={() => setDest(null)} />
          : <div className="list"><span className="eyebrow muted">SUGGESTED</span>
            {suggestions.map(({ p, why }) => <Row key={p.id} title={p.title} sub={sub(p, why)} icon={placeIcon(p)} onClick={() => chooseDest(p)} {...saveBtn(p)} />)}
          </div>}
      </>,
      desk: dest && !query.trim() ? <>
        <h3>{dest.type}</h3>
        <p className="muted">{dest.description?.trim() || `${dest.type}${dest.block ? ` in block ${dest.block}` : ''} on ${L(dest.level)}.`}</p>
        {dest.code && <p className="kv"><b>ROOM CODE</b> {dest.code}</p>}
        <Info title="Start with a confirmed location">Choose a place near you{qrSupported ? ' or scan a checkpoint' : ''} on the next screen.</Info>
      </> : undefined,
      actions: [{ label: desktop ? 'Next: choose start →' : 'Next: choose start', onClick: openWhere, disabled: !dest, hint: 'Pick a destination first' }],
      map: { building: b, floor, pin: dest && dest.level === floor ? { node: dest.node, label: dest.title } : null, focus: dest && dest.level === floor ? [dest.node] : undefined },
      floorTabs: true, showMapOnMobile: !!dest && !query.trim(),
    }; break

    case 'where': {
      const mark = (p: Place) => (dest && !reach(p, dest) ? `No route to ${dest.title}` : undefined)
      const rank = (p: Place) => (mark(p) ? 10 : 0) + ({ entrance: 0, lift: 1, toilet: 2, stairs: 3, food: 2, library: 2, lecture: 4, room: 5 })[p.kind] + (/lobby/i.test(p.title) ? -1 : 0)
      const opts = placesOn(floor).filter(p => p.startingPoint).sort((x, y) => rank(x) - rank(y) || x.title.localeCompare(y.title, undefined, { numeric: true }))
      const pick = (p: Place) => { setPending(p); setFloor(p.level); setStartQuery('') }
      spec = {
        eyebrow: 'SET YOUR LOCATION', title: 'Where are you?', sub: 'Pick a room, lobby or sign you can see.',
        top: <>
          {desktop && qrSupported && <Chips label="Method" value="manual" onChange={v => v === 'qr' && go('qr')} items={[{ v: 'manual', label: 'Pick a place' }, { v: 'qr', label: 'Scan QR' }]} />}
          <SearchBox value={startQuery} onChange={setStartQuery} placeholder="Search where you are" label="Search starting point" count={startResults.length} active={hi} onKey={keys(startResults, pick)} />
          {startQuery.trim() ? (startResults.length ? resultList(startResults, pick, mark, pending?.id) : dsq.trim() === startQuery.trim() && noMatch) : <>
            {pending && <Row title={pending.title} sub={sub(pending, 'Selected')} icon={placeIcon(pending)} selected onClear={() => setPending(null)} />}
            <FloorSelect names={b.levels.map(l => l.name)} value={floor} onChange={setFloor} />
            <div className="list">
              {opts.slice(0, limit).map(p => <Row key={p.id} title={p.title} sub={sub(p, mark(p))} icon={placeIcon(p)} selected={pending?.id === p.id} dim={!!mark(p)} onClick={() => setPending(p)} />)}
              {opts.length > limit && <button className="more" onClick={() => setLimit(l => l + PAGE)}>Show more ({opts.length - limit} left)</button>}
            </div>
          </>}
        </>,
        body: desktop ? <Info title="Check your surroundings">Continue only if you are at {pending ? pending.title : 'the place you pick'}. Room numbers are on the signs beside each door.</Info> : undefined,
        actions: [{ label: 'Confirm start & show routes', onClick: confirmStart, disabled: !pending, hint: 'Pick where you are first' }],
        mobileActions: [...(qrSupported ? [{ label: 'Scan a QR checkpoint', kind: 'sec' as const, onClick: () => go('qr') }] : []), { label: 'Confirm & find routes', onClick: confirmStart, disabled: !pending, hint: 'Pick where you are first' }],
        map: { building: b, floor, here: pending && pending.level === floor ? pending.node : null, focus: pending && pending.level === floor ? [pending.node] : undefined },
        floorTabs: true, showMapOnMobile: false,
        hero: { title: pending ? `Start at ${pending.title}` : 'Pick your starting point', sub: 'Tap a room on the map, or pick one from the list.' },
      }
    } break

    case 'qr': spec = {
      eyebrow: 'SET YOUR LOCATION', title: 'Scan a checkpoint', sub: 'Find a WayForge QR sign nearby.',
      top: !desktop ? <QrScanner onCode={fromQr} /> : undefined,
      body: <Info title="How it works">Point your camera at a checkpoint code. We'll ask you to confirm that place as your start.</Info>,
      actions: [{ label: 'Pick a place instead', kind: 'sec', onClick: back }],
      pane: <div className="qr-pane"><div className="qr-head"><h2>Locate a checkpoint</h2><p className="muted">Allow camera access when your browser asks.</p></div><QrScanner onCode={fromQr} /></div>,
      map: null, showMapOnMobile: false,
    }; break

    case 'routes': {
      const s = routes?.shortest, f = routes?.stepfree, o = picked
      const cut = !!start && !!dest && !reach(start, dest)
      const firstT = legs.find(l => l.kind !== 'walk')
      spec = {
        eyebrow: 'PLAN YOUR JOURNEY', title: desktop ? 'Your route' : 'Choose your route', sub: start && dest ? `${start.title} → ${dest.title} · ${L(dest.level)}` : undefined,
        desk: start && dest ? <><Field label="FROM" value={`${start.title} · ${L(start.level)}`} onClick={openWhere} /><Field label="TO" value={`${dest.title} · ${L(dest.level)}`} onClick={() => go('find')} /></> : undefined,
        body: cut ? <Info title="No route available">{dest!.title}{dest!.block ? ` (${dest!.block})` : ''} isn't joined to {start!.title}'s part of the published map yet. Try a different start, or ask the venue to check the map.</Info>
          : routes?.same ? <Option title={optTitle(s, 'Shortest')} sub={`${optSub(s, false)} · Already step-free`} selected icon={<RouteIcon />} />
          : <>
            <Option title={optTitle(s, 'Shortest')} sub={optSub(s, false)} selected={choice === 'shortest'} onClick={() => setChoice('shortest')} icon={<RouteIcon />} />
            <Option title={optTitle(f, 'Step-free')} sub={optSub(f, true)} selected={choice === 'stepfree'} onClick={() => setChoice('stepfree')} icon={<Lift />} />
          </>,
        actions: [{ label: o ? (routes?.same || choice === 'shortest' ? (desktop ? 'Start route →' : 'Start route') : (desktop ? 'Start step-free route →' : 'Start step-free route')) : 'No route available', onClick: startGuide, disabled: !o || legs.length === 0 }],
        map: o && legs.length ? { building: b, floor: start!.level, lines: legs.filter(l => l.kind === 'walk' && l.level === start!.level).map(l => l.nodes), here: start!.node, focus: legs[0].nodes, pin: legs[0].kind === 'walk' ? { node: legs[0].nodes[legs[0].nodes.length - 1], label: legEnd(legs[0]) } : null } : { building: b, floor: start ? start.level : 0, here: start?.node, focus: start ? [start.node] : undefined },
        tallMap: true,
      }
      if (desktop && o && firstT) spec.body = <>{spec.body}<Info title="Know your first landmark">Head to {vname(firstT.nodes[0])}, then {firstT.kind === 'lift' ? 'lift' : 'stairs'} {firstT.to > firstT.from ? 'up' : 'down'} to {L(firstT.to)}.</Info></>
    } break

    case 'guide': {
      if (!leg || !dest) {
        const here = !!picked && picked.r.nodes.length <= 1 // start and destination are the same place
        spec = here && dest
          ? { eyebrow: 'DESTINATION REACHED', title: "You're already here.", sub: `${dest.title} · ${sub(dest)}`, map: { building: b, floor: dest.level, here: dest.node, focus: [dest.node] }, actions: [{ label: 'Done', onClick: finish }, { label: 'Change destination', kind: 'sec', onClick: () => setStack(['explore', 'find']) }] }
          : { eyebrow: '', title: 'No route found', sub: 'These two places are not connected in the published map. Try another start or destination.', actions: [{ label: 'Back', onClick: back }] }
        break
      }
      spec = { eyebrow: '', title: '', actions: [] } // drawn by navigation mode below
    } break

    case 'arrived': spec = { eyebrow: '', title: '', actions: [] }; break // drawn by the arrival screen below

    case 'saved': {
      const list = P.visible.filter(isSaved)
      spec = {
        eyebrow: 'YOUR PLACES', title: desktop ? 'A familiar route.' : 'Your saved places', sub: desktop ? 'Keep the places you visit close.' : 'A familiar route, always close.',
        top: <>
          {list.length === 0 && <p className="muted">No saved places yet. Tap the bookmark on any place to save it.</p>}
          {list.map(p => <Row key={p.id} title={p.title} sub={sub(p)} icon={placeIcon(p)} onClick={() => { chooseDest(p); setStack(['explore', 'find']) }} {...saveBtn(p)} />)}
          {start && !list.some(p => p.id === start.id) && <Row title={start.title} sub={sub(start, 'Your start')} icon={placeIcon(start)} onClick={openWhere} />}
        </>,
        actions: [{ label: desktop ? 'Explore the building' : 'Explore building', onClick: () => tab('explore') }],
        map: dest ? { building: b, floor: dest.level, pin: { node: dest.node, label: dest.title } } : { building: b, floor: 0 },
        showMapOnMobile: false,
      }
    } break

    case 'prefs': spec = {
      eyebrow: 'MAKE IT YOURS', title: 'Settings', sub: "Choose how you'd like to get around.",
      top: <>
        <span className="eyebrow muted">ROUTES</span>
        <Option title="Shortest route" sub="Quickest way · may use stairs for a floor or two" selected={choice === 'shortest'} onClick={() => setDefault('shortest')} icon={<RouteIcon />} />
        <Option title="Step-free route" sub="Lifts and ramps only · no stairs" selected={choice === 'stepfree'} onClick={() => setDefault('stepfree')} icon={<Lift />} />
        <span className="eyebrow muted">MAP VIEW</span>
        <Chips label="Map view" value={flat ? '2d' : '3d'} onChange={v => setFlat(v === '2d')} items={[{ v: '3d', label: '3D' }, { v: '2d', label: '2D (from above)' }]} />
        <span className="eyebrow muted">STARTING POINT</span>
        <Field label="YOUR START" value={start ? `${start.title} · ${L(start.level)}` : 'Not set'} onClick={openWhere} />
      </>,
      actions: [{ label: 'Back to explore', onClick: () => tab('explore') }],
      map: { building: b, floor: start ? start.level : 0, here: start?.node },
      hero: { title: 'Your route, your way.', sub: 'These choices are remembered on this device.' }, showMapOnMobile: false,
    }; break

    case 'lost': spec = {
      eyebrow: 'LOCATION HELP', title: "Let's get you back.", sub: dest ? `Your destination is still ${dest.title}.` : 'Confirm where you are.',
      top: <>
        <Info title="Check a nearby landmark">Look for a room number or floor sign, then confirm your location. Your route updates from there.</Info>
        <Row title="Set location manually" sub="Choose a floor and nearby place" onClick={openWhere} />
        {qrSupported && <Row title="Scan a QR checkpoint" sub="Use a marked location in the building" onClick={() => go('qr')} />}
      </>,
      actions: [{ label: 'Back to my route', onClick: back }],
      map: leg ? legMap(li) : { building: b, floor }, showMapOnMobile: false,
    }; break

    case 'help': spec = {
      eyebrow: 'HELP', title: 'How WayForge works', sub: 'Indoor directions without GPS.',
      top: <>
        <Info title="1. Pick a destination">Search by room name, code (W1-01-08 or w10108) or a word like toilet, or tap a room on the map.</Info>
        <Info title="2. Confirm where you are">Pick a place you can see{qrSupported ? ', or scan a WayForge QR checkpoint' : ''}.</Info>
        <Info title="3. Follow each stage">Walk, take the lift or stairs, then walk again. Confirm each stage when you reach it. Your place is kept in the address, so refreshing or sharing the link is safe.</Info>
        <Info title="Need step-free access?">Pick the step-free route. It uses lifts only.</Info>
      </>,
      actions: [{ label: 'Back to explore', onClick: () => tab('explore') }],
      map: { building: b, floor }, floorTabs: true, showMapOnMobile: false,
    }; break
  }

  // ---------- shared pieces ----------
  const pickable = screen === 'explore' || screen === 'find' || screen === 'where'
  const mapFloor = spec.map?.floor ?? floor
  const mapHead = (fl = mapFloor, tabs = !!spec.floorTabs) => (
    <div className="map-head">
      <div><h2>{b.name}</h2><p className="muted">{L(fl)} · {zone(fl)}</p></div>
      {tabs ? levelChips(floor, setFloor, true) : <div className="route-floor"><span className="eyebrow muted">FLOOR</span><span className="pill">{L(fl)}</span></div>}
    </div>
  )
  const legend = (
    <div className="legend"><span><i className="d route" />Route</span><span><i className="d you" />You</span><span><i className="d dest" />Destination</span><span><i className="d stairs" />Stairs</span><span><i className="d lift" />Lift</span><em>{pickable ? 'Tap a room to pick it' : 'Drag to turn · pinch to zoom'}</em></div>
  )
  const actions = (list: Action[]) => <div className="actions">{list.map(a => <div key={a.label} className="act">
    {a.disabled && a.hint && <p className="hint" id={`h-${a.label.length}`}>{a.hint}</p>}
    <button className={a.kind ?? 'pri'} disabled={a.disabled} aria-describedby={a.disabled && a.hint ? `h-${a.label.length}` : undefined} onClick={a.onClick}>{a.label}</button>
  </div>)}</div>
  const onClickCapture = (e: React.MouseEvent) => { if ((e.target as Element).closest('button')) sound('tap') }

  // ---------- navigation mode + arrival (phone and desktop) ----------
  if ((screen === 'guide' && leg && dest) || (screen === 'arrived' && dest)) {
    const arrived = screen === 'arrived'
    const now = arrived ? null : legText(leg)
    const left = legs.slice(li).reduce((m, l) => m + (l.kind === 'walk' ? l.metres : 0), 0)
    const map: MapProps = arrived ? { building: b, floor: dest.level, pin: { node: dest.node, label: dest.title }, here: dest.node, focus: [dest.node] } : legMap(li)
    const banner = arrived
      ? <section className="nav-banner done" aria-live="polite"><span className="nav-ico"><Check /></span><div><b>You've arrived</b><small>{[dest.title, dest.code, L(dest.level)].filter(Boolean).join(' · ')}</small></div></section>
      : <section className="nav-banner" aria-live="polite"><span className="nav-ico">{now!.icon}</span><div><b>{now!.title}</b><small>{now!.sub}</small></div></section>
    const then = arrived ? <div className="nav-then light">{dest.code ? `Look for sign ${dest.code} at the entrance` : `Look for the ${dest.title} sign`}</div> : <div className="nav-then">Then: {thenText(li)}</div>
    const progress = <>
      <div className="segbar" role="progressbar" aria-valuemin={0} aria-valuemax={legs.length} aria-valuenow={arrived ? legs.length : li} aria-label={arrived ? 'Trip complete' : `Stage ${li + 1} of ${legs.length}`}>
        {legs.map((_, i) => <i key={i} className={arrived || i < li ? 'done' : i === li ? 'cur' : ''} />)}
      </div>
      <div className="nav-dest">{arrived ? <b>Trip complete</b> : <b>To {dest.title}{dest.code ? ` · ${dest.code}` : ''}</b>}<span>{arrived ? `${picked?.r.minutes ?? 1} min · ${Math.round(walkM)} m` : `${Math.max(1, Math.ceil(left / 65))} min · ${Math.round(left)} m left`}</span></div>
    </>
    const buttons = arrived
      ? <div className="nav-actions"><button className={`end save${isSaved(dest) ? ' on' : ''}`} onClick={() => toggleSave(dest)} aria-pressed={isSaved(dest)}><Bookmark on={isSaved(dest)} /> {isSaved(dest) ? 'Saved' : 'Save'}</button><button className="pri" onClick={finish}>Done</button></div>
      : <div className="nav-actions"><button className="end" onClick={endRoute}><CloseIcon /> End</button><button className="pri" onClick={nextLeg}>{confirmLabel(li)}</button></div>
    const lost = <button className="link lost" onClick={arrived ? openWhere : () => go('lost')}>{arrived ? 'Not here? Update my location' : 'Lost? Update my location'}</button>
    const turns = !arrived && leg.kind === 'walk' ? stepsOf(leg) : []
    if (desktop) return (
      <div className={`desk navdesk${tablet ? ' tablet' : ''}`} onClickCapture={onClickCapture}>
        <header className="topnav">
          <button className="brand" onClick={() => (arrived ? finish() : endRoute())}><span className="logo"><Logo /></span>WayForge</button>
          <div className="venue"><small>{arrived ? 'Arrived at' : 'Navigating to'}</small><b>{dest.title}{dest.code ? ` · ${dest.code}` : ''}</b></div>
          <nav>{arrived ? <button onClick={finish}>Done</button> : <button className="endroute" onClick={endRoute}><CloseIcon /> End route</button>}</nav>
        </header>
        <main className="desk-main">
          <aside className="panel navpanel">
            {banner}{then}
            <div className="scroll">
              {progress}
              {arrived ? <Info title={dest.title}>{dest.type}{dest.block ? ` · block ${dest.block}` : ''} · {L(dest.level)}. {isSaved(dest) ? 'Saved for next time.' : 'Save it for an easier visit next time.'}</Info> : stepList(li, true)}
            </div>
            <div className="actions">{buttons}{lost}</div>
          </aside>
          <section className="maparea">
            {mapHead(map.floor, false)}
            <div className="mapbox">{mapEl(map)}</div>
            {legend}
          </section>
        </main>
      </div>
    )
    return (
      <div className={`mob nav-mode${arrived ? ' arrived' : ''}`} onClickCapture={onClickCapture}>
        {banner}{then}
        <div className="nav-map">{mapEl(map)}</div>
        <section className="nav-sheet">
          {progress}
          {turns.length > 1 && <details className="turns-d"><summary>Directions for this stage ({turns.length})</summary>{stepList(li, true)}</details>}
          {buttons}{lost}
        </section>
      </div>
    )
  }

  // ---------- desktop / tablet ----------
  if (desktop) return (
    <div className={`desk${tablet ? ' tablet' : ''}`} onClickCapture={onClickCapture}>
      <header className="topnav">
        <button className="brand" onClick={() => tab('explore')}><span className="logo"><Logo /></span>WayForge</button>
        <div className="venue"><b>{b.name}</b><small>{b.site}</small></div>
        <nav>{(['explore', 'saved', 'prefs', 'help'] as Tab[]).map(t => <button key={t} className={TAB_OF[screen] === t ? 'on' : ''} aria-current={TAB_OF[screen] === t ? 'page' : undefined} onClick={() => tab(t)}>{TAB_NAME[t]}</button>)}</nav>
      </header>
      <main className="desk-main">
        <aside className="panel">
          <div className="scroll">
            {stack.length > 1 && <button className="back" onClick={back}>‹ Back</button>}
            <span className="eyebrow">{spec.eyebrow}</span>
            <h1>{spec.title}</h1>
            {spec.sub && <p className="muted lead">{spec.sub}</p>}
            <div className="stackv">{spec.top}{spec.desk}{spec.body}</div>
          </div>
          {actions(spec.actions)}
        </aside>
        <section className="maparea">
          {spec.pane ?? <>
            {mapHead()}
            {spec.hero && <div className="hero"><h2>{spec.hero.title}</h2><p className="muted">{spec.hero.sub}</p></div>}
            <div className="mapbox">{spec.map && mapEl(spec.map, pickable)}</div>
            {legend}
          </>}
        </section>
      </main>
    </div>
  )

  // ---------- phone ----------
  const showMap = !!spec.map && spec.showMapOnMobile !== false
  const menuItems: Tab[] = ['explore', 'saved', 'prefs', 'help']
  return (
    <div className="mob" onClickCapture={onClickCapture}>
      <header className="mhead">
        {stack.length > 1 && <button className="back" onClick={back} aria-label="Back">‹</button>}
        <button className="menu-btn" onClick={() => setMenu(true)} aria-label="Open menu" aria-expanded={menu}><MenuIcon /></button>
        <button className="mbrand" onClick={() => tab('explore')}>WayForge</button>
        <button className="link help" onClick={() => tab('help')}>Help</button>
      </header>
      <main className="scroll mmain">
        <h1>{spec.title}</h1>
        {spec.sub && <p className="muted lead">{spec.sub}</p>}
        {spec.top && <div className="stackv">{spec.top}</div>}
        {showMap && <div className={`mcard${spec.tallMap ? ' tall' : ''}`}><div className="mapbox">{mapEl(spec.map!, pickable)}</div><span className="maplabel">{(spec.map!.topDown ?? flat) ? '2D VIEW · NORTH UP' : '3D VIEW'}</span></div>}
        {(spec.mobile || spec.body) && <div className="stackv">{spec.mobile}{spec.body}</div>}
      </main>
      {actions(spec.mobileActions ?? spec.actions)}
      <div className={`drawer-backdrop${menu ? ' open' : ''}`} onClick={() => setMenu(false)} aria-hidden={!menu} />
      <nav className={`drawer${menu ? ' open' : ''}`} aria-label="Menu" aria-hidden={!menu}>
        <div className="drawer-head">
          <button className="menu-btn" onClick={() => setMenu(false)} aria-label="Close menu" tabIndex={menu ? 0 : -1}><CloseIcon /></button>
          <span className="mbrand">WayForge</span>
        </div>
        {menuItems.map(t => <button key={t} className={TAB_OF[screen] === t ? 'on' : ''} aria-current={TAB_OF[screen] === t ? 'page' : undefined} tabIndex={menu ? 0 : -1} onClick={() => { setMenu(false); tab(t) }}>{TAB_NAME[t]}</button>)}
      </nav>
    </div>
  )
}
