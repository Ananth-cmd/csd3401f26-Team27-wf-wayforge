# Third-party libraries and approved-list compliance

Source: `ApprovedLibraries Fall 2025.xlsx` (Y = editor and game, Y* = tools only).

| Library | Version (pinned) | Approved | Used by | In the app? |
|---|---|---|---|---|
| nlohmann::json | v3.12.0 | Y | wf_doc (`.wfb` read/write) | yes (ships in libwayforge.so) |
| pugixml | v1.15 | Y | wf_vector (SVG import) | yes, harmless |
| stb (stb_image, stb_image_write) | commit 2c980bb | Y* tools only | wf_image | linked into libwayforge.so today; the app never calls image functions. If the app build must exclude it, `WF_BUILD_IMAGE=OFF` is the planned switch. |
| GLFW | 3.4 | Y | wf_viewer (desktop only, `WF_BUILD_VIEWER=ON`) | no |
| Dear ImGui | - | Y* | not yet; planned for wf_viewer | no |
| glm / spdlog / xproperty | - | Y | not used; `wf_core` has its own Vec2, logger and property table (see architecture.md) | - |
| GoogleTest | - | not listed | not used; each library has a console test app registered with CTest | - |
| OpenCV | - | not listed | not used | - |

All dependencies are fetched by CMake `FetchContent` into `core/Dependencies/` (git-ignored) at
configure time, pinned to the tags above. No system packages, no vcpkg, no submodules.
