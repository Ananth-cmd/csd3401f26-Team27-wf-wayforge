// Port of CanvasNavigator.cs + Main.unity layout.
// Every element sits at the same x/y/size as in the Unity scene's 390x844 design frame,
// and the frame is scaled to the window like DesignFrame.cs.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Building, Poi, Route } from './types'
import { getRoute, loadBuilding } from './api'
import MapView from './MapView'

type Screen = 'Home' | 'Search' | 'Confirm' | 'Details' | 'Route' | 'Guide' | 'Arrival' | 'Saved' | 'Settings'

// PlayerPrefs -> localStorage (can throw in private mode, so never crash)
const pref = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } } }

// UISounds.cs
const sound = (name: string) => { try { const a = new Audio(`${import.meta.env.BASE_URL}audio/${name}.wav`); a.volume = 0.6; void a.play().catch(() => {}) } catch { /* ignore */ } }
const icon = (n: string) => `${import.meta.env.BASE_URL}icons/${n}.png`

type Box = { x: number; y: number; w: number; h: number }
const box = ({ x, y, w, h }: Box) => ({ left: x, top: y, width: w, height: h })

function T({ x, y, w, h, size, bold, color = 'ink', center, children }: Box & { size: number; bold?: boolean; color?: 'ink' | 'muted' | 'teal' | 'white' | 'mint'; center?: boolean; children: ReactNode }) {
  return <div className={`t c-${color}${center ? ' center' : ''}`} style={{ ...box({ x, y, w, h }), fontSize: size, fontWeight: bold ? 700 : 400 }}>{children}</div>
}
function Btn({ kind, label, onClick, disabled, ...b }: Box & { kind: 'pri' | 'sec'; label: string; onClick: () => void; disabled?: boolean }) {
  return <button className={kind} style={box(b)} disabled={disabled} onClick={onClick}>{label}</button>
}
function Back({ onClick }: { onClick: () => void }) {
  return <button className="sec back" style={box({ x: 24, y: 32, w: 44, h: 44 })} onClick={onClick}>‹</button>
}
function Title({ children }: { children: ReactNode }) {
  return <T x={80} y={31} w={286} h={48} size={22} bold>{children}</T>
}
// PlaceCard prefab, 342 x 78
function Card({ title, subtitle, onClick, x = 24, y }: { title: string; subtitle: string; onClick: () => void; x?: number; y?: number }) {
  return (
    <button className="card place" style={y === undefined ? { position: 'relative', width: 342, height: 78 } : box({ x, y, w: 342, h: 78 })} onClick={onClick}>
      <span className="ib" />
      <img className="pin" src={icon('pin')} alt="" />
      <span className="pt">{title}</span>
      <span className="ps">{subtitle}</span>
      <img className="chev" src={icon('chevron')} alt="" />
    </button>
  )
}
function Toggle({ y, label, on, onChange }: { y: number; label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="card toggle" style={box({ x: 24, y, w: 342, h: 48 })} onClick={() => { sound('toggle'); onChange(!on) }}>
      <span className="cb">{on && <span className="cm" />}</span>
      <span className="tl">{label}</span>
    </button>
  )
}
function Info({ y, heading, body }: { y: number; heading: string; body: string }) {
  return (
    <div className="info" style={box({ x: 24, y, w: 342, h: 86 })}>
      <T x={16} y={10} w={310} h={24} size={13} bold color="teal">{heading}</T>
      <T x={16} y={36} w={310} h={43} size={12} color="muted">{body}</T>
    </div>
  )
}

