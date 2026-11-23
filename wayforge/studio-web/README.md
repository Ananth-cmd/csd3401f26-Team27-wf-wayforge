# Wayforge Studio (website)

The company side of Wayforge. A building owner uploads floor plans, fixes up what the
engine got wrong, names the rooms, then publishes it so it shows up in the Navigator.

```
floor plan pictures -> server runs wf_cli build -> .wfb -> Studio (fix, name, check) -> Publish -> Navigator
```



## Where it is

**https://wayforgestudio.duckdns.org**, log in with the team login Username: Studio, Password: berginc2026. Published buildings show up straight away in the Navigator at
**https://navigation.duckdns.org**.

The top right says **Connected to the Studio server** when everything is working.

## Putting a new version live

One step from Windows, it builds the Studio and the Navigator and updates the server:

```
wayforge\studio-web\deploy\deploy.bat
```

Your PC's SSH key has to be on the server first. Everything about the server (https, team login,
backups, handy commands) is in [deploy/README.md](deploy/README.md). The endpoints the website uses
are in [API.md](API.md).

## Using it

The site has a **How to use** page, and the editor opens with a short walkthrough every time
(**Skip all** to close it).

### Making a building

1. **New building**, drop one picture per level (PNG/JPG/SVG/BMP). Or open a `.wfb` you already have.
2. **Crop**: the box around the plan is guessed for you, drag it to leave out the border, title block,
   notes and dimension lines. They'd turn into walls otherwise.
3. **Measure**: click both ends of a dimension line (e.g. one marked 18000 mm) and type 18.
   That sets how many metres a pixel is, which makes the walls and doors come out much better.
4. **Create building**. The server runs `wf_cli build` (a few seconds) and opens the editor.
5. Fix what it got wrong, name the rooms, **Save**, then **Publish**.

### Save vs publish

* **Save** keeps your changes as a draft (the server reruns `wf_cli graph` to redo the walking paths).
  The Navigator doesn't see it yet.
* **Publish** sends it to the Navigator. You can publish what you have now, or the last saved version.
* The top bar says where you are: Unsaved changes / Draft, not published / Published vN.

## What works now

| Part | What you can do |
|---|---|
| Buildings | all buildings with a small preview, draft/published, delete |
| New building | pictures per level (reorder, auto crop, measure), name, floor height, lat/lon. Or a `.wfb` |
| 2D plan | walls, doors/windows, rooms coloured by kind, room names that resize as you zoom, zoom (scroll), pan (drag), level switcher, anything the engine wasn't sure about in orange |
| Editing | room code, name and kind; drag walls or their end dots; **W** add a wall, **D** add a door, **R** draw a room, **Delete** removes what's selected; Ctrl+Z / Ctrl+Y undo/redo, Ctrl+S save |
| Rooms tab | every room in one table: search, "only rooms still to name", type names straight in (Enter goes to the next row), set the block |
| Building details | name, location, levels (add, remove, reorder, heights), and the **block** (e.g. E2) |
| Stairs and lifts | link a stair/lift on one level to another, the links show on the plan |
| Starting points | tick a room as a starting point so people can pick it as "where am I" in the Navigator |
| 3D | Ananth's Unity viewer with the building as you edit. Whole building / one floor, roof on/off, **See inside** (cuts the walls away), spread the floors apart, labels. Click a room in 3D to select it |
| Checks | things to fix before publishing (duplicate codes, rooms with no name, no block, no location...) |
| Download | gives you the `.wfb` |

### Blocks (for the 3D buildings in the Navigator)

The Navigator draws each block as its own 3D building, using the start of the room code
(`E2-01-05` is block E2). Set it once in **Building details > Block > Set for all rooms**, or per
room in the Rooms tab. With no block the Navigator shows a flat plan instead.

### 3D viewer

The Studio doesn't draw 3D itself, it uses Ananth's viewer from `wayforge/viewer`.
Build it in Unity (**Wayforge > Build WebGL Viewer**) before running `deploy.bat` and it gets copied
in. Without it the 3D tab just shows a message, everything else still works.

## Files

```
src/
  api/api.js                picks the server or the offline demo data
  api/realApi.js            calls the Studio server (API.md)
  api/mockApi.js            offline demo data, only used when there's no server
  lib/wfb.js                .wfb helpers: room kinds, colours, blocks, starting points, checks
  lib/autocrop.js           guesses where the plan is on the sheet
  pages/BuildingsPage.jsx   building list
  pages/UploadPage.jsx      new building
  pages/EditorPage.jsx      the editor (undo, save, publish, shortcuts)
  components/PlanPrep.jsx   crop + measure a picture before upload
  components/PlanView.jsx   2D plan + tools
  components/RoomTable.jsx  Rooms tab
  components/Inspector.jsx  edit fields, building details, stairs/lifts, checks
  components/Viewer3D.jsx   embeds the Unity viewer + the 3D bar
  components/Tour.jsx       walkthrough when the editor opens
  components/Guide.jsx      How to use page
  components/MiniPlan.jsx   small plan on the buildings page
public/samples/sit-punggol.wfb   sample building (SIT Punggol campus)
server/server.mjs                the Studio server (runs wf_cli), no npm packages
deploy/                          deploy.bat, server setup, backups (see deploy/README.md)
```


