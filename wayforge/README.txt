================================================================================
 WAYFORGE
 Floor plan in, navigable building out.
================================================================================

Wayforge turns floor plan pictures (one picture per floor) into a building
you can navigate: walls, doors, windows, rooms, stairs, lifts and walking
routes, saved as a .wfb file. Buildings are edited and published in the
Studio website, shown in 3D by the WebGL viewer, and used for directions in
the Navigator website.

  floor plans --> C++ engine (wf_cli) --> building.wfb --> Studio website
                                                       --> Navigator website
                                                       --> 3D viewer (WebGL)

What is in this repo (all paths are inside the wayforge/ folder):

  Folder        What it is                                       Language
  ------------  -----------------------------------------------  ------------
  core/         The engine and the wf_cli converter              C++20
  viewer/       3D building viewer (Unity WebGL)                 C# / Unity
  studio-web/   Studio website: upload, edit, publish buildings  React + Node
  navigator/    Navigator website: find a room, get directions   React + TS
  backend/      API that gives the Navigator published buildings Node + TS
  unity/        Studio as a Unity editor tool (optional)         C# / Unity
  data/plans/   Floor plans (SIT Punggol campus replica)         PNG + JSON
  tools/        Build and test scripts                           Python
  docs/         Documentation                                    Markdown


================================================================================
 1. JUST WANT TO TRY IT? (no install)
================================================================================

  Studio website     https://wayforgestudio.duckdns.org   (team login, ask
                                                          the team for it)
  Navigator website  https://navigation.duckdns.org

  In the Studio: New building > upload one floor plan picture per floor >
  Create building > fix and name rooms > Save > Publish. The Navigator then
  shows the published building.


================================================================================
 2. INSTALL THESE FIRST (fresh device)
================================================================================

  Install only what you need for the parts you want to run.

  Tool                    Needed for                 Get it
  ----------------------  -------------------------  ---------------------------
  Git                     downloading the project    https://git-scm.com
  CMake 3.21 or newer     building the engine        https://cmake.org/download
  C++ compiler            building the engine        Windows: Visual Studio
                                                     2022 or 2026 with the
                                                     "Desktop development with
                                                     C++" workload.
                                                     Mac: xcode-select --install
                                                     Linux: sudo apt install
                                                     build-essential
  Python 3                SIT campus script, test    https://python.org (tick
                          scripts, serving the       "Add python.exe to PATH")
                          3D viewer
  Node.js 20.19 or newer  the websites and backend   https://nodejs.org (LTS)
  Unity Hub + Unity       the 3D viewer and the      https://unity.com/download
  6000.6.0f1 with         Unity Studio tool          then Unity Hub > Installs >
  WebGL Build Support                                Install 6000.6.0f1 > tick
                                                     "WebGL Build Support"

  Check the installs in a new terminal (each should print a version):

    git --version
    cmake --version
    python --version
    node --version

  Windows: if PowerShell refuses to run npm, type npm.cmd instead of npm, or
  use Command Prompt.


================================================================================
 3. DOWNLOAD THE PROJECT
================================================================================

    git clone https://github.com/Ananth-cmd/csd3401f26-Team27-wf-wayforge.git
    cd csd3401f26-Team27-wf-wayforge/wayforge

  (Or on GitHub: Code > Download ZIP, unzip it, and open the wayforge folder
  inside.) Every command below is run from this wayforge/ folder unless it
  says otherwise.


================================================================================
 4. BUILD THE ENGINE (wf_cli and wayforge.dll)