export default function App() {
  const [b, setB] = useState<Building | null>(null)
  const [err, setErr] = useState('')
  const [screen, setScreen] = useState<Screen>('Home')
  const [start, setStart] = useState<Poi | null>(null)
  const [dest, setDest] = useState<Poi | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [step, setStep] = useState(0)
  const [pending, setPending] = useState<Poi | null>(null)
  const [pickingStart, setPickingStart] = useState(false)
  const [pickerReturn, setPickerReturn] = useState<Screen>('Home')
  const [pickerBack, setPickerBack] = useState<Screen>('Home')
  const [detailBack, setDetailBack] = useState<Screen>('Home')
  const [category, setCategory] = useState('All')
  const [query, setQuery] = useState('')
  const [stepFree, setStepFree] = useState(pref.get('wayforge.stepFree') === '1')
  const [topDown, setTopDown] = useState(pref.get('wayforge.topDown') === '1')
  const [floor, setFloor] = useState(0)
  const [place, setPlace] = useState<string | null>(null) // map.ShowPlace
  const [, bump] = useState(0) // re-render after saving
  const [scale, setScale] = useState(1)

  useEffect(() => { loadBuilding().then(setB).catch(e => setErr(String(e))) }, [])
  // DesignFrame.cs: scale the 390x844 frame to fit
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 390, window.innerHeight / 844))
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit)
  }, [])
  // UISounds: new screen / arriving
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } sound(screen === 'Arrival' ? 'arrive' : 'screen') }, [screen])

  const frame = (children: ReactNode) => (
    <div className="stage" onClickCapture={e => { if ((e.target as Element).closest('button:not(.toggle)')) sound('tap') }}>
      <div className="frame" style={{ transform: `scale(${scale})` }}>{children}</div>
    </div>
  )
  if (err) return frame(<T x={24} y={100} w={342} h={60} size={14} color="muted">Couldn't load the building. {err}</T>)
  if (!b) return frame(<T x={24} y={100} w={342} h={60} size={14} color="muted">Loading building…</T>)

  const nodeOf = (p: Poi) => b.nodes.find(n => n.id === p.node)!
  const floorOf = (p: Poi) => nodeOf(p).level
  const floorName = (p: Poi) => b.levels[floorOf(p)].name
  const subtitle = (p: Poi) => `${floorName(p)} · ${p.code}`
  const saveKey = (p: Poi) => `wayforge.saved.${b.name}.${p.id}`
  const isSaved = (p: Poi | null) => !!p && pref.get(saveKey(p)) === '1'
  const label = (id: string) => b.nodes.find(n => n.id === id)!.label
  const lvlOf = (id: string) => b.nodes.find(n => n.id === id)!.level

  // ---- CanvasNavigator methods ----
  const show = (s: Screen) => setScreen(s)
  const home = () => { setRoute(null); setPlace(null); show('Home') }
  const openPicker = (startPick: boolean, returnTo: Screen) => {
    setPickingStart(startPick); setPickerBack(screen); setPickerReturn(returnTo); setPending(null); setCategory('All'); setQuery(''); show('Search')
  }
  const chooseStart = () => openPicker(true, screen === 'Guide' ? 'Route' : screen)
  const chooseDestination = () => openPicker(false, screen)
  const previewRoute = async (s = start, d = dest, sf = stepFree) => {
    if (!s || !d) { home(); return }
    const r = await getRoute(b, s.node, d.node, sf)
    setRoute(r); setStep(0); setPlace(null); setFloor(floorOf(s)); show('Route')
  }
  const selectPlace = (p: Poi) => {
    if (pickingStart) { setPending(p); setPlace(p.node); setFloor(floorOf(p)); show('Confirm') }
    else { setDest(p); setRoute(null); if (pickerReturn === 'Route') void previewRoute(start, p); else home() }
  }
  const confirmStart = () => {
    if (!pending) return
    setStart(pending); setRoute(null); setStep(0)
    if (pickerReturn === 'Route' || pickerReturn === 'Details') void previewRoute(pending, dest)
    else if (pickerReturn === 'Settings') show('Settings'); else home()
  }
  const details = (p: Poi) => { setDetailBack(screen); setDest(p); setPlace(p.node); setFloor(floorOf(p)); show('Details') }
  const quickDestination = () => details(b.pois.find(p => p.id === 'L3-02') ?? b.pois[0])
  const directions = () => { if (!start) openPicker(true, 'Route'); else void previewRoute() }
  const setStepFreeRoute = (v: boolean) => { setStepFree(v); void previewRoute(start, dest, v) }
  const guide = (i: number) => { setStep(i); setFloor(lvlOf(route!.nodes[i])); show('Guide') }
  const arrive = () => { setPlace(dest!.node); setFloor(floorOf(dest!)); show('Arrival') }
  const startNavigation = () => { if (!route) return; if (route.nodes.length === 1) arrive(); else guide(0) }
  const nextStep = () => { if (!route) return; if (step + 1 === route.nodes.length - 1) { setStep(step + 1); arrive() } else guide(step + 1) }
  const finish = () => { setStart(dest); setDest(null); home() }
  const toggleSaved = () => { if (!dest) return; pref.set(saveKey(dest), isSaved(dest) ? '0' : '1'); bump(x => x + 1) }
  const preferStepFree = (v: boolean) => { setStepFree(v); pref.set('wayforge.stepFree', v ? '1' : '0') }
  const prefer2D = (v: boolean) => { setTopDown(v); pref.set('wayforge.topDown', v ? '1' : '0') }
  const back = () => {
    switch (screen) {
      case 'Confirm': show('Search'); break
      case 'Search': if (pickerBack === 'Guide' && route) guide(step); else show(pickerBack); break
      case 'Details': if (detailBack === 'Saved') show('Saved'); else home(); break
      case 'Guide': void previewRoute(); break
      default: home()
    }
  }

  const map = (y: number, h: number, extra: { route?: Route | null; progress?: number } = {}) => (
    <MapView building={b} floor={floor} onFloor={setFloor} topDown={topDown} onToggleView={() => setTopDown(v => !v)}
      place={place} x={24} y={y} w={342} h={h} {...extra} />
  )
  const bottomNav = (
    <div className="card bottom" style={box({ x: 12, y: 762, w: 366, h: 66 })}>
      <button className="sec" style={box({ x: 8, y: 6, w: 114, h: 54 })} onClick={home}>Explore</button>
      <button className="sec" style={box({ x: 126, y: 6, w: 114, h: 54 })} onClick={() => show('Saved')}>Saved</button>
      <button className="sec" style={box({ x: 244, y: 6, w: 114, h: 54 })} onClick={() => show('Settings')}>Settings</button>
    </div>
  )

  switch (screen) {
    case 'Home': return frame(<>
      <T x={24} y={32} w={342} h={22} size={12} bold color="teal">PATH / SIT</T>
      <T x={24} y={68} w={342} h={42} size={29} bold>Find your way.</T>
      <T x={24} y={115} w={342} h={24} size={13} color="muted">{b.site}</T>
      <T x={24} y={155} w={342} h={20} size={11} bold color="muted">PLAN YOUR JOURNEY</T>
      <Card y={185} title={start ? start.name : 'Enter your current location'} subtitle="FROM · Search a room or landmark" onClick={chooseStart} />
      <Card y={275} title={dest ? dest.name : 'Enter your destination'} subtitle="TO · Search a room or room code" onClick={chooseDestination} />
      <Btn kind="pri" x={24} y={367} w={342} h={54} label="Find route →" disabled={!start || !dest} onClick={() => void previewRoute()} />
      {map(438, 226)}
      <T x={24} y={672} w={342} h={20} size={11} color="muted">Your models · demo locations and routes</T>
      <Btn kind="sec" x={24} y={700} w={342} h={42} label="Explore Level 3 demo room →" onClick={quickDestination} />
      {bottomNav}
    </>)

    case 'Search': {
      const q = query.trim().toLowerCase()
      const places = b.pois.filter(p => (!pickingStart || p.startingPoint) && (category === 'All' || p.category === category) &&
        `${p.name} ${p.code} ${floorName(p)}`.toLowerCase().includes(q))
      return frame(<>
        <Back onClick={back} />
        <Title>{pickingStart ? 'Your current location' : 'Your destination'}</Title>
        <T x={24} y={100} w={342} h={35} size={13} color="muted">Type a room name or code, then choose a place.</T>
        <input className="card search" style={box({ x: 24, y: 145, w: 342, h: 56 })} placeholder="Search rooms or landmarks" value={query} onChange={e => setQuery(e.target.value)} />
        {['All', 'Rooms', 'Facilities', 'Food'].map((c, i) => (
          <Btn key={c} kind="sec" x={24 + i * 87} y={215} w={81} h={42} label={c} onClick={() => setCategory(c)} />
        ))}
        <div className="list" style={box({ x: 24, y: 275, w: 342, h: 515 })}>
          {places.map(p => <Card key={p.id} title={p.name} subtitle={subtitle(p)} onClick={() => selectPlace(p)} />)}
        </div>
        {places.length === 0 && <T x={30} y={300} w={330} h={70} size={16} color="muted">No matching places. Try another name or code.</T>}
      </>)
    }

    case 'Confirm': return frame(pending && <>
      <Back onClick={back} />
      <Title>Confirm your location</Title>
      {map(112, 325)}
      <T x={24} y={460} w={342} h={40} size={24} bold>{pending.name}</T>
      <T x={24} y={504} w={342} h={28} size={14} color="muted">{subtitle(pending)}</T>
      <Info y={554} heading="Look around before confirming" body="Only continue if this matches where you are." />
      <Btn kind="pri" x={24} y={696} w={342} h={54} label="Yes, I'm here →" onClick={confirmStart} />
      <Btn kind="sec" x={24} y={762} w={342} h={54} label="Choose another place" onClick={back} />
    </>)

    case 'Details': return frame(dest && <>
      <Back onClick={back} />
      <Title>{dest.name}</Title>
      {map(115, 310)}
      <T x={24} y={450} w={342} h={65} size={23} bold>A little focus, a lot of possibility.</T>
      <T x={24} y={526} w={342} h={85} size={15} color="muted">{dest.description}</T>
      <Btn kind="sec" x={24} y={680} w={342} h={54} label={isSaved(dest) ? 'Remove from saved' : 'Save this place'} onClick={toggleSaved} />
      <Btn kind="pri" x={24} y={758} w={342} h={58} label="Get directions →" onClick={directions} />
    </>)

    case 'Route': return frame(start && dest && <>
      <Back onClick={back} />
      <Title>Your route</Title>
      <Card y={100} title={`${start.name} · ${floorName(start)}`} subtitle="FROM · Tap to change" onClick={chooseStart} />
      <Card y={184} title={`${dest.name} · ${floorName(dest)}`} subtitle="TO · Tap to change" onClick={chooseDestination} />
      <Toggle y={272} label="Step-free route (use lifts)" on={stepFree} onChange={setStepFreeRoute} />
      {map(325, 275, { route })}
      <T x={24} y={615} w={342} h={42} size={28} bold>
        {route === null ? 'No available route' : route.nodes.length === 1 ? "You're already here" : `${route.minutes} min · ${Math.ceil(route.metres)} m`}
      </T>
      <T x={24} y={660} w={342} h={24} size={14} color="muted">{stepFree ? 'Step-free · lift access' : 'Shortest walking route'}</T>
      <T x={24} y={695} w={342} h={48} size={13} color="muted">{route === null ? 'Change a place or try another route option.' : 'Follow the path and confirm each landmark as you go.'}</T>
      <Btn kind="pri" x={24} y={762} w={342} h={54} label="Start navigation →" disabled={!route} onClick={startNavigation} />
    </>)

    case 'Guide': {
      if (!route) return frame(null)
      const hereId = route.nodes[step], nextId = route.nodes[step + 1]
      const change = lvlOf(hereId) !== lvlOf(nextId)
      const nextFloor = b.levels[lvlOf(nextId)].name
      const total = route.nodes.length - 1
      return frame(<>
        <Back onClick={back} />
        <Title>Follow your route</Title>
        <div className="banner" style={box({ x: 24, y: 100, w: 342, h: 120 })}>
          <T x={20} y={15} w={302} h={58} size={20} bold color="white">
            {change ? `Take the ${route.passages[step] === 'lift' ? 'lift' : 'stairs'} to ${nextFloor}` : `Continue to ${label(nextId)}`}
          </T>
          <T x={20} y={79} w={302} h={30} size={13} color="mint">
            {change ? 'Confirm once you reach the next floor.' : `${Math.ceil(dist(b, hereId, nextId))} m along the highlighted path`}
          </T>
        </div>
        {map(235, 335, { route, progress: step })}
        <T x={24} y={585} w={342} h={26} size={11} bold color="muted">STEP {step + 1} OF {total} · CONFIRMED BY YOU</T>
        <div className="bar" style={box({ x: 24, y: 625, w: 342, h: 12 })}><div style={{ width: `${(step / total) * 100}%` }} /></div>
        <Btn kind="pri" x={24} y={694} w={342} h={56} label={change ? `I'm on ${nextFloor} →` : `I'm at ${label(nextId)} →`} onClick={nextStep} />
        <Btn kind="sec" x={24} y={762} w={342} h={54} label="I'm lost / update my location" onClick={chooseStart} />
      </>)
    }

    case 'Arrival': return frame(dest && <>
      <div className="badge" style={box({ x: 148, y: 65, w: 94, h: 94 })}><img src={icon('check')} alt="" /></div>
      <T x={24} y={180} w={342} h={48} size={32} bold center>You've arrived.</T>
      <T x={24} y={238} w={342} h={35} size={23} bold center>{dest.name}</T>
      <T x={24} y={279} w={342} h={26} size={14} color="muted" center>{subtitle(dest)}</T>
      {map(332, 260)}
      <Info y={612} heading="Your destination is ahead" body="Check the room sign before entering." />
      <Btn kind="sec" x={24} y={704} w={342} h={48} label={isSaved(dest) ? 'Remove from saved' : 'Save this place'} onClick={toggleSaved} />
      <Btn kind="pri" x={24} y={765} w={342} h={51} label="Done · Explore" onClick={finish} />
    </>)

    case 'Saved': {
      const places = b.pois.filter(isSaved)
      return frame(<>
        <Back onClick={back} />
        <Title>Your saved places</Title>
        <T x={24} y={100} w={342} h={35} size={14} color="muted">Keep your everyday destinations close.</T>
        <div className="list" style={box({ x: 24, y: 153, w: 342, h: 580 })}>
          {places.map(p => <Card key={p.id} title={p.name} subtitle={subtitle(p)} onClick={() => details(p)} />)}
        </div>
        {places.length === 0 && <T x={24} y={200} w={342} h={95} size={17} color="muted">No saved places yet. Open a place and tap Save this place.</T>}
        {bottomNav}
      </>)
    }

    case 'Settings': return frame(<>
      <T x={24} y={60} w={342} h={50} size={29} bold>Make it your way.</T>
      <T x={24} y={117} w={342} h={28} size={14} color="muted">Navigation preferences</T>
      <Toggle y={175} label="Prefer step-free routes" on={stepFree} onChange={preferStepFree} />
      <Toggle y={239} label="Use a 2D map" on={topDown} onChange={prefer2D} />
      <Card y={320} title="Current location" subtitle="Set or update your starting point" onClick={chooseStart} />
      <Info y={436} heading="How your location works" body="Your position is the point you confirm. Update it whenever you need to." />
      <Info y={551} heading="Prototype campus" body="Your supplied models. Demo room names, scale and floor transfers. Progress is manual." />
      {bottomNav}
    </>)
  }
}

function dist(b: Building, a: string, c: string) {
  const A = b.nodes.find(n => n.id === a)!, C = b.nodes.find(n => n.id === c)!
  return Math.hypot(A.pos[0] - C.pos[0], A.pos[1] - C.pos[1])
}
