# Wayforge

Floor plan in, navigable building out. A C++20 tool that turns a scanned or photographed floor
plan into a `.wfb` building file (walls, doors, rooms, navigation graph), edited in a Unity Editor
window and consumed by an Android wayfinding app.

```
photo / scan / svg  ->  wf_cli convert  ->  building.wfb  ->  Unity Studio (tag, fix)  ->  app
```

* **Build & test:** `core/script_build_and_run.sh` (or `.bat`). See [docs/setup.md](docs/setup.md).
* **Architecture:** [docs/architecture.md](docs/architecture.md) · **File format:** [docs/fileformat.md](docs/fileformat.md)
* **Libraries / approved list:** [docs/libraries.md](docs/libraries.md) · **AI disclosure:** [docs/ai-disclosure.md](docs/ai-disclosure.md)

Layout follows the module's CMake tutorial: `core/Engine/<lib>/` has the public header at the root,
sources in `Implementation/`, a console test in `test/`; `core/Sandbox/` holds the executables.

| Role | Owns |
|---|---|
| RTIS 1 | build system, `wf_image`, `wf_vector`, `wf_read`, Android build |
| RTIS 2 | `wf_api` C bridge, `NativeBridge.cs`, plugin placement |
| IMGD 1 | `wf_doc` (format, properties, undo, serialisation), `wf_cli` |
| IMGD 2 | Unity Studio window (`StudioWindow`, `PlanCanvas`, `RoomTagger`) |
| IMGD 3 | `wf_graph`, test corpus, golden tests, CI |


Status: week 1 - project skeleton only. Every library is an empty stub; the build, tests, CI and Unity plugin check all run.
