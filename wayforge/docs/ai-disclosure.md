# AI Disclosure

This project follows the course AI policy. AI tools were used as a support aid during development. Design decisions, integration and final review were done by the team. Each source file also carries a one-line AI declaration in its header where AI was used.

## Tools
| Tool | Provider | How it was used |
|---|---|---|
| Claude (Claude Code / Claude Opus) | Anthropic | Interactive assistant in the IDE/terminal for debugging, build setup, small code features and documentation drafts |

## Where AI was used
Ai was used to ideate, test and debug this before push:
- The image-processing, line-fitting, room-finding and serialization algorithms were designed and implemented by the team members credited in each file header. 


| Date | Area | What AI helped with | Files / output | Used by | Reviewed by |
|---|---|---|---|---|---|
| 2026-09-04 | Project skeleton | Folder layout, CMake build system, build and CI scripts | `core/CMakeLists.txt`, `core/cmake/*`, `core/script_*`, `.github/workflows/build.yml` | Ananthan Elangovan | Ananthan Elangovan |
| 2026-09-23 | Debugging the build | Diagnosing a broken local build folder (wrong generator / missing compiler environment) and checking that all 7 test suites pass | build scripts, local build only | Ananthan Elangovan | Ananthan Elangovan |
| 2026-09-24 | Pipeline verification | Small throwaway test programs to run the DLL on the sample plans; this found the SVG scale issue in `wf_open_plan` | not committed | Ananthan Elangovan | Ananthan Elangovan |
| 2026-09-29 | Studio: room display | Per-room colours, filling L-shaped rooms correctly (triangulation), room list and editing room code/name/type in the sidebar, per-room 3D floors with labels | `Runtime/PlanGeometry.cs`, `Runtime/WayforgeDocument.cs`, `Runtime/NativeBridge.cs`, `Editor/StudioWindow.cs`, `Editor/RoomBuilder.cs` | Ananthan Elangovan | Ananthan Elangovan |
| 2026-09-30 | Build infrastructure (Android) | Fixing the Android library link error (NDK path containing a space) and copying the built DLL/.so into the app project | `core/script_build_android.sh`, `core/Engine/wf_api/CMakeLists.txt` (trial, later reverted) | Ananthan Elangovan | Ananthan Elangovan |
| 2026-09-30 | App ↔ engine connection (trial) | A trial connecting the app prototype to the engine's building file and routing; reverted | Ananthan Elangovan | Ananthan Elangovan |

## What AI was not used for/
- Grading-related judgements (contribution splits, deliverable choices) were made by the team.