================================================================================

  The first build downloads three small libraries (nlohmann/json, pugixml,
  stb), so it needs internet and takes a few minutes.

  Windows (Visual Studio 2022 or 2026):

    cmake -S core -B build/desktop
    cmake --build build/desktop --config Release
    ctest --test-dir build/desktop -C Release

    The converter is then:  build\desktop\Sandbox\wf_cli\Release\wf_cli.exe
    wayforge.dll is copied into unity/Assets/Wayforge/Plugins/x86_64/ by
    itself (close Unity first, it locks the dll).

    With Visual Studio 2026 there is also a one-step script:
      core\script_build_and_run.bat Release

  Mac / Linux:

    bash core/script_build_and_run.sh Release

    The converter is then:  build/desktop/Sandbox/wf_cli/wf_cli

  Docker (any OS with Docker Desktop, from the repo root, not wayforge/):

    docker compose build
    docker compose run --rm test

  Check it works (Windows path shown):

    build\desktop\Sandbox\wf_cli\Release\wf_cli.exe --version

  All 7 tests should pass ("100% tests passed out of 7").


================================================================================
 5. TURN FLOOR PLANS INTO A BUILDING
================================================================================

  Below, wf_cli means the full converter path from step 4, e.g. on Windows
  build\desktop\Sandbox\wf_cli\Release\wf_cli.exe

  One building, one picture per floor (PNG, JPG or SVG), lowest floor first
  (one line):

    wf_cli build mybuilding.wfb L1.png L2.png L3.png --name "My Building" --scale 0.02 --floor-height 4.5

    --scale is metres per pixel of the picture (0.02 = 2 cm per pixel).

  Name a room, then try a route between two rooms:

    wf_cli tag mybuilding.wfb L1:r12 --kind lab --code L1-05 --name "Lab"
    wf_cli route mybuilding.wfb L1-05 L3-02

  The whole SIT Punggol campus (10 blocks, 82 floor plans, about 10 minutes):

    python tools/build_sit_punggol.py build/desktop/Sandbox/wf_cli/Release/wf_cli.exe

    Output: studio-web/public/samples/sit-punggol.wfb

  Every wf_cli command and option: docs/wf_cli.md


================================================================================
 6. RUN THE WEBSITES ON YOUR OWN PC
================================================================================

  Build the engine first (step 4): the Studio server runs wf_cli and finds it
  in build/desktop by itself. Open FOUR terminals, each in the wayforge/
  folder. The first time, each one needs npm install (already in the lines
  below).

  Terminal 1 - Studio server (runs wf_cli, port 8080):
    cd studio-web
    npm install
    npm run server

  Terminal 2 - Studio website (port 5175):
    cd studio-web
    npm run dev -- --port 5175

  Terminal 3 - backend for the Navigator (port 3000):
    cd backend
    npm install
    npx tsx src/server.ts

  Terminal 4 - Navigator website (port 5173):
    cd navigator
    npm install
    npm run dev

  Then:
    1. Open http://localhost:5175 (Studio). The top right should say
       "Connected to the Studio server".
    2. New building > upload the floor plans, or upload a ready .wfb such as
       studio-web/public/samples/sit-punggol.wfb > Publish.
    3. Open http://localhost:5173 (Navigator). It shows the building
       published last.

  The Navigator must run on port 5173 (the backend only accepts it there),
  which is why the Studio uses 5175. Stop any of them with Ctrl+C.

  More: studio-web/README.md, navigator/README.md


================================================================================
 7. THE 3D VIEWER (Unity WebGL)
================================================================================

  1. Unity Hub > Add > Add project from disk > pick the viewer/ folder.
     Open it with Unity 6000.6.0f1 and wait for the import to finish.

  2. Top menu: Wayforge > Build WebGL Viewer (about 5-10 minutes).
     The build goes to viewer/Build/WebGL. Close Unity when it is done.

  3. Put a building next to the build, e.g. the SIT campus:
       copy studio-web/public/samples/sit-punggol.wfb
       to   viewer/Build/WebGL/sit_punggol.wfb

  4. Serve it and open it in Chrome or Edge:
       python -m http.server 8000 --directory viewer/Build/WebGL
       http://localhost:8000/index.html?building=sit_punggol.wfb

     Left-drag to orbit, right-drag to pan, scroll to zoom, click a room.
     http://localhost:8000/test.html has buttons for floors, cut-away,
     roofs and routes.

  The Studio website shows the same viewer in its 3D tab: npm run dev picks
  up viewer/Build/WebGL by itself. Viewer API and details: docs/viewer.md


