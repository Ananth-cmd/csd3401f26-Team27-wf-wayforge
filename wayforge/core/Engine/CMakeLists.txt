# The reusable libraries. Order matters only for readability;
# CMake resolves the dependency graph from target_link_libraries.
include(WayforgeLibrary)

add_subdirectory(wf_core)     # errors, logging, maths, file io, platform
add_subdirectory(wf_doc)      # document model, property system, undo, save/load
add_subdirectory(wf_image)    # load, greyscale, threshold, rectify
add_subdirectory(wf_vector)   # SVG import, thinning, tracing, fitting, planar graph
add_subdirectory(wf_read)     # segments -> walls, openings, rooms
add_subdirectory(wf_graph)    # rooms + doors -> navigation graph, A*
add_subdirectory(wf_api)      # flat C API, built as the shared "wayforge" plugin
