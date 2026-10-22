# Wayforge Studio (website)

The company side of Wayforge. A building owner uploads floor plans, fixes up what the
engine got wrong, names the rooms, then publishes it so it shows up in the Navigator.

```
floor plan pictures -> backend runs wf_cli build -> .wfb -> Studio (fix, tag, check) -> Publish -> Navigator
```

Made by Katie Lim (M2 item 2). React + Vite, no other libraries.

## Run it

Needs Node 18+ (`node -v` to check). On Windows, if PowerShell blocks npm, use `npm.cmd`.

```
cd wayforge/studio-web
npm install
npm run server     (window 1: the Studio backend, runs wf_cli)
npm run dev        (window 2: the website)
```

Open http://localhost:5173. The top right says **Connected to the Studio server** when the backend
is running. If it isn't, the site still opens on **offline demo data** (the mock, kept in your browser),
but uploaded blueprints can't be read.

The backend needs `wf_cli`. Build the C++ core once (Visual Studio, Build All, see the main README):
the server finds `wf_cli.exe` in `wayforge/build/...` by itself, or set `WF_CLI` to its path.

`npm run build` makes the static site in `dist/`.

### Uploading a real blueprint

1. New building, drop one picture per level (PNG/JPG/SVG/BMP).
2. **Crop**: drag a box around just the plan, leaving out the border, title block, notes and
   dimension lines. They'd turn into walls otherwise.
3. **Measure**: click both ends of a dimension line (e.g. one marked 18000 mm) and type 18.
   That sets how many metres a pixel is, which makes the walls/doors come out much better.
4. Create building. The server runs `wf_cli build` (a few seconds) and opens the editor.
   Fix what it got wrong, name the rooms, save (the server reruns `wf_cli graph`), publish.

## What works now (editor = epics 13-16)

| Epic | What you can do |
|---|---|
| 13 View | 2D plan with the uploaded blueprint underneath (Blueprint tick box + fade slider), walls, doors/windows, rooms coloured by kind, room codes/names, zoom (scroll), pan (drag), level switcher, anything the engine was less than 70% sure about in orange |
| 14 Editing | select a room and set its code, name and kind; select a wall and drag it, or drag its end dots; **W** add a wall; **D** add a door; **R** draw a new room (click the corners); **Delete** removes the selected room/wall/door; Ctrl+Z / Ctrl+Y undo/redo, Ctrl+S save |
| 15 Levels, stairs, lifts | Building details: add a level on top, remove, move up/down, set each level's height and ceiling, or one floor-to-floor height for all. Stairs and lifts: link a stair/lift on one level to another, see the links on the plan ("stairs to L2"), remove them |
| 16 Save and preview | save/load through the Studio server, 3D preview (Ananth's viewer), test a route (left column), Publish, warning when leaving with unsaved changes |

Also: Buildings list with a preview, New building with auto crop + measure, Checks before publishing,
Download .wfb.

### Mock vs real backend

* Mock can't read pictures (that needs `wf_cli` on a server). Uploading pictures gives you the
  sample plan with one floor per picture, so you can still test the flow.
* Mock routes use a small JS version of the route finder (`src/lib/route.js`), the real one is
  `wf_cli route`.
* To use the real backend, copy `.env.example` to `.env.local` and set `VITE_API_URL`.
  The endpoints it expects are in [API.md](API.md).

### 3D preview

The site doesn't draw 3D itself, it uses Ananth's viewer from `wayforge/viewer`.
Build it once in Unity (**Wayforge > Build WebGL Viewer**). The Studio picks up
`wayforge/viewer/Build/WebGL` by itself: `npm run dev` serves it, `npm run build` copies it into
`dist/viewer`. Without it the 3D tab just shows a message, everything else works.
Picking a room on the 2D plan highlights it in 3D, clicking a room in 3D selects it in 2D.

## Layout

Two columns. Buildings and New building: list/form on the left, preview on the right.
Editor: levels on the left (top floor at the top, like lift buttons), the plan on the right on
graph paper with a scale bar, 2D/3D switch on top of the plan, tools and the
edit fields for whatever you picked along the bottom. Building details, stairs/lifts and checks
open as a panel over the plan.

## Files

```
src/
  api/api.js          picks mock or real backend
  api/mockApi.js      pretend backend (localStorage)
  api/realApi.js      calls the real backend (API.md)
  lib/wfb.js          .wfb helpers: room kinds, colours, door positions, checks
  lib/route.js        simple route finder for the mock
  pages/BuildingsPage.jsx   building list
  pages/UploadPage.jsx      new building
  components/PlanPrep.jsx   crop + measure a blueprint before upload
  pages/EditorPage.jsx      the editor (undo, save, publish, shortcuts)
  components/PlanView.jsx   SVG 2D plan + tools
  components/Viewer3D.jsx   embeds the Unity viewer
  components/Inspector.jsx  edit fields (bottom bar), building/stairs/checks/route panels
  components/MiniPlan.jsx   small plan on the buildings page
public/samples/sample-3floors.wfb   sample building
public/viewer/                      only if the viewer was built somewhere else
server/server.mjs                   the Studio backend (runs wf_cli), no npm packages
server/data/                        buildings it made (not in git)
```

## Still to do

* Per-level crop, for drawing sets where levels aren't lined up
* Login / company accounts (who owns which building)
* Draw/edit room shapes, move wall ends by dragging
* Put it on the VM with the backend: see deploy/README.md