================================================================================
 8. THE UNITY STUDIO TOOL (optional)
================================================================================

  The same editing as the Studio website, inside the Unity editor. It needs
  wayforge.dll, so build the engine on Windows first (step 4).

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


================================================================================
 9. PUTTING THE WEBSITES ON THE TEAM SERVER
================================================================================

  studio-web\deploy\deploy.bat builds and uploads the Studio, the Navigator
  and the backend in one go. It needs your SSH key on the server first.
  Build the 3D viewer (step 7) before deploying so the Studio's 3D tab is
  current. Full steps: studio-web/deploy/README.md


================================================================================
 10. IF SOMETHING GOES WRONG
================================================================================

  "wf_cli not found" in the Studio server
      Build the engine (step 4) into build/desktop, or set the WF_CLI
      environment variable to the full path of wf_cli.

  CMake says the CMakeCache.txt directory is different
      Delete the wayforge/build folder and run step 4 again.

  Could not copy the dll into Unity
      Close Unity and build again (Unity locks wayforge.dll while open).

  Port already in use
      Something is already running there: close it, or stop it with Ctrl+C.

  The Navigator shows no building
      Publish one in the Studio first, and check the backend (terminal 3)
      is running.

  The 3D viewer page stays blank
      Open it through http://localhost:8000 (step 7), not by double-clicking
      index.html, and check sit_punggol.wfb is in viewer/Build/WebGL.


================================================================================
 OTHER DOCS
================================================================================

  Build and test ........ docs/setup.md
  wf_cli commands ....... docs/wf_cli.md
  3D viewer ............. docs/viewer.md
  Architecture .......... docs/architecture.md
  File format ........... docs/fileformat.md
  Data sources .......... docs/data-sources.md
  Libraries used ........ docs/libraries.md
  AI disclosure ......... docs/ai-disclosure.md

Code layout: core/Engine/<library>/ has the public header at the root, the
source files in Implementation/ and a console test in test/. core/Sandbox/
holds the wf_cli executable.


================================================================================
 TEAM
================================================================================

  Ananthan Elangovan   build system, wf_image, wf_vector, multi-floor
                       conversion and navigation, 3D WebGL viewer
  Kervin Ong           wf_api C bridge, NativeBridge.cs, plugin placement
  Kannan Shrinivasan   wf_doc (format, properties, undo, saving), wf_cli
  Katie Lim            Unity Studio tool (StudioWindow, RoomBuilder,
                       StudioAudio, WayforgeDocument, PlanGeometry), wf_read
  Joel Chua            wf_graph, test corpus, golden tests, CI


================================================================================
 STATUS
================================================================================

  Area                                                 Status
  ---------------------------------------------------  ---------------------
  wf_core (errors, logging, maths, file IO, ids)       Done
  wf_image (load, threshold, sheet clean-up)           Done
  wf_vector (SVG import, thinning, tracing, line       Done
    fitting, clean-up, door / stair / lift symbols)
  wf_read (walls, doors, windows, rooms, corridors)    Done
  wf_doc (building model, undo, .wfb save/load)        Done
  wf_api + NativeBridge.cs (C++ <-> Unity bridge)      Done
  Multiple floors (stairs, lifts, floor links)         Done
  wf_graph (navigation graph, A* routing, step-free    Done
    and stairs-only routes, directions)
  3D WebGL viewer (model, floors, routes, JS API)      Done
  SIT Punggol campus replica (10 blocks, 82 plans)     Done
  Tests (7 CTest suites, viewer tests) and CI          Done
  QR check-in points, routes between buildings         Planned

AI tools (Claude Opus) were used as a development aid, mainly for debugging,
build setup and documentation comments. See docs/ai-disclosure.md.
