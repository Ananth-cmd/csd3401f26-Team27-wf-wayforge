# 3D Viewer

The viewer shows a `.wfb` building in 3D inside a web page. It is a Unity WebGL build (project in
`wayforge/viewer`). The Studio site and the Navigator app both use it.

The viewer does not talk to the backend. The page gets the building and the route from the backend
and hands them to the viewer with the functions below. The viewer sends events back (like which
room was clicked).

Contract version: 1.0

## 1. Put it on a page

The build output goes on the web server, e.g. under `/viewer/` (see section 8). Then either:

**a) Load it into a canvas** - most control, one viewer per page.

```html
<canvas id="viewer" style="width:100%;height:600px"></canvas>
<script src="/viewer/wayforge-viewer.js"></script>
<script>
  const viewer = await WayforgeViewer.create({
    canvas: document.getElementById("viewer"),
    buildUrl: "/viewer",
    onProgress: p => console.log(Math.round(p * 100) + "%")
  });
  viewer.on("roomClicked", room => showRoomPanel(room));
  viewer.loadBuilding(await (await fetch("/api/buildings/42.wfb")).text());
</script>
```

`create()` finishes once the viewer is ready. In React: call it once in a `useEffect` with a ref to
the canvas, and call `viewer.quit()` in the cleanup.

**b) Use an iframe** - easiest, keeps Unity separate from your page.

```html
<iframe id="viewer" src="/viewer/index.html?building=/api/buildings/42.wfb"></iframe>
<script>
  const frame = document.getElementById("viewer");
  const call = (method, ...args) =>
    frame.contentWindow.postMessage({ target: "wayforge-viewer", method, args }, "*");
  window.addEventListener("message", e => {
    if (e.data?.source === "wayforge-viewer") console.log(e.data.event, e.data.data);
  });
  call("showFloor", "L2");
</script>
```

`index.html` also takes `?building=<url>` (load a building straight away) and `?view=2d` (start
in the top-down view).

## 2. Functions you can call

None of these return anything. If something goes wrong you get an `error` event.

| Function | What it does |
|---|---|
| `loadBuilding(wfb)` | show a building. Pass the `.wfb` text (or the parsed object) |
| `loadBuildingUrl(url)` | same, but the viewer downloads it. Other domains need CORS |
| `showFloor("L2")` | show only that floor |
| `showAllFloors()` | show every floor |
| `setFloorSpacing(m)` | pull the floors apart by m metres (0 to 20) to see inside |
| `setCutaway(true)` | cut the walls at 1.2 m so you can look into rooms from above |
| `showLabels(true)` | room labels on / off |
| `showRoof(true)` | roofs on / off. They only show with all floors, no cut-away and no spacing |
| `highlightRoom(ref)` | colour a room yellow. `ref` is a room id, code or `"L2:r45"`. `""` clears it |
| `focusRoom(ref)` | highlight a room and move the camera to it |
| `showRoute(route)` | draw a route (see below). `showRoute(route, { animate: false })` turns off the moving dot |
| `clearRoute()` | remove the route |
| `setView("2d")` / `setView("3d")` | top-down map or the normal 3D camera |
| `resetView()` | back to the whole building |

These are wrappers around Unity's `SendMessage("WayforgeViewer", "<Name>", text)`, e.g.
`showFloor` calls `ShowFloor`. You only need that if you are not using `wayforge-viewer.js`.

### Routes

Pass the output of `wf_cli route` (or the backend) as it is - see [wf_cli.md](wf_cli.md). The
viewer only uses `steps`:

```json
{ "steps": [ { "level": "L1", "x": 21.0, "y": 11.4, "z": 0.0, "kind": "room" },
             { "level": "L1", "x": 9.0,  "y": 3.0,  "z": 0.0, "kind": "lift" },
             { "level": "L2", "x": 9.0,  "y": 3.0,  "z": 3.5, "kind": "lift" } ] }
```

Start is green, end is red, and where the route changes floor there is an orange (stairs) or blue
(lift) marker. If the backend sends `{"ok": false, "error": "..."}`, it comes back as an `error`
event.

## 3. Events you get back

Listen with `viewer.on("roomClicked", data => ...)`, or `viewer.on("*", (name, data) => ...)` for
all of them. With an iframe they arrive as `message` events (see 1b).

