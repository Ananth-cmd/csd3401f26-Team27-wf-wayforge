/*!
 * \file Guide.jsx
 * \brief "How to use" - short instructions for the Studio
 *
 * the full written steps, on their own page (#/help, "How to use" in the top bar).
 * inside the editor, "How to use" starts the walkthrough instead (Tour.jsx)
 *
 * it's just text, written for someone at a company who has never used the
 * Studio, so no engine words (.wfb, nodes, anchors). it's in the same order
 * you'd actually do things in.
 *
 * \author Katie Lim
 */

// each section: a title and its steps. <b> marks the button or tab to look for
const SECTIONS = [
  {
    title: "1. Add a building",
    steps: [
      <>Click <b>New building</b> and type the building name, the height between levels and the location (or <b>Use my current location</b>).</>,
      <>Add one floor plan picture per level (PNG or JPG). The list shows the top floor first. Use <b>Up</b> and <b>Down</b> if a level is in the wrong place.</>,
      <><b>Crop</b>: the box around the plan is placed for you. Drag its edges if it cut off part of the building or kept the title block. Untick <b>Same crop for every level</b> if one level needs its own.</>,
      <><b>Measure</b>: click both ends of something you know the length of (a dimension line or scale bar) and type the length in metres. This makes the rooms the right size.</>,
      <>Click <b>Create building</b>. After a few seconds the editor opens with a summary of what was found.</>,
    ],
  },
  {
    title: "2. Look around",
    steps: [
      <>Scroll to zoom, drag to move around, <b>Fit to screen</b> to see the whole level.</>,
      <>Pick a level on the left. <b>2D</b>, <b>3D</b> and <b>Rooms</b> at the top switch between the plan, the 3D model and the room list.</>,
      <><b>Blueprint</b> at the bottom shows your picture under the plan. Use the slider to fade it.</>,
      <>In <b>3D</b>, untick <b>Roof</b> or tick <b>See inside</b> to look into the rooms, and drag <b>Spread</b> to pull the floors apart. <b>This floor</b> shows only the level picked on the left.</>,
      <>Anything in <b>orange</b> was unclear on the picture. Check those first.</>,
    ],
  },
  {
    title: "3. Fix walls and doors",
    steps: [
      <><b>Select</b> (V): click a wall, then drag it, or drag one of its end dots. Change its thickness at the bottom.</>,
      <><b>Wall</b> (W): click where it starts, then where it ends.</>,
      <><b>Door</b> (D): click on a wall to put a door there. Change its width and type at the bottom.</>,
      <><b>Room</b> (R): click each corner, then click the first corner again or press Enter.</>,
      <>Delete removes what's selected. Ctrl+Z undoes, Ctrl+Y redoes.</>,
    ],
  },
  {
    title: "4. Name the rooms",
    steps: [
      <>Click a room on the plan and fill in its code (e.g. L1-01), name and type at the bottom.</>,
      <>Quicker for many rooms: open <b>Rooms</b>. Type the codes down the column, Enter moves to the next row.</>,
      <>Tick <b>Only rooms still to name</b> to see what's left. <b>Show</b> takes you to that room on the plan.</>,
      <>Corridors don't need a name.</>,
    ],
  },
  {
    title: "5. Exits, starting points, stairs and lifts",
    steps: [
      <>Set the type of the building's entrances to <b>exit</b>.</>,
      <>Tick <b>Starting point</b> on rooms where visitors can start a route, such as the lobby or main entrance. These are what visitors pick as "where am I" in the Navigator.</>,
      <>Set stair and lift rooms to <b>stair</b> and <b>lift</b>. <b>Stairs and lifts</b> on the left shows how the floors are joined. Add a link there if one is missing.</>,
    ],
  },
  {
    title: "6. Check",
    steps: [
      <><b>Checks</b> on the left lists anything missing, like rooms without a name. Click a line to go to that room.</>,
      <>To try a route the way visitors will, publish and use <b>Open in Navigator</b>.</>,
    ],
  },
  {
    title: "7. Save and publish",
    steps: [
      <><b>Save</b> keeps your changes as a draft. Visitors don't see it yet, so save as often as you like.</>,
      <><b>Publish</b> puts the saved version on the Navigator. If you have unsaved changes it asks whether to save them first or publish the last saved version.</>,
      <>The text next to the building name tells you where things are: <b>Unsaved changes</b>, <b>Saved, Navigator has v3</b> or <b>Published v4</b>.</>,
      <><b>Open in Navigator</b> shows the building the way visitors see it. They get a new version the next time they open or refresh the Navigator.</>,
    ],
  },
];

const SHORTCUTS = [
  ["V / W / D / R", "Select, Wall, Door, Room"],
  ["Delete", "Remove what's selected"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
  ["Ctrl+S", "Save"],
  ["Esc", "Stop drawing, close a box"],
  ["Enter", "Finish a room / next row in Rooms"],
];

export default function Guide() {
  return (
    <div className="howto">
      <h2>How to use the Studio</h2>
      <p className="muted">From floor plan pictures to a building visitors can find their way around.
        In the editor, click <b>How to use</b> on the left for a walkthrough of the screen.</p>
      {SECTIONS.map((s) => (
        <section key={s.title}>
          <h3>{s.title}</h3>
          <ul>{s.steps.map((step, i) => <li key={i}>{step}</li>)}</ul>
        </section>
      ))}
      <section>
        <h3>Shortcuts</h3>
        <table className="mini">
          <tbody>{SHORTCUTS.map(([keys, what]) => <tr key={keys}><td><kbd>{keys}</kbd></td><td>{what}</td></tr>)}</tbody>
        </table>
      </section>
    </div>
  );
}
