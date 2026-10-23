// WayForge Navigator, layouts from Wayforge_SIT (desktop web) and Wayforge_SIT_1 (mobile).
// Each screen is described once (title, panel content, actions, map) and drawn by
// the desktop layout (top nav + side panel + large map) or the mobile layout
// (header + map card + actions + bottom tabs).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Building, Poi } from './types'
import { findRoute, loadBuilding } from './api'
import { toLegs, transfer, walkMetres } from './legs'
import type { Leg } from './legs'
import MapView from './MapView'
import type { MapProps } from './MapView'

type Screen = 'explore' | 'find' | 'where' | 'qr' | 'routes' | 'overview' | 'guide' | 'arrived' | 'saved' | 'prefs' | 'lost' | 'help'
type Tab = 'explore' | 'saved' | 'prefs' | 'help'
const TAB_OF: Record<Screen, Tab> = { explore: 'explore', find: 'explore', where: 'explore', qr: 'explore', routes: 'explore', overview: 'explore', guide: 'explore', arrived: 'explore', lost: 'explore', saved: 'saved', prefs: 'prefs', help: 'help' }

// storage (can throw in private mode)
const pref = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } } }
const sound = (name: string) => { try { const a = new Audio(`${import.meta.env.BASE_URL}audio/${name}.wav`); a.volume = 0.5; void a.play().catch(() => {}) } catch { /* ignore */ } }
const short = (s: string) => s.replace(/\s*\(Level \d+\)/, '')
const words = ['zero', 'one', 'two', 'three', 'four', 'five']

// ---------- small UI pieces ----------
const PinIcon = () => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21s-6.5-5.8-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.2-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></svg>
const Arrow = ({ d }: { d: 'up' | 'down' | 'right' }) => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d === 'right' ? <path d="m9 5 7 7-7 7" /> : d === 'up' ? <path d="M12 20V5m-6 6 6-6 6 6" /> : <path d="M12 4v15m-6-6 6 6 6-6" />}</svg>
const Stairs = () => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19h4v-4h4v-4h4V7h4" /></svg>
const Lift = () => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m9 9 3-3 3 3M9 15l3 3 3-3" /></svg>
const Check = () => <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
const Logo = () => <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round"><path d="M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z" /><path d="M9 4v13.5M15 6.5V20" /></svg>