| Event | When | Data |
|---|---|---|
| `ready` | viewer has started | `contract`, `unity` |
| `buildingLoaded` | after `loadBuilding` | `name`, `levels` (each with `id`, `name`, `elevation`, `rooms`), `links`, `latitude`, `longitude`, `heading` |
| `floorChanged` | after `showFloor` / `showAllFloors` | `level` (`"all"` for all floors), `name` |
| `roomClicked` | user clicks or taps a room | `level`, `id`, `code`, `name`, `kind`, `area`, `x`, `y` |
| `routeShown` | after `showRoute` | `steps` (count), `levels` |
| `error` | a call failed | `command`, `message` |

## 4. Controls

- Mouse: left drag to rotate, right or middle drag to move, wheel to zoom, click a room to select it.
- Touch: one finger to rotate, two fingers to move and pinch to zoom, tap a room to select it.
- In the 2D view, left drag / one finger moves the map instead of rotating.

## 5. Coordinates

Same as the `.wfb` file: metres, x to the east, y to the north. In Unity a plan point (x, y) on a
floor at height h is at (x, h, y).

If we add functions or event fields later the contract stays 1.x. If we rename or remove any, it
goes to 2.0 (the version is in the `ready` event).

## 6. The Unity project

Use Unity 6000.6.0f1 with WebGL Build Support (Unity Hub > Installs > Add modules). It uses the
built-in render pipeline and only a few packages so the download stays small.

- `Assets/Viewer/Runtime/` - the viewer code. `ViewerApi` is what the page calls (it also has
  `WebBridge`, which sends the events), `BuildingView` builds the 3D model, then `RouteView`,
  `CameraRig`, `BuildingData` (reads `.wfb`), `Json` and `MeshUtil`
- `Assets/Viewer/Editor/ViewerBuild.cs` - sets up the scene and does the build (menu `Wayforge`)
- `Assets/Viewer/Tests/` - EditMode and PlayMode tests
- `Assets/Viewer/Shaders/Label.shader` - room labels that hide behind walls
- `Assets/Plugins/WebGL/WayforgeBridge.jslib` - passes events from Unity to the page
- `Assets/WebGLTemplates/Wayforge/` - `index.html` (viewer with a loading screen), `test.html`
  (test page), `wayforge-viewer.js` (the functions above) and `viewer.css`

The scene, materials and WebGL settings are made by `ViewerBuild.cs`, so they are not in git. They
get created the first time you open the project, or with `Wayforge > Set Up Viewer Scene`. Run that
again if you change `ViewerBuild.cs`.

What gets drawn for each floor: floor slab, inside walls (grey), outside walls (stone colour), window
glass with frames, open door leaves, lintels over doors, and a roof over every room that has no
floor above it. Walls go from this floor's slab up to the next one. There is also a ground slab
around the building. Sill heights, materials and facades are not on a floor plan, so the viewer
uses the same defaults everywhere (windows 0.9 m up and 1.4 m tall). `.meta` files and the default `ProjectSettings` are also left
out (see `viewer/.gitignore`).

## 7. Build and test

Build in the editor with `Wayforge > Build WebGL Viewer`, or from `wayforge/`:

```
"C:\Program Files\Unity\Hub\Editor\6000.6.0f1\Editor\Unity.exe" -batchmode -quit -projectPath viewer -executeMethod Wayforge.Viewer.EditorTools.ViewerBuild.BuildFromCommandLine -logFile build.log
```

The build goes to `viewer/Build/WebGL/` (add `-buildPath <folder>` to change it).

Run the tests in `Window > General > Test Runner`, or:

```
Unity.exe -batchmode -projectPath viewer -runTests -testPlatform EditMode -testResults edit.xml
Unity.exe -batchmode -projectPath viewer -runTests -testPlatform PlayMode -testResults play.xml
```

EditMode checks reading `.wfb`, the 3D model, floors, cut-away, highlighting, clicking rooms and
routes. PlayMode calls the functions above and checks the events that come back.

To try it in a browser, serve the build folder (WebGL does not work from `file://`):

```
cd viewer/Build/WebGL
python -m http.server 8000
```

Open `http://localhost:8000/test.html`, load a `.wfb` from `wf_cli build`, and click through the
buttons. Paste `wf_cli route` output into the route box to test routes. Try Chrome, Edge and a phone
(same Wi-Fi, `http://<your pc's ip>:8000/test.html`).

## 8. Deploy

Copy everything in `viewer/Build/WebGL/` to the web server, e.g. into `/viewer/`. It is just
static files. Files are gzipped with a fallback, so no server settings are needed (it loads a bit
faster if the server sends `Content-Encoding: gzip` for `.unityweb` files).
