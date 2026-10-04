# Wayforge

Floor plan in, navigable building out. A C++20 tool that turns a scanned or photographed floor
plan into a `.wfb` building file (walls, doors, rooms, navigation graph), edited in a Unity Editor
window and consumed by an Android wayfinding app.

```
photo / scan / svg  ->  wf_cli convert  ->  building.wfb  ->  Unity Studio (tag, fix)  ->  app
```

## Running the tool (please read first)

The Unity tool (Wayforge Studio) needs `wayforge.dll`, which is built from the C++ core.
**Build the core first, otherwise the Studio buttons stay greyed out.**

1. **Close Unity** if it is open (Unity locks the dll so it can't be replaced).
2. Open Visual Studio (2022 or newer, with "Desktop development with C++").
3. File > Open > Folder... and pick the whole `wf-wayforge` folder (the repo root).
4. Visual Studio asks to enable CMake: click Enable and set source directory and pick
`wayforge/core` (the folder with CMakeLists.txt and `CMakePresets.json`).
5. In the configuration dropdown pick Desktop Debug (Ninja) and wait for "CMake generation finished".
6. Build > Build All. wayforge.dll is copied into
wayforge/unity/Assets/Wayforge/Plugins/x86_64/ automatically.
7. In Unity: **Wayforge > Studio**, then **Import image** and pick `data/plans/simple_scan.png`, then **Make 3D**.

Shortcut: `core\script_build_and_run.bat` does the build, runs the tests and copies the dll in one go.

The Android app prototype is a separate Unity project in `android-prototype/` (see its README).

* **Build & test:** `core/script_build_and_run.sh` (or `.bat`). See [docs/setup.md](docs/setup.md).
* **Architecture:** [docs/architecture.md](docs/architecture.md) · **File format:** [docs/fileformat.md](docs/fileformat.md)
* **Libraries / approved list:** [docs/libraries.md](docs/libraries.md) · **AI disclosure:** [docs/ai-disclosure.md](docs/ai-disclosure.md)

Layout follows the module's CMake tutorial: `core/Engine/<lib>/` has the public header at the root,
sources in `Implementation/`, a console test in `test/`; `core/Sandbox/` holds the executables.

| Role | Owns |
|---|---|
| Ananthan Elangovan | build system, `wf_image`, `wf_vector`, Android build |
| Kervin Ong | `wf_api` C bridge, `NativeBridge.cs`, plugin placement |
| Kannan Shrinivasan | `wf_doc` (format, properties, undo, serialisation), `wf_cli` |
| Katie Lim | Unity Studio tool (`StudioWindow`, `RoomBuilder`, `StudioAudio`, `WayforgeDocument`, `PlanGeometry`), `wf_read` |
| Joel Chua | `wf_graph`, test corpus, golden tests, CI |


## Status

The core pipeline works end to end: a floor plan picture is turned into walls, doors and rooms by the C++ engine and shown in the Wayforge Studio inside Unity.

| Area | Status |
|---|---|
| `wf_core` (errors, logging, maths, file IO, ids) | Done |
| `wf_image` (load, adaptive threshold, perspective fix) | Done |
| `wf_vector` (SVG import, thinning, tracing, line fitting, clean-up, room loops) | Done |
| `wf_read` (walls, doors, rooms, corridors, confidence) | Done |
| `wf_doc` (building model, undo, `.wfb` save/load) | Done |
| `wf_api` + `NativeBridge.cs` (C++ ↔ Unity bridge) | Done |
| Wayforge Studio (import, 2D blueprint, rename rooms, 3D model, open `.wfb`) | Done |
| Tests (7 CTest suites, one per library) and CI (Windows, Ubuntu, Docker) | Done |
| Save from Studio to `.wfb` | In progress |
| CI build of the DLL and Android library | In progress (temporarily switched off) |
| `wf_graph` (navigation graph, A* routing) | Written and tested, not connected to `wf_api` yet |
| Android app prototype | In progress (runs with demo data, not yet connected to the engine) |
| Multiple floors, QR check-in points | Planned |

AI tools (Claude Opus) were used here and there as a development aid, mainly for debugging, build setup and documentation comments. See [docs/ai-disclosure.md](docs/ai-disclosure.md).