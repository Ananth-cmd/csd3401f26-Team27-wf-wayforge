# ---------------------------------------------------------------------------
# Third-party libraries, fetched with FetchContent and pinned to a tag.
# Everything here is on the Fall 2025 approved library list (see docs/libraries.md).
# Sources are downloaded into core/Dependencies/ (git-ignored), never committed.
# ---------------------------------------------------------------------------
include(FetchContent)
set(FETCHCONTENT_BASE_DIR "${CMAKE_BINARY_DIR}/Dependencies" CACHE PATH "" FORCE)   # per build dir, so VS (Ninja) and the .bat (VS generator) never share one
set(FETCHCONTENT_QUIET OFF)

# nlohmann::json  (SERIALIZATION - Y)  header-only
macro(import_json)
    if(NOT TARGET nlohmann_json::nlohmann_json)
        message(STATUS "Importing nlohmann::json...")
        FetchContent_Declare(json
            GIT_REPOSITORY https://github.com/nlohmann/json.git
            GIT_TAG        v3.12.0
            GIT_SHALLOW    TRUE)
        set(JSON_BuildTests OFF CACHE INTERNAL "")
        set(JSON_Install    OFF CACHE INTERNAL "")
        FetchContent_MakeAvailable(json)
    endif()
endmacro()

# pugixml  (SERIALIZATION - Y)  used for SVG input
macro(import_pugixml)
    if(NOT TARGET pugixml)
        message(STATUS "Importing pugixml...")
        FetchContent_Declare(pugixml
            GIT_REPOSITORY https://github.com/zeux/pugixml.git
            GIT_TAG        v1.15
            GIT_SHALLOW    TRUE)
        set(PUGIXML_BUILD_TESTS OFF CACHE BOOL "" FORCE)
        FetchContent_MakeAvailable(pugixml)
        if(NOT TARGET pugixml AND TARGET pugixml-static)
            add_library(pugixml ALIAS pugixml-static)
        endif()
    endif()
endmacro()

# stb  (IMAGE LOADING - Y*, tools only)  header-only, no CMakeLists of its own
macro(import_stb)
    if(NOT TARGET stb)
        message(STATUS "Importing stb...")
        FetchContent_Declare(stb
            GIT_REPOSITORY https://github.com/nothings/stb.git
            GIT_TAG        2c980bb59875b0d32144a71867fbdebb2f77cd20   # master snapshot, 2026-08-01
            GIT_SHALLOW    FALSE)
        FetchContent_MakeAvailable(stb)
        add_library(stb INTERFACE)
        target_include_directories(stb INTERFACE ${stb_SOURCE_DIR})
    endif()
endmacro()

# glfw  (GRAPHICS - Y)  only for the optional desktop viewer
macro(import_glfw)
    if(NOT TARGET glfw)
        message(STATUS "Importing GLFW...")
        FetchContent_Declare(glfw
            GIT_REPOSITORY https://github.com/glfw/glfw.git
            GIT_TAG        3.4
            GIT_SHALLOW    TRUE)
        set(GLFW_BUILD_DOCS     OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
        set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
        set(GLFW_INSTALL        OFF CACHE BOOL "" FORCE)
        FetchContent_MakeAvailable(glfw)
    endif()
endmacro()

macro(importDependencies)
    message(STATUS "Starting to import dependencies...")
    import_json()
    import_pugixml()
    import_stb()
    if(WF_BUILD_VIEWER)
        import_glfw()
    endif()
    message(STATUS "All dependencies have been imported successfully.")
endmacro()
