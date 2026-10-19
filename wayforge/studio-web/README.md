# Wayforge Studio (website)

The company side of Wayforge. A building owner uploads floor plans, fixes up what the
engine got wrong, names the rooms, then publishes it so it shows up in the Navigator.

```
floor plan pictures -> backend runs wf_cli build -> .wfb -> Studio (fix, tag, check) -> Publish -> Navigator
```

Made by Katie Lim (M2 item 2). React + Vite, no other libraries.

## Run it

Needs Node 18+ (`node -v` to check).

```
cd wayforge/studio-web
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` makes the static site in `dist/`.

It starts on the **mock backend** (yellow "Mock backend" tag at the top right), so it works
without any server. Buildings are kept in your browser. There's a sample 3 floor building
already in it (made with the real `wf_cli build` from `data/plans/simple_scan.png`).

## What works now

| Page | What you can do |
|---|---|
| Buildings | see all buildings, how many rooms are tagged, draft/published, delete |
| New building | drop one picture per floor (reorder them), name, floor height, lat/lon. Or open a `.wfb` you already have |
| Editor, 2D plan | zoom (scroll), pan (drag), switch floors, click rooms/walls/doors, show the walking paths |
| Editor, tools | **V** select, **W** draw a wall (snaps to wall ends), **D** add a door on a wall, **Delete** removes the selected wall/door |
| Edit panel | room code, name and kind (same as `wf_cli tag`), wall thickness, door type/width/position |
| Building panel | building name, lat/lon, heading, floor names and heights |
| Stairs/lifts | link a stair/lift room on one floor to one on another floor |
| Checks | things to fix before publishing (duplicate codes, untagged rooms, no exit, no floor links, no location) |
| Route | try a route between two room codes, or to `exit`, with step free option. It's drawn on the plan |
| 3D preview | Ananth's Unity WebGL viewer, gets the building live as you edit. Click a room in 3D to select it |
| Save / Download / Publish | Ctrl+S saves, Download gives you the `.wfb`, Publish sends it to the Navigator. Ctrl+Z / Ctrl+Y undo/redo |

### Mock vs real backend

* Mock can't read pictures (that needs `wf_cli` on a server). Uploading pictures gives you the
  sample plan with one floor per picture, so you can still test the flow.
* Mock routes use a small JS version of the route finder (`src/lib/route.js`), the real one is
  `wf_cli route`.
* To use the real backend, copy `.env.example` to `.env.local` and set `VITE_API_URL`.
  The endpoints it expects are in [API.md](API.md).

### 3D preview

The site doesn't draw 3D itself, it uses the viewer from `wayforge/viewer` (on the Ananth branch).
Build it in Unity as WebGL and copy the build into `public/viewer/` (steps in
`public/viewer/README.md`). Without it the 3D tab just shows a message, everything else works.

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
  pages/EditorPage.jsx      the editor (undo, save, publish, shortcuts)
  components/PlanView.jsx   SVG 2D plan + tools
  components/Viewer3D.jsx   embeds the Unity viewer
  components/Inspector.jsx  right side panels
public/samples/sample-3floors.wfb   sample building
public/viewer/                      put the Unity WebGL build here
```

## Still to do

* Real backend hookup once item 4 is up (upload -> `wf_cli build`, save -> `wf_cli graph`, route -> `wf_cli route`)
* Login / company accounts (who owns which building)
* Show the original floor plan picture under the 2D plan so you can compare
* Draw/edit room shapes, move wall ends by dragging
* Put it on the VM with the backend (item 5)
