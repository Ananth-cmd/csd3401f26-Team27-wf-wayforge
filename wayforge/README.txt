================================================================================
 WAYFORGE
 Floor plan in, navigable building out.
================================================================================

A C++20 tool that turns a scanned or photographed floor plan into a .wfb
building file (walls, doors, rooms, navigation graph). The building is shown
and edited in a Unity Editor tool (Wayforge Studio) and used by an Android
wayfinding app.

  photo / scan / svg -> C++ core -> building.wfb -> Unity Studio -> app


================================================================================
 RUNNING THE PROJECT (PLEASE READ FIRST)
================================================================================

There are TWO separate Unity projects in this repo:

  Project              Folder                        Unity version
  -------------------  ----------------------------  ---------------
  Wayforge Studio      wayforge/unity                6000.6.0f1
  (the tool)
  Wayforge app         wayforge/android-prototype    6000.0.70f1
  (Android prototype)

Open Wayforge Studio first. It needs wayforge.dll, which is built from the
C++ core. BUILD THE CORE BEFORE OPENING STUDIO, otherwise the Studio buttons
stay greyed out. The app project does not need the dll.


--------------------------------------------------------------------------------
 STEP 1 - BUILD THE C++ CORE (makes wayforge.dll)
--------------------------------------------------------------------------------

  1. Close Unity if it is open (Unity locks the dll so it can't be replaced).

  2. Open Visual Studio (2022 or newer, with "Desktop development with C++").

  3. File > Open > Folder... and pick the whole wf-wayforge folder
     (the repo root).

  4. Visual Studio asks to enable CMake. Click "Enable and set source
     directory" and pick:
         wayforge/core
     (the folder with CMakeLists.txt and CMakePresets.json)

  5. In the configuration dropdown pick "Desktop Debug (Ninja)" and wait
     for "CMake generation finished".

  6. Build > Build All.
     wayforge.dll is copied automatically into:
         wayforge/unity/Assets/Wayforge/Plugins/x86_64/
     Nothing needs to be copied by hand.

  Shortcut: wayforge\core\script_build_and_run.bat does the build, runs the
  tests and copies the dll in one go.

  If CMake says the CMakeCache.txt directory is different, delete the
  wayforge/build folder and do Project > Delete Cache and Reconfigure.


--------------------------------------------------------------------------------
 STEP 2 - OPEN WAYFORGE STUDIO (the tool)
--------------------------------------------------------------------------------

  1. Unity Hub > Add > Add project from disk, and pick:
         wayforge/unity

  2. Open it with Unity 6000.6.0f1 (Unity Hub offers to install it if
     it is missing).

  3. In the top menu go to:  Wayforge > Studio

  4. Click "Import image" and pick:
         data/plans/sit-punggol/E2/E2 - Level 01.png
     (any level of any block in data/plans/sit-punggol/)
     The walls, doors and rooms show up as a 2D blueprint.

  5. Click a room to rename it, drag to draw a new room, then click
     "Make 3D" to build the model in the Scene view.

  6. "Audio" in the toolbar: music on/off, play all 8 sounds, open the
     audio config.


--------------------------------------------------------------------------------
 STEP 3 - OPEN THE WAYFORGE APP (prototype)
--------------------------------------------------------------------------------

  1. Unity Hub > Add > Add project from disk, and pick:
         wayforge/android-prototype

  2. Open it with Unity 6000.0.70f1.

  3. Open the scene:
         Assets/WayforgeApp/Scenes/Main.unity
     and press Play.

  4. To build the APK:  Wayforge App > Build Android APK
     (needs Android Build Support installed through Unity Hub)

  More details are in wayforge/android-prototype/README.md


================================================================================
 OTHER DOCS
================================================================================

  Build and test ........ docs/setup.md
  Architecture .......... docs/architecture.md
  File format ........... docs/fileformat.md
  Libraries used ........ docs/libraries.md
  AI disclosure ......... docs/ai-disclosure.md

Code layout: core/Engine/<library>/ has the public header at the root, the
source files in Implementation/ and a console test in test/. core/Sandbox/
holds the executables.


================================================================================
 TEAM
================================================================================

  Ananthan Elangovan   build system, wf_image, wf_vector, Android build
  Kervin Ong           wf_api C bridge, NativeBridge.cs, plugin placement
  Kannan Shrinivasan   wf_doc (format, properties, undo, saving), wf_cli
  Katie Lim            Unity Studio tool (StudioWindow, RoomBuilder,
                       StudioAudio, WayforgeDocument, PlanGeometry), wf_read
  Joel Chua            wf_graph, test corpus, golden tests, CI


================================================================================
 STATUS
================================================================================

The core pipeline works end to end: a floor plan picture is turned into
walls, doors and rooms by the C++ engine and shown in Wayforge Studio
inside Unity.

  Area                                                 Status
  ---------------------------------------------------  ---------------------
  wf_core (errors, logging, maths, file IO, ids)       Done
  wf_image (load, adaptive threshold, perspective)     Done
  wf_vector (SVG import, thinning, tracing, line       Done
    fitting, clean-up, room loops)
  wf_read (walls, doors, rooms, corridors, confidence) Done
  wf_doc (building model, undo, .wfb save/load)        Done
  wf_api + NativeBridge.cs (C++ <-> Unity bridge)      Done
  Wayforge Studio (import, 2D blueprint, rename        Done
    rooms, 3D model, open .wfb)
  Tests (7 CTest suites) and CI (Windows, Ubuntu,      Done
    Docker)
  Save from Studio to .wfb                             In progress
  CI build of the DLL and Android library              In progress
                                                       (switched off for now)
  wf_graph (navigation graph, A* routing)              Written and tested,
                                                       not connected yet
  Android app prototype                                In progress (demo data,
                                                       not connected to the
                                                       engine yet)
  Multiple floors, QR check-in points                  Planned

AI tools (Claude Opus) were used as a development aid, mainly for debugging,
build setup and documentation comments. See docs/ai-disclosure.md.
