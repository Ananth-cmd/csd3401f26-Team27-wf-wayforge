import { useEffect, useState } from 'react'
import type { Building, Poi, Route } from './types'
import { getRoute, loadBuilding } from './api'
import MapView from './MapView'

type Screen = 'home' | 'search' | 'route' | 'guide' | 'arrived' | 'saved' | 'settings'

// tiny localStorage helpers (can fail in private mode, so never crash)
const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

const Pin = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
)
const Chevron = () => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m9 6 6 6-6 6" /></svg>

function PlaceCard({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button className="card place" onClick={onClick}>
      <span className="icon"><Pin /></span>
      <span className="place-txt"><b>{title}</b><small>{subtitle}</small></span>
      <Chevron />
    </button>
  )
}

export default function App() {
  const [b, setB] = useState<Building | null>(null)
  const [err, setErr] = useState('')
  const [screen, setScreen] = useState<Screen>('home')
  const [back, setBack] = useState<Screen>('home')
  const [picking, setPicking] = useState<'from' | 'to'>('to')
  const [fromId, setFromId] = useState<string>(() => load('nav.from', ''))
  const [toId, setToId] = useState('')
  const [stepFree, setStepFree] = useState<boolean>(() => load('nav.stepFree', false))
  const [saved, setSaved] = useState<string[]>(() => load('nav.saved', []))
  const [route, setRoute] = useState<Route | null>(null)
  const [step, setStep] = useState(1)
  const [level, setLevel] = useState(0)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('All')

  useEffect(() => { loadBuilding().then(setB).catch(e => setErr(String(e))) }, [])
  useEffect(() => save('nav.from', fromId), [fromId])
  useEffect(() => save('nav.stepFree', stepFree), [stepFree])
  useEffect(() => save('nav.saved', saved), [saved])
  useEffect(() => {
    if (!b || !fromId || !toId) { setRoute(null); return }
    const f = b.pois.find(p => p.id === fromId)!, t = b.pois.find(p => p.id === toId)!
    getRoute(b, f.node, t.node, stepFree).then(setRoute)
  }, [b, fromId, toId, stepFree])

  if (err) return <div className="app"><p className="muted">Couldn't load the building. {err}</p></div>
  if (!b) return <div className="app"><p className="muted">Loading building…</p></div>

  const poi = (id: string) => b.pois.find(p => p.id === id)
  const node = (id: string) => b.nodes.find(n => n.id === id)!
  const sub = (p: Poi) => `${b.levels[node(p.node).level].name} · ${p.code}`
  const from = poi(fromId), to = poi(toId)
  const go = (s: Screen) => { setBack(screen); setScreen(s) }
  const pick = (which: 'from' | 'to') => { setPicking(which); setQ(''); go('search') }
  const choose = (p: Poi) => {
    if (picking === 'from') setFromId(p.id); else setToId(p.id)
    setLevel(node(p.node).level)
    setScreen(back === 'guide' ? 'route' : back === 'route' ? 'route' : 'home')
  }
  const startGuide = () => { setStep(1); setLevel(route!.steps[1].level); setScreen('guide') }
  const confirmStep = () => {
    if (!route) return
    if (step >= route.steps.length - 1) { setLevel(route.steps[route.steps.length - 1].level); setScreen('arrived'); return }
    setStep(step + 1); setLevel(route.steps[step + 1].level)
  }
  const toggleSave = (id: string) => setSaved(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))

  const nav = (
    <nav className="bottom">
      {(['home', 'saved', 'settings'] as const).map(s => (
        <button key={s} className={screen === s ? 'on' : ''} onClick={() => setScreen(s)}>{s === 'home' ? 'Explore' : s[0].toUpperCase() + s.slice(1)}</button>
      ))}
    </nav>
  )

  // ---------- HOME ----------
  if (screen === 'home') return (
    <div className="app">
      <p className="eyebrow">PATH / SIT</p>
      <h1>Find your way.</h1>
      <p className="muted">{b.site}</p>
      <p className="label">PLAN YOUR JOURNEY</p>
      <PlaceCard title={from ? from.name : 'Enter your current location'} subtitle={from ? `FROM · ${sub(from)}` : 'FROM · Search a room or landmark'} onClick={() => pick('from')} />
      <PlaceCard title={to ? to.name : 'Enter your destination'} subtitle={to ? `TO · ${sub(to)}` : 'TO · Search a room or room code'} onClick={() => pick('to')} />
      <button className="primary" disabled={!from || !to} onClick={() => { setLevel(node(from!.node).level); go('route') }}>Find route →</button>
      <MapView building={b} level={level} onLevel={setLevel} focus={to?.node} />
      <p className="muted small">Your models · demo locations and routes</p>
      <button className="secondary" onClick={() => { setToId('L3-03'); setLevel(2) }}>Explore Level 3 demo room →</button>
      {nav}
    </div>
  )

  // ---------- SEARCH ----------
  if (screen === 'search') {
    const cats = ['All', ...new Set(b.pois.map(p => p.category))]
    const list = b.pois.filter(p => (cat === 'All' || p.category === cat) && `${p.name} ${p.code}`.toLowerCase().includes(q.toLowerCase()))
    return (
      <div className="app">
        <header className="top"><button className="back" onClick={() => setScreen(back)}>‹</button><h2>{picking === 'from' ? 'Where are you?' : 'Where to?'}</h2></header>
        <input className="search" autoFocus placeholder="Search a room or room code" value={q} onChange={e => setQ(e.target.value)} />
        <div className="chips">{cats.map(c => <button key={c} className={`chip ${c === cat ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}</div>
        {list.length === 0 && <p className="muted">No places match “{q}”.</p>}
        {list.map(p => <PlaceCard key={p.id} title={p.name} subtitle={sub(p)} onClick={() => choose(p)} />)}
      </div>
    )
  }

  // ---------- ROUTE ----------
  if (screen === 'route' && from && to) return (
    <div className="app">
      <header className="top"><button className="back" onClick={() => setScreen('home')}>‹</button><h2>Your route</h2></header>
      <PlaceCard title={`${from.name} · ${b.levels[node(from.node).level].name}`} subtitle="FROM · Tap to change" onClick={() => pick('from')} />
      <PlaceCard title={`${to.name} · ${b.levels[node(to.node).level].name}`} subtitle="TO · Tap to change" onClick={() => pick('to')} />
      <label className="card toggle"><input type="checkbox" checked={stepFree} onChange={e => setStepFree(e.target.checked)} /> Step-free route (use lifts)</label>
      <MapView building={b} level={level} onLevel={setLevel} route={route} />
      {route && route.steps.length > 0 && <>
        <h2 className="big">{route.minutes} min · {route.metres} m</h2>
        <p className="muted">{stepFree ? 'Step-free route' : 'Shortest walking route'}</p>
        <ol className="steps">{route.steps.slice(1).map((s, i) => <li key={i}>{s.text}</li>)}</ol>
        <p className="muted small">Follow the path and confirm each landmark as you go.</p>
        <button className="primary" onClick={startGuide}>Start navigation →</button>
      </>}
      {route && route.steps.length === 0 && <p className="card info"><b>You're already here.</b><small>Pick a different destination.</small></p>}
      {!route && <p className="card info"><b>No route found.</b><small>{stepFree ? 'Try turning off step-free.' : 'These places are not connected.'}</small></p>}
    </div>
  )

  // ---------- GUIDE ----------
  if (screen === 'guide' && route) {
    const s = route.steps[step], total = route.steps.length - 1
    const label = node(s.node).label
    return (
      <div className="app">
        <header className="top"><button className="back" onClick={() => setScreen('route')}>‹</button><h2>Follow your route</h2></header>
        <div className="banner">
          <b>{s.text}</b>
          <small>{s.via ? `${Math.round(s.metres / b.levels[0].height)} floor(s) by ${s.via}` : `${Math.round(s.metres)} m along the highlighted path`}</small>
        </div>
        <MapView building={b} level={level} onLevel={setLevel} route={route} target={step} />
        <p className="label">STEP {step} OF {total} · CONFIRMED BY YOU</p>
        <div className="bar"><div style={{ width: `${(step / total) * 100}%` }} /></div>
        <button className="primary" onClick={confirmStep}>I'm at {s.via ? b.levels[s.level].name : label} →</button>
        <button className="secondary" onClick={() => pick('from')}>I'm lost · update my location</button>
      </div>
    )
  }

  // ---------- ARRIVED ----------
  if (screen === 'arrived' && to) return (
    <div className="app center">
      <div className="tick">✓</div>
      <h1>You've arrived.</h1>
      <h2>{to.name}</h2>
      <p className="muted">{sub(to)}</p>
      <MapView building={b} level={level} onLevel={setLevel} focus={to.node} height={220} />
      <p className="card info"><b>Your destination is ahead</b><small>Check the room sign before entering.</small></p>
      <button className="secondary" onClick={() => toggleSave(to.id)}>{saved.includes(to.id) ? 'Saved ✓' : 'Save this place'}</button>
      <button className="primary" onClick={() => { setFromId(to.id); setToId(''); setScreen('home') }}>Done</button>
    </div>
  )

  // ---------- SAVED ----------
  if (screen === 'saved') return (
    <div className="app">
      <h1>Saved places.</h1>
      <p className="muted">Tap one to set it as your destination.</p>
      {saved.length === 0 && <p className="card info"><b>Nothing saved yet</b><small>Save a place when you arrive.</small></p>}
      {saved.map(poi).filter(Boolean).map(p => <PlaceCard key={p!.id} title={p!.name} subtitle={sub(p!)} onClick={() => { setToId(p!.id); setLevel(node(p!.node).level); setScreen('home') }} />)}
      {nav}
    </div>
  )

  // ---------- SETTINGS ----------
  if (screen === 'settings') return (
    <div className="app">
      <h1>Make it your way.</h1>
      <p className="muted">Navigation preferences</p>
      <label className="card toggle"><input type="checkbox" checked={stepFree} onChange={e => setStepFree(e.target.checked)} /> Prefer step-free routes</label>
      <PlaceCard title="Current location" subtitle={from ? `${from.name} · ${sub(from)}` : 'Set or update your starting point'} onClick={() => pick('from')} />
      <p className="card info"><b>How your location works</b><small>Your position is the point you confirm. Update it whenever you need to.</small></p>
      <p className="card info"><b>Prototype campus</b><small>Your supplied models. Demo room names, scale and floor transfers. Progress is manual.</small></p>
      {nav}
    </div>
  )

  // fallback (e.g. route screen without both places)
  return <div className="app"><button className="primary" onClick={() => setScreen('home')}>Back to start</button></div>
}
