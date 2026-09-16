# wf_viewer - optional desktop debug viewer (GLFW + legacy OpenGL 1.x, no loader needed).
# Draws a .wfb: walls coloured by confidence, doors, rooms, graph, and a route between two
# clicked rooms. ON with -DWF_BUILD_VIEWER=ON. Never built for Android.
# Approved libraries: glfw (Y). Dear ImGui (Y*) can be added here later for a tools-only UI.
find_package(OpenGL REQUIRED)
add_executable(wf_viewer main.cpp)
set_property(TARGET wf_viewer PROPERTY CXX_STANDARD 20)
set_property(TARGET wf_viewer PROPERTY FOLDER "Sandbox")
target_link_libraries(wf_viewer PRIVATE wf_core glfw OpenGL::GL)
wf_apply_warnings(wf_viewer)
