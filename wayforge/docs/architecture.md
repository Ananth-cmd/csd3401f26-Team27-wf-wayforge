# Wayforge Architecture

Wayforge turns a floor plan picture into a building with walls, doors and rooms. The C++ engine does the processing. Unity is used for the editor tool (Studio) and the phone app.

Rules:
1. The engine has no Unity code, so it also runs on Linux, Docker and Android.
2. `building.wfb` (JSON) is the main building file.
3. The phone app only reads buildings.

## Layers
Unity Studio (StudioWindow, RoomBuilder, StudioAudio, WayforgeDocument)
|
NativeBridge.cs - only file that calls the DLL
|
wf_api - wayforge.dll / libwayforge.so (C functions)
|
wf_read wf_graph wf_vector wf_image
|
wf_doc
|
wf_core

Dependencies only go downwards, with no cycles.

## Modules

| Module | Does | Uses |
|---|---|---|
| wf_core | errors (Result), logging, maths, files, ids | - |
| wf_doc | building data, undo, save/load .wfb | wf_core, nlohmann::json |
| wf_image | load picture, ink vs paper, straighten photos | wf_core, stb |
| wf_vector | picture to straight lines, SVG import, clean-up, room loops | wf_core, wf_image, pugixml |
| wf_read | lines to walls, doors and rooms | wf_core, wf_doc, wf_vector |
| wf_graph | navigation graph and A* (not switched on yet) | wf_core, wf_doc |
| wf_api | C functions Unity calls | all of the above |

Each module has its own test in `test/main.cpp` (7 in total).

## Unity Studio files

| File | Does |
|---|---|
| StudioWindow.cs | the window: buttons, 2D plan, room list and editing |
| RoomBuilder.cs | builds the 3D model |
| StudioAudio.cs | music and sound effects |
| WayforgeDocument.cs | holds walls, doors, rooms in C# |
| PlanGeometry.cs | room area, centre, triangles for drawing |
| NativeBridge.cs | calls the DLL |

## How an import works

1. StudioWindow calls `WayforgeDocument.ImportImage`.
2. NativeBridge calls `wf_convert_image` in the DLL.
3. wf_image loads the picture and marks ink and paper.
4. wf_vector thins the lines, traces them, fits straight segments, converts to metres and cleans them up.
5. wf_read finds walls, doors and rooms.
6. wf_doc stores them as a building.
7. Unity copies the data back, draws the 2D plan and can build the 3D model.

SVG files skip steps 3 and the start of 4. Saved `.wfb` files are loaded by wf_doc directly.

## Error handling

- C++ functions return a Result with an error message instead of crashing.
- Every DLL function has try/catch, and the message is read with `wf_last_error()`.
- Unity shows the message in a popup.
- If the DLL is missing, the Studio buttons are disabled.

## Build

- CMake builds everything. Libraries are downloaded automatically (`core/cmake/ImportDependencies.cmake`).
- `script_build_and_run.bat` builds, runs the tests and copies the DLL into Unity.
- GitHub Actions builds and tests on every push (Windows, Ubuntu, Docker, and the websites).

## Folders
wayforge/
core/Engine/ C++ libraries
core/Sandbox/ wf_cli, wf_viewer
core/cmake/ build helpers
unity/ Studio project
android-prototype/ phone app project
data/plans/ sample floor plans
tools/ test scripts
docs/ documents

## Not done yet

- Save button in Studio
- wf_graph switched on
- Phone app using the engine
- More than one floor