function Field({ label, value, onClick, children }: { label: string; value?: string; onClick?: () => void; children?: ReactNode }) {
  const inner = <><span className="f-label">{label}</span>{children ?? <span className="f-value">{value}</span>}</>
  return onClick ? <button className="field" onClick={onClick}>{inner}</button> : <div className="field">{inner}</div>
}
function Place({ title, sub, onClick, selected }: { title: string; sub: string; onClick?: () => void; selected?: boolean }) {
  return <button className={`place${selected ? ' sel' : ''}`} onClick={onClick}><PinIcon /><span><b>{title}</b><small>{sub}</small></span></button>
}
function Info({ title, children }: { title: string; children: ReactNode }) {
  return <div className="info"><b>{title}</b><p>{children}</p></div>
}
function Option({ title, sub, selected, onClick, icon = true }: { title: string; sub: string; selected?: boolean; onClick: () => void; icon?: boolean }) {
  return <button className={`option${selected ? ' sel' : ''}`} onClick={onClick}>{icon && <PinIcon />}<span><b>{title}</b><small>{sub}</small></span></button>
}
function Chips<T extends string | number>({ items, value, onChange, label }: { items: { v: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return <div className="chips" role="tablist" aria-label={label}>{items.map(i => <button key={String(i.v)} role="tab" aria-selected={i.v === value} className={i.v === value ? 'on' : ''} onClick={() => onChange(i.v)}>{i.label}</button>)}</div>
}

type Action = { label: string; onClick: () => void; kind?: 'pri' | 'sec'; disabled?: boolean }
type Spec = {
  eyebrow: string; title: string; sub?: string
  top?: ReactNode // mobile: above the map · desktop: in the panel
  body?: ReactNode // mobile: below the map · desktop: in the panel
  desk?: ReactNode // desktop panel only
  deskAfter?: ReactNode // desktop panel, after body
  mobile?: ReactNode // mobile only (below the map)
  actions: Action[]; mobileActions?: Action[]
  map?: MapProps | null
  pane?: ReactNode // replaces the desktop map (QR camera)
  floorTabs?: boolean // L1/L2/L3 switch (otherwise "ROUTE FLOOR Level n")
  hero?: { title: ReactNode; sub: string }
  banner?: { icon?: ReactNode; title: string; sub: string; tone?: 'mint' }
  summary?: { big: string; title: string; sub: string; right: string }
  viewChips?: boolean
  showMapOnMobile?: boolean
}

export default function App() {
  const [b, setB] = useState<Building | null>(null)
  const [err, setErr] = useState('')
  const [stack, setStack] = useState<Screen[]>(['explore'])
  const screen = stack[stack.length - 1]
  const [start, setStart] = useState<Poi | null>(null)
  const [dest, setDest] = useState<Poi | null>(null)
  const [choice, setChoice] = useState<'shortest' | 'stepfree'>(pref.get('wayforge.stepFree') === '1' ? 'stepfree' : 'shortest')
  const [legIdx, setLegIdx] = useState(0)
  const [floor, setFloor] = useState(0) // browsing floor (explore / find / where)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<Poi | null>(null) // start chosen on "Where are you?" (not yet confirmed)
  const [method, setMethod] = useState<'manual' | 'qr'>('manual')
  const [, bump] = useState(0)
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight })

  useEffect(() => { loadBuilding().then(setB).catch(e => setErr(String(e))) }, [])
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
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement && e.target.value)) backRef.current() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  // both route options (shortest / step-free), like the designs' route cards
  const routes = useMemo(() => {
    if (!b || !start || !dest) return null
    const mk = (sf: boolean) => { const r = findRoute(b, start.node, dest.node, sf); return r ? { r, legs: toLegs(b, r) } : null }
    return { shortest: mk(false), stepfree: mk(true) }
  }, [b, start, dest])

  const desktop = vp.w >= 960 && vp.w > vp.h

  if (err || !b) return <div className="loading">{err ? `Couldn't load the building. ${err}` : 'Loading…'}</div>

  // ---------- helpers ----------
  const node = (id: string) => b.nodes.find(n => n.id === id)!
  const lvlOf = (p: Poi) => node(p.node).level
  const L = (i: number) => b.levels[i].name
  const sub = (p: Poi) => `${L(lvlOf(p))} · ${p.code}`
  const saveKey = (p: Poi) => `wayforge.saved.${b.id}.${p.id}`
  const isSaved = (p: Poi | null) => !!p && pref.get(saveKey(p)) === '1'
  const toggleSave = (p: Poi) => { pref.set(saveKey(p), isSaved(p) ? '0' : '1'); bump(x => x + 1) }
  const placesOn = (f: number) => b.pois.filter(p => lvlOf(p) === f)
  const zone = (f: number) => `${placesOn(f).length} rooms · stairs & lift`
  const levelChips = (v: number, on: (f: number) => void, short?: boolean) =>
    <Chips label="Floor" value={v} onChange={on} items={b.levels.map((l, i) => ({ v: i, label: short ? `L${i + 1}` : l.name }))} />

  const go = (s: Screen) => setStack(st => [...st, s])
  const tab = (t: Tab) => setStack([t === 'explore' ? 'explore' : t])
  const back = () => setStack(st => (st.length > 1 ? st.slice(0, -1) : st))
  backRef.current = back

  const picked = routes?.[choice] ?? routes?.shortest ?? null
  const legs: Leg[] = picked?.legs ?? []
  const leg = legs[legIdx]
  const optSub = (o: typeof picked | undefined, sf: boolean) => {
    if (!o) return sf ? 'No step-free route' : 'No route'
    const t = transfer(o.legs), m = Math.round(walkMetres(o.legs))
    if (!t) return `${m} m · Same floor`
    const n = Math.abs(t.to - t.from)
    return sf ? `${m} m · ${short(node(t.nodes[0]).label)} · Avoids stairs` : `${m} m · ${short(node(t.nodes[0]).label)} · ${n} floor${n > 1 ? 's' : ''}`
  }
  const optTitle = (o: typeof picked | undefined, name: string) => (o ? `${name} · ${o.r.minutes} min` : name)

  // what the map shows for a leg
  const legMap = (i: number): MapProps => {
    const l = legs[i]
    if (!l) return { building: b, floor }
    if (l.kind !== 'walk') { const prev = legs[i - 1]; return prev ? legMap(i - 1) : { building: b, floor: l.from, here: l.nodes[0] } }
    const end = l.nodes[l.nodes.length - 1]
    return { building: b, floor: l.level, lines: [l.nodes], here: l.nodes[0], pin: { node: end, label: l.final && dest ? dest.name : node(end).label } }
  }
  const legLine = (l: Leg, i: number) => {
    if (l.kind === 'walk') {
      const a = short(node(l.nodes[0]).label), e = node(l.nodes[l.nodes.length - 1])
      if (l.final && dest) return { title: i === 0 ? `${a} → ${short(dest.name)}` : `Continue to ${short(dest.name)}`, sub: `${L(l.level)} · ${dest.code} · ${Math.round(l.metres)} m` }
      return { title: `${a} → ${short(e.label)}`, sub: `Follow the corridor · ${Math.round(l.metres)} m` }
    }
    return { title: l.kind === 'lift' ? `Take the lift to ${L(l.to)}` : `Go ${l.to > l.from ? 'up' : 'down'} to ${L(l.to)}`, sub: 'Confirm the floor when you arrive' }
  }
  const directions = (current?: number) => (
    <div className="dirs">
      <span className="eyebrow muted">YOUR DIRECTIONS</span>
      <ol>{legs.map((l, i) => { const d = legLine(l, i); return <li key={i} className={i === current ? 'cur' : ''}><b>{i + 1}. {d.title}</b><small>{d.sub}</small></li> })}</ol>
    </div>
  )

  // ---------- navigation actions ----------
  const openWhere = () => { setPending(start); setMethod('manual'); setFloor(start ? lvlOf(start) : 0); go('where') }
  const planRoute = () => { if (!dest) go('find'); else if (!start) openWhere(); else go('routes') }
  const confirmStart = () => {
    if (!pending) return
    setStart(pending); setLegIdx(0)
    setStack(st => { const base = st.filter(s => !['where', 'qr', 'lost', 'routes', 'guide', 'overview'].includes(s)); const root: Screen[] = base.length ? base : ['explore']; return dest ? [...root, 'routes'] : root })
  }
  const startGuide = () => { setLegIdx(0); go('guide') }
  const nextLeg = () => { if (legIdx + 1 >= legs.length) setStack(['explore', 'arrived']); else setLegIdx(legIdx + 1) }
  const finish = () => { setStart(dest); setDest(null); setStack(['explore']) }
  const setDefault = (c: 'shortest' | 'stepfree') => { setChoice(c); pref.set('wayforge.stepFree', c === 'stepfree' ? '1' : '0') }

  // ---------- screens ----------
  const quick = ['L3-02', 'L2-03', 'L2-01'].map(id => b.pois.find(p => p.id === id)).filter(Boolean) as Poi[]
  const results = b.pois.filter(p => `${p.name} ${p.code} ${L(lvlOf(p))}`.toLowerCase().includes(query.trim().toLowerCase()))
  const kind = (p: Poi) => p.category.replace(/s$/, '')

  let spec: Spec
  switch (screen) {
    case 'explore': spec = {
      eyebrow: 'EXPLORE THE BUILDING', title: 'Find your way.', sub: desktop ? "Choose a place. We'll help you get there." : b.name,
      top: <>
        <Field label="DESTINATION" value={dest ? dest.name : 'Search rooms or facilities'} onClick={() => go('find')} />
        {desktop && <Field label="YOUR START" value={start ? start.name : 'Set starting location'} onClick={openWhere} />}
        {!desktop && levelChips(floor, setFloor)}
      </>,
      desk: <>
        <span className="eyebrow muted">QUICK DESTINATIONS</span>
        {(quick.length ? quick : b.pois.slice(0, 3)).map(p => <Place key={p.id} title={p.name} sub={`${kind(p)} · ${L(lvlOf(p))}`} onClick={() => { setDest(p); setFloor(lvlOf(p)); go('find') }} />)}
        {floor !== 0 && <Info title={`Browsing ${L(floor)}`}>Switch floors on the map to explore other spaces.</Info>}
      </>,
      mobile: dest ? <Place title={dest.name} sub={`${kind(dest)} · ${sub(dest)}`} onClick={() => go('find')} /> : undefined,
      actions: [{ label: desktop ? 'Plan a route →' : 'Set start & plan route', onClick: planRoute }],
      map: { building: b, floor, here: start && lvlOf(start) === floor ? start.node : null, pin: dest && lvlOf(dest) === floor ? { node: dest.node, label: dest.name } : null },
      floorTabs: true, hero: { title: <>A little direction.<br />A lot less wandering.</>, sub: 'Explore rooms and facilities, floor by floor.' },
    }; break

    case 'find': spec = {
      eyebrow: 'DESTINATION', title: dest && desktop ? dest.name : 'Find a destination', sub: dest && desktop ? `${b.name} · ${sub(dest)}` : 'Search by room name or number.',
      top: <>
        <Field label="SEARCH"><input className="f-input" autoFocus={!dest} placeholder="Room name or code" value={query} onChange={e => setQuery(e.target.value)} /></Field>
        {(!dest || query) && <div className="list">
          {results.length === 0 && <p className="muted">No matching places. Try another name or code.</p>}
          {results.map(p => <Place key={p.id} title={p.name} sub={sub(p)} selected={dest?.id === p.id} onClick={() => { setDest(p); setFloor(lvlOf(p)); setQuery('') }} />)}
        </div>}
        {!desktop && dest && !query && <Place title={dest.name} sub={sub(dest)} selected />}
      </>,
      desk: dest && !query ? <>
        <h3>{kind(dest)}</h3>
        <p className="muted">{dest.description}</p>
        <p className="kv"><b>ROOM CODE</b> {dest.code}</p>
        <p className="kv"><b>ACCESS</b> Lift or stairs</p>
        <Info title="Start with a confirmed location">Choose a nearby landmark or scan a checkpoint before navigating.</Info>
      </> : undefined,
      actions: [
        { label: desktop ? 'Set start & get directions →' : 'Set starting point', onClick: () => (start ? go('routes') : openWhere()), disabled: !dest },
        { label: isSaved(dest) ? 'Saved ✓' : 'Save this place', kind: 'sec', onClick: () => dest && toggleSave(dest), disabled: !dest },
      ],
      map: { building: b, floor, pin: dest && lvlOf(dest) === floor ? { node: dest.node, label: dest.name } : null },
      floorTabs: true,
    }; break

    case 'where': {
      const opts = placesOn(floor).filter(p => p.startingPoint)
      spec = {
        eyebrow: 'SET YOUR LOCATION', title: 'Where are you?', sub: desktop ? 'Confirm a place you can recognise.' : 'Confirm a landmark to start your route.',
        top: <>
          {desktop && <Chips label="Method" value={method} onChange={v => (v === 'qr' ? go('qr') : setMethod(v))} items={[{ v: 'manual', label: 'Manual' }, { v: 'qr', label: 'Scan QR' }]} />}
          <Field label="BUILDING" value={b.name} />
          <Field label="CURRENT FLOOR">{levelChips(floor, setFloor)}</Field>
          {opts.map(p => <Place key={p.id} title={p.name} sub={`${sub(p)}${pending?.id === p.id ? ' · Selected' : ''}`} selected={pending?.id === p.id} onClick={() => setPending(p)} />)}
        </>,
        body: desktop
          ? <Info title="Check your surroundings">This starting point is set manually. Continue only if you are at {pending ? short(pending.name) : 'the place you pick'}.</Info>
          : <Info title="No indoor GPS needed">Use a nearby room or checkpoint to confirm your starting position.</Info>,
        actions: [{ label: 'Confirm start & show routes', onClick: confirmStart, disabled: !pending }],
        mobileActions: [{ label: 'Scan a QR checkpoint', kind: 'sec', onClick: () => go('qr') }, { label: 'Confirm & find routes', onClick: confirmStart, disabled: !pending }],
        map: { building: b, floor, here: pending && lvlOf(pending) === floor ? pending.node : null },
        floorTabs: true, showMapOnMobile: false,
        hero: { title: pending ? `Start at ${short(pending.name)}` : 'Pick your starting point', sub: 'Your confirmed location becomes the beginning of your route.' },
      }
    } break

    case 'qr': {
      const toWhere = (p?: Poi) => { if (p) { setPending(p); setFloor(lvlOf(p)) } setStack(st => [...st.filter(s => s !== 'qr' && s !== 'where'), 'where']) }
      spec = {
        eyebrow: 'SET YOUR LOCATION', title: 'Scan a checkpoint', sub: 'Find a WayForge QR sign nearby.',
        top: !desktop ? <div className="camera small"><div className="frame-box">QR</div></div> : undefined,
        body: <>
          {desktop && <Info title="How it works">Point your camera at a checkpoint code. We'll use that place as your starting location.</Info>}
          <Info title="Prototype preview">{desktop ? 'This screen demonstrates the camera flow. Use the button below to preview a checkpoint.' : 'Preview a checkpoint, then confirm the detected starting point.'}</Info>
        </>,
        actions: [
          { label: desktop ? 'Preview checkpoint detection' : 'Preview checkpoint', onClick: () => toWhere(b.pois.find(x => x.startingPoint)) },
          { label: 'Enter location manually', kind: 'sec', onClick: () => toWhere() },
        ],
        pane: <div className="qr-pane">
          <div className="qr-head"><h2>Locate a checkpoint</h2><p className="muted">Camera preview · permission requested in the live app</p></div>
          <div className="camera"><div className="frame-box"><span className="corners" /></div><p>Keep the checkpoint inside the frame</p></div>
          <p className="muted center">You can always set your location manually.</p>
        </div>,
        map: null, showMapOnMobile: false,
      }
    } break

    case 'routes': {
      const s = routes?.shortest, f = routes?.stepfree, o = picked
      const t = o ? transfer(o.legs) : undefined
      spec = {
        eyebrow: 'PLAN YOUR JOURNEY', title: desktop ? 'Your route' : 'Choose your route', sub: !desktop && start && dest ? `${short(start.name)} → ${short(dest.name)} · ${L(lvlOf(dest))}` : undefined,
        desk: start && dest ? <><Field label="FROM" value={`${start.name} · ${L(lvlOf(start))}`} onClick={openWhere} /><Field label="TO" value={`${dest.name} · ${L(lvlOf(dest))}`} onClick={() => go('find')} /></> : undefined,
        body: <>
          <Option title={optTitle(s, 'Shortest')} sub={optSub(s, false)} selected={choice === 'shortest'} onClick={() => setChoice('shortest')} icon={!desktop} />
          <Option title={optTitle(f, 'Step-free')} sub={optSub(f, true)} selected={choice === 'stepfree'} onClick={() => setChoice('stepfree')} icon={!desktop} />
          {desktop && (choice === 'stepfree'
            ? <Info title="A route without stairs">Follow the lift signs, then continue to {dest ? short(dest.name) : 'your destination'}{dest ? ` on ${L(lvlOf(dest))}` : ''}.</Info>
            : <Info title="Know your next landmark">{t ? `Take the ${short(node(t.nodes[0]).label)} to ${L(t.to)}. Choose step-free if you need lift access.` : 'Your destination is on this floor.'}</Info>)}
          {!desktop && <button className="ghost" onClick={() => go('overview')} disabled={!o}>2D overview</button>}
        </>,
        actions: [{ label: o ? (choice === 'stepfree' ? (desktop ? 'Start step-free navigation →' : 'Start step-free route') : (desktop ? 'Start navigation →' : 'Start shortest route')) : 'No route available', onClick: startGuide, disabled: !o || legs.length === 0 }],
        map: o && legs.length ? legMap(0) : { building: b, floor: start ? lvlOf(start) : 0, here: start?.node },
        viewChips: true,
        summary: o && start && dest ? { big: `${o.r.minutes} min`, title: `${Math.round(walkMetres(o.legs))} m · ${choice === 'stepfree' ? 'Step-free route' : 'Shortest route'}`, sub: `${short(start.name)}, L${lvlOf(start) + 1} → ${short(dest.name)}, L${lvlOf(dest) + 1}`, right: t ? short(node(t.nodes[0]).label) : 'Same floor' } : undefined,
      }
    } break

    case 'overview': {
      const m = legMap(0)
      const t = transfer(legs)
      spec = {
        eyebrow: 'ROUTE OVERVIEW', title: desktop ? 'See the whole route.' : 'Your route in 2D', sub: start && dest ? `${short(start.name)} → ${short(dest.name)}` : undefined,
        desk: directions(),
        body: <Info title={desktop ? `2D · ${L(m.floor)}` : t ? `First, head to the ${short(node(t.nodes[0]).label)}` : 'Follow the highlighted line'}>
          {t ? `The highlighted line leads to the ${short(node(t.nodes[0]).label)}. Continue ${t.to > t.from ? 'up' : 'down'} to ${L(t.to)} for ${dest ? short(dest.name) : 'your destination'}.` : `The highlighted line leads to ${dest ? short(dest.name) : 'your destination'}.`}
        </Info>,
        actions: [{ label: 'Start directions', onClick: startGuide, disabled: !legs.length }, { label: 'Back to 3D route', kind: 'sec', onClick: back }],
        mobileActions: [{ label: 'Back to 3D route', kind: 'sec', onClick: back }, { label: 'Start directions', onClick: startGuide, disabled: !legs.length }],
        map: { ...m, topDown: true }, viewChips: true,
      }
    } break

    case 'guide': {
      if (!leg || !dest) { spec = { eyebrow: '', title: 'No route', actions: [{ label: 'Back to explore', onClick: () => tab('explore') }] }; break }
      const n = legs.length, step = `${legIdx + 1} of ${n}`
      const next = legs[legIdx + 1]
      const map = legMap(legIdx)
      const update: Action = { label: 'Update my location', kind: 'sec', onClick: () => go('lost') }
      const stepLabel = <span className="eyebrow">STEP {legIdx + 1} OF {n}</span>
      if (leg.kind === 'walk' && !leg.final) {
        const e = short(node(leg.nodes[leg.nodes.length - 1]).label), m = Math.round(leg.metres)
        const nextFloor = next && next.kind !== 'walk' ? L(next.to) : ''
        const btn: Action = { label: next?.kind === 'lift' ? "I'm at the lift" : "I'm at the stairs", onClick: nextLeg }
        spec = {
          map, eyebrow: 'LIVE DIRECTIONS', title: "You're on your way.", sub: desktop ? `${short(dest.name)} · ${sub(dest)}` : `${L(leg.level)} · Heading to ${short(dest.name)}`,
          body: desktop ? <Info title={`${step} · ${L(leg.level)}`}>Walk {m} m toward the {e}.</Info>
            : <><Info title={next?.kind === 'lift' ? `Follow signs to the ${e}` : `Continue to ${e}`}>{m} m ahead · Stay on {L(leg.level)}.</Info>{stepLabel}</>,
          deskAfter: directions(legIdx),
          banner: { icon: <Arrow d="up" />, title: `Continue straight to the ${e}`, sub: `Stay on ${L(leg.level)}${nextFloor ? ` · Your next floor is ${nextFloor}` : ''}` },
          actions: [btn, update], mobileActions: [update, btn],
        }
      } else if (leg.kind !== 'walk') {
        const upDown = leg.to > leg.from, floors = Math.abs(leg.to - leg.from)
        const btn: Action = { label: `I've reached ${L(leg.to)}`, onClick: nextLeg }
        const name = short(node(leg.nodes[0]).label)
        spec = {
          map, eyebrow: 'CHANGE FLOORS', title: leg.kind === 'lift' ? 'Take the lift.' : upDown ? 'Head upstairs.' : 'Head downstairs.',
          sub: desktop ? `Your destination is on ${L(lvlOf(dest))}.` : `${L(leg.from)} · Heading to ${short(dest.name)}`,
          body: desktop ? <>
            <div className="transfer">{leg.kind === 'lift' ? <Lift /> : <Stairs />}<div className="tr-row"><span>{L(leg.from)}</span><Arrow d={upDown ? 'up' : 'down'} /><span>{L(leg.to)}</span></div>
              <p>{leg.kind === 'lift' ? `Take the lift to ${L(leg.to)}.` : `Follow the stairs ${upDown ? 'up' : 'down'} ${words[floors] ?? floors} floor${floors > 1 ? 's' : ''}.`}</p></div>
            <Info title="Check the floor sign">Confirm {L(leg.to)} before continuing to {short(dest.name)}.</Info>
          </> : <><Info title={`${L(leg.from)} → ${L(leg.to)}`}>Confirm the {L(leg.to)} floor sign before continuing.</Info>{stepLabel}</>,
          deskAfter: directions(legIdx),
          banner: { icon: leg.kind === 'lift' ? <Lift /> : <Stairs />, title: `${name} → ${L(leg.to)}`, sub: "We'll show the next part of your route after you confirm the floor." },
          actions: [btn], mobileActions: [update, btn],
        }
      } else {
        const m = Math.round(leg.metres)
        const btn: Action = { label: `I've reached ${short(dest.name)}`, onClick: nextLeg }
        spec = {
          map, eyebrow: 'FINAL APPROACH', title: 'Almost there.', sub: desktop ? `${short(dest.name)} · ${sub(dest)}` : `${L(leg.level)} · ${short(dest.name)} · ${dest.code}`,
          body: desktop ? <Info title={`${step} · ${L(leg.level)}`}>Follow the corridor for {m} m. {short(dest.name)} is ahead.</Info>
            : <><Info title={`${short(dest.name)} is ahead`}>Follow the corridor for {m} m. Look for room {dest.code}.</Info>{stepLabel}</>,
          deskAfter: directions(legIdx),
          banner: { icon: <Arrow d="right" />, title: `${short(dest.name)} is ahead`, sub: `${m} m remaining · Look for room ${dest.code}` },
          actions: [btn, update], mobileActions: [update, btn],
        }
      }
    } break

    case 'arrived': spec = dest ? {
      eyebrow: 'DESTINATION REACHED', title: "You've arrived.", sub: desktop ? `Welcome to ${short(dest.name)}.` : `${short(dest.name)} · ${sub(dest)}`,
      desk: <div className="arrived"><span className="badge"><Check /></span><h3>{short(dest.name)}</h3><p className="muted">{sub(dest)}</p><p className="muted">{b.name}</p></div>,
      body: desktop ? <Info title="Make the next visit easier">Save this place so you can find it quickly next time.</Info>
        : <Info title="Right place. Ready for what's next.">Save {short(dest.name)} for an easier visit next time.</Info>,
      actions: [{ label: isSaved(dest) ? 'Saved ✓' : `Save ${short(dest.name)}`, onClick: () => toggleSave(dest) }, { label: 'Back to explore', kind: 'sec', onClick: finish }],
      map: { building: b, floor: lvlOf(dest), pin: { node: dest.node, label: dest.name } },
      banner: { icon: <Check />, title: "Right place. Ready for what's next.", sub: `${short(dest.name)} · ${sub(dest)}` },
    } : { eyebrow: '', title: "You've arrived.", actions: [{ label: 'Back to explore', onClick: finish }] }; break

    case 'saved': {
      const list = b.pois.filter(isSaved)
      spec = {
        eyebrow: 'YOUR PLACES', title: desktop ? 'A familiar route.' : 'Your saved places', sub: desktop ? 'Keep the places you visit close.' : 'A familiar route, always close.',
        top: <>
          {list.length === 0 && <p className="muted">No saved places yet. Open a place and tap Save this place.</p>}
          {list.map(p => <Place key={p.id} title={p.name} sub={`${sub(p)} · Saved`} onClick={() => { setDest(p); setFloor(lvlOf(p)); setStack(['explore', 'find']) }} />)}
          {start && !list.some(p => p.id === start.id) && <Place title={start.name} sub={`${sub(start)} · Your start`} onClick={openWhere} />}
        </>,
        body: <Info title="Ready for next time">{desktop ? 'Choose a saved place to review its location and plan a route.' : 'Select a place to review its location and plan your route.'}</Info>,
        actions: [{ label: desktop ? 'Explore the building' : 'Explore building', onClick: () => tab('explore') }],
        map: dest ? { building: b, floor: lvlOf(dest), pin: { node: dest.node, label: dest.name } } : { building: b, floor: 0 },
        showMapOnMobile: false,
      }
    } break

    case 'prefs': {
      const s = routes?.shortest, f = routes?.stepfree
      spec = {
        eyebrow: 'MAKE IT YOURS', title: desktop ? 'Route preferences' : 'Your preferences', sub: desktop ? "Choose how you'd like to get there." : "Choose how you'd like to navigate.",
        top: <>
          <Option title={s ? `Shortest route · ${s.r.minutes} min` : 'Shortest route'} sub={s ? optSub(s, false) : 'Use stairs · Review route'} selected={choice === 'shortest'} onClick={() => setDefault('shortest')} icon={!desktop} />
          <Option title={f ? `Step-free route · ${f.r.minutes} min` : 'Step-free route'} sub={f ? optSub(f, true) : 'Use lifts · Avoid stairs'} selected={choice === 'stepfree'} onClick={() => setDefault('stepfree')} icon={!desktop} />
          {!desktop && <Option title="2D route overview" sub={picked ? 'See the corridor from above' : 'Plan a route first'} onClick={() => { if (picked) go('overview') }} />}
        </>,
        body: desktop ? <>
          <Info title="A clearer view">Open a flat map if you prefer to see the corridor layout from above.</Info>
          <button className="sec" onClick={() => go('overview')} disabled={!picked}>Open 2D route overview</button>
          <button className="sec" onClick={openWhere}>Update starting point</button>
        </> : <Info title="A route that works for you">Review distance and floor changes before you start.</Info>,
        actions: desktop ? [{ label: 'Back to explore', onClick: () => tab('explore') }] : [{ label: 'Update starting point', onClick: openWhere }],
        map: { building: b, floor: start ? lvlOf(start) : 0, here: start?.node },
        hero: { title: 'Your route, your way.', sub: 'Choose a route option to review it before you start.' }, showMapOnMobile: false,
      }
    } break

    case 'lost': spec = {
      eyebrow: 'LOCATION HELP', title: "Let's get you back.", sub: dest ? `Your destination is still ${short(dest.name)}.` : 'Confirm where you are.',
      top: <>
        <Info title={desktop ? 'Where are you now?' : 'Check a nearby landmark'}>{desktop ? 'Check the nearest room number or floor sign. Then update your starting point.' : 'Look for a room number or floor sign, then confirm your location.'}</Info>
        <Place title="Set location manually" sub="Choose a floor and nearby place" onClick={openWhere} />
        <Place title="Scan a QR checkpoint" sub="Use a marked location in the building" onClick={() => go('qr')} />
      </>,
      actions: [{ label: 'Review my route', onClick: () => setStack(st => st.filter(s => s !== 'lost' && s !== 'guide' && s !== 'overview')) }],
      map: leg ? legMap(legIdx) : { building: b, floor },
      banner: { title: 'Location needs confirmation', sub: 'Indoor position may be uncertain. Confirm a nearby landmark before continuing.', tone: 'mint' }, showMapOnMobile: false,
    }; break

    case 'help': spec = {
      eyebrow: 'HELP', title: 'How WayForge works', sub: 'Indoor directions without GPS.',
      top: <>
        <Info title="1. Pick a destination">Search by room name or code, or browse each floor.</Info>
        <Info title="2. Confirm where you are">Choose a landmark you can see, or scan a WayForge QR checkpoint.</Info>
        <Info title="3. Follow each stage">Walk to the stairs or lift, change floors, then follow the corridor. Confirm each stage as you reach it.</Info>
        <Info title="Need step-free access?">Pick the step-free route. It uses lifts only.</Info>
      </>,
      actions: [{ label: 'Back to explore', onClick: () => tab('explore') }],
      map: { building: b, floor }, floorTabs: true, showMapOnMobile: false,
    }; break
  }

  // ---------- shared pieces ----------
  const mapFloor = spec.map?.floor ?? floor
  const mapHead = (
    <div className="map-head">
      <div><h2>{b.name}</h2><p className="muted">{L(mapFloor)} / {zone(mapFloor)}</p></div>
      {spec.floorTabs ? levelChips(floor, setFloor, true) : <div className="route-floor"><span className="eyebrow muted">ROUTE FLOOR</span><span className="pill">{L(mapFloor)}</span></div>}
    </div>
  )
  const viewChips = spec.viewChips && (
    <div className="view-chips">
      <button className={screen === 'overview' ? 'on' : ''} onClick={() => { if (screen !== 'overview') go('overview') }}>2D overview</button>
      {screen === 'overview' && <button onClick={back}>3D view</button>}
    </div>
  )
  const legend = (
    <div className="legend"><span><i className="d route" />Route</span><span><i className="d dest" />Destination</span><span><i className="d stairs" />Stairs</span><span><i className="d lift" />Lift</span><span><i className="d rooms" />Rooms</span><em>Illustrative venue layout</em></div>
  )
  const actions = (list: Action[]) => <div className="actions">{list.map(a => <button key={a.label} className={a.kind ?? 'pri'} disabled={a.disabled} onClick={a.onClick}>{a.label}</button>)}</div>
  const onClickCapture = (e: React.MouseEvent) => { if ((e.target as Element).closest('button')) sound('tap') }

  // ---------- desktop ----------
  if (desktop) return (
    <div className="desk" onClickCapture={onClickCapture}>
      <header className="topnav">
        <button className="brand" onClick={() => tab('explore')}><span className="logo"><Logo /></span>WayForge</button>
        <div className="venue"><b>{b.name}</b><small>{b.site}</small></div>
        <nav>{(['explore', 'saved', 'prefs', 'help'] as Tab[]).map(t => <button key={t} className={TAB_OF[screen] === t ? 'on' : ''} onClick={() => tab(t)}>{t === 'prefs' ? 'Preferences' : t[0].toUpperCase() + t.slice(1)}</button>)}</nav>
      </header>
      <main className="desk-main">
        <aside className="panel">
          <div className="scroll">
            {stack.length > 1 && <button className="back" onClick={back}>‹ Back</button>}
            <span className="eyebrow">{spec.eyebrow}</span>
            <h1>{spec.title}</h1>
            {spec.sub && <p className="muted lead">{spec.sub}</p>}
            <div className="stackv">{spec.top}{spec.desk}{spec.body}{spec.deskAfter}</div>
          </div>
          {actions(spec.actions)}
        </aside>
        <section className="maparea">
          {spec.pane ?? <>
            {mapHead}
            {viewChips}
            {spec.hero && <div className="hero"><h2>{spec.hero.title}</h2><p className="muted">{spec.hero.sub}</p></div>}
            {spec.banner && <div className={`banner${spec.banner.tone === 'mint' ? ' mint' : ''}`}>{spec.banner.icon}<div><b>{spec.banner.title}</b><small>{spec.banner.sub}</small></div></div>}
            <div className="mapbox">{spec.map && <MapView {...spec.map} />}</div>
            {spec.summary && <div className="summary"><span className="big">{spec.summary.big}</span><div><b>{spec.summary.title}</b><small>{spec.summary.sub}</small></div><span className="right">{spec.summary.right}</span></div>}
            {legend}
          </>}
        </section>
      </main>
    </div>
  )

  // ---------- mobile ----------
  const showMap = !!spec.map && spec.showMapOnMobile !== false
  return (
    <div className="mob" onClickCapture={onClickCapture}>
      <header className="mhead">
        {stack.length > 1 && <button className="back" onClick={back} aria-label="Back">‹</button>}
        <button className="mbrand" onClick={() => tab('explore')}>WayForge</button>
        <button className="link" onClick={() => tab('help')}>Help</button>
      </header>
      <main className="scroll mmain">
        <h1>{spec.title}</h1>
        {spec.sub && <p className="muted lead">{spec.sub}</p>}
        {spec.top && <div className="stackv">{spec.top}</div>}
        {showMap && <div className="mcard"><div className="mapbox"><MapView {...spec.map!} /></div><span className="maplabel">{spec.map!.topDown ? 'ILLUSTRATIVE 2D MAP' : 'ILLUSTRATIVE 3D MAP'}</span></div>}
        {(spec.mobile || spec.body) && <div className="stackv">{spec.mobile}{spec.body}</div>}
      </main>
      {actions(spec.mobileActions ?? spec.actions)}
      <nav className="tabs">{(['explore', 'saved', 'prefs'] as Tab[]).map(t => <button key={t} className={TAB_OF[screen] === t ? 'on' : ''} onClick={() => tab(t)}>{t === 'prefs' ? 'Settings' : t[0].toUpperCase() + t.slice(1)}</button>)}</nav>
    </div>
  )
}
