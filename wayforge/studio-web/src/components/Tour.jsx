/*!
 * \file Tour.jsx
 * \brief the step by step walkthrough of the editor ("How to use")
 *
 * each step lights up one real part of the editor and shows a small card
 * next to it saying what it does. Next / Back (or the arrow keys) move
 * through it, Esc or "Skip" closes it.
 *
 * how it's drawn: a see-through box sits exactly on top of the part being
 * shown, with a huge shadow around it that darkens the rest of the page.
 * the box follows the part if the window is resized.
 *
 * a step can ask the editor to switch view first (view: "rooms" opens the
 * room table) so the part it talks about is actually on screen.
 *
 * it opens by itself the first time someone opens the editor (remembered in
 * this browser), and again whenever "How to use" is clicked.
 *
 * \author Katie Lim
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// what the tour shows, in order. target = which part of the editor (a CSS selector),
// no target = a card in the middle of the screen
export const EDITOR_TOUR = [
  {
    title: "Welcome to the Studio",
    text: "A quick look at the editor, about a minute. Use the arrow keys or the buttons, Esc to stop.",
  },
  {
    target: ".levels", place: "right",
    title: "Levels",
    text: "Every floor of the building, top floor first like the buttons in a lift. Click one to see it.",
  },
  {
    target: ".plan-wrap", place: "inside", view: "2d",
    title: "The floor plan",
    text: "Scroll to zoom and drag to move around. Click a room, wall or door to pick it. Anything in orange was unclear on your picture, so check those first.",
  },
  {
    target: ".view-switch", place: "below",
    title: "2D, 3D and Rooms",
    text: "Switch between the flat plan, the 3D model and a table of all the rooms.",
  },
  {
    target: ".tools", place: "above",
    title: "Tools",
    text: "Select (V) to pick and move things, Wall (W), Door (D) and Room (R) to draw. Blueprint shows your picture under the plan, the slider fades it.",
  },
  {
    target: ".edit-strip", place: "above",
    title: "Edit what you picked",
    text: "Whatever you click on the plan shows up here. For a room: its code, name, type, and whether visitors can start a route there.",
  },
  {
    target: ".room-table", place: "inside", view: "rooms",
    title: "Name rooms quickly",
    text: "All the rooms in one list. Type a code and press Enter to jump to the next row. Tick \"Only rooms still to name\" to see what's left.",
  },
  {
    target: ".side-links", place: "right", view: "2d",
    title: "Building, stairs, checks",
    text: "Building details (name, location, floor heights), Stairs and lifts that join the floors, Checks for anything missing, and Test a route to walk it like a visitor would.",
  },
  {
    target: ".ed-actions", place: "below",
    title: "Save and Publish",
    text: "Save keeps your work as a draft, visitors don't see it. Publish puts the saved version on the Navigator. Undo and Redo are here too.",
  },
  {
    target: ".ed-title .status", place: "below",
    title: "Where things are",
    text: "Tells you if you have unsaved changes, and which version the Navigator has.",
  },
  {
    target: ".side-links .tour-btn", place: "right",
    title: "That's it",
    text: "Click How to use any time to see this again. The How to use page has the full steps, from uploading floor plans to publishing.",
  },
];

const PAD = 6;      // space between the part and the light box around it
const CARD_W = 320; // card width in px
const GAP = 14;     // space between the light box and the card

// where to put the card next to the box (cardH = the card's real height), kept inside the window
function cardPosition(box, place, cardH) {
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!box) return { left: (vw - CARD_W) / 2, top: (vh - cardH) / 2 };
  let left = box.left, top = box.bottom + GAP;                       // below
  if (place === "above") top = box.top - GAP - cardH;
  if (place === "right") { left = box.right + GAP; top = box.top; }
  if (place === "inside") { left = box.left + 24; top = box.top + 24; } // big parts: card sits on top
  return {
    left: Math.max(12, Math.min(left, vw - CARD_W - 12)),
    top: Math.max(12, Math.min(top, vh - cardH - 12)),
  };
}

export default function Tour({ steps, onView, onClose }) {
  const [at, setAt] = useState(0);
  const [box, setBox] = useState(null); // where the lit part is on screen
  const cardRef = useRef(null);
  const [cardH, setCardH] = useState(180); // the card's height, measured after it's drawn
  const step = steps[at];
  const last = at === steps.length - 1;

  // switch the editor's view if this step needs it (the room table, back to the plan)
  useEffect(() => { if (step.view) onView(step.view); }, [at]); // only when the step changes

  // measure the part after the editor has drawn it, and again if the window changes size
  useLayoutEffect(() => {
    let frame = 0, tries = 0;
    const measure = () => {
      const el = step.target && document.querySelector(step.target);
      if (!el) {
        setBox(null);
        // a step that switched view (the room table) may need a few frames before its part is there
        if (step.target && tries++ < 20) frame = requestAnimationFrame(measure);
        return;
      }
      const r = el.getBoundingClientRect();
      setBox({ left: r.left - PAD, top: r.top - PAD, right: r.right + PAD, bottom: r.bottom + PAD,
        width: r.width + PAD * 2, height: r.height + PAD * 2 });
    };
    frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, [at, step.target]);

  // keys: arrows / Enter to move, Esc to stop. capture first so the editor's own shortcuts don't run
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") last ? onClose() : setAt(at + 1);
      else if (e.key === "ArrowLeft") setAt(Math.max(0, at - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [at, last, onClose]);

  // the text is different on each step, so the card's height changes too
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && h !== cardH) setCardH(h);
  });

  const card = cardPosition(box, step.place, cardH);
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* the light box. with no target the whole page is dimmed and the card sits in the middle */}
      {box
        ? <div className="tour-light" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />
        : <div className="tour-dim" />}
      <div className="tour-card" ref={cardRef} style={{ left: card.left, top: card.top, width: CARD_W }}>
        <p className="tour-count">{at + 1} of {steps.length}</p>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-buttons">
          <button className="quiet small" onClick={onClose}>{last ? "Close" : "Skip"}</button>
          <span className="grow" />
          {at > 0 && <button className="small" onClick={() => setAt(at - 1)}>Back</button>}
          <button className="primary small" onClick={() => (last ? onClose() : setAt(at + 1))} autoFocus>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
