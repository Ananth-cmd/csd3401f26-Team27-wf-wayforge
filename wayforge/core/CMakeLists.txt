# ---------------------------------------------------------------------------
# Wayforge - root CMakeLists.txt
# Follows the structure from Parminder Singh's "Cross-Platform C++ Development"
# tutorial: version range, folder grouping, C++20 required, module path,
# then Engine (libraries) and Sandbox (applications).
#
# NOTE: the tutorial writes "3.4...3.28". CMake 4.x refuses anything below
# 3.5, so we use 3.16...3.28 (3.14+ is needed for FetchContent_MakeAvailable).
# ---------------------------------------------------------------------------
cmake_minimum_required(VERSION 3.16...3.28 FATAL_ERROR)
set_property(GLOBAL PROPERTY USE_FOLDERS ON)

project("wayforge" VERSION 0.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)      # static libs end up inside wayforge.so/.dll

# Where our own .cmake modules live (Warnings.cmake, BuildTests.cmake, ImportDependencies.cmake)
set(CMAKE_MODULE_PATH "${CMAKE_CURRENT_LIST_DIR}/cmake")

# Some third-party CMakeLists still declare very old minimum versions.
# CMake >= 3.31 honours this and treats them as 3.5, older CMake ignores it.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
if(ANDROID)
    # Android has no desktop windowing, so the GLFW viewer makes no sense there.
    set(WF_BUILD_VIEWER_DEFAULT OFF)
    set(WF_BUILD_TESTS_DEFAULT  OFF)
else()
    set(WF_BUILD_VIEWER_DEFAULT OFF)   # turn on with -DWF_BUILD_VIEWER=ON once GLFW is wanted
    set(WF_BUILD_TESTS_DEFAULT  ON)
endif()
option(WF_BUILD_VIEWER "Build the optional GLFW debug viewer"            ${WF_BUILD_VIEWER_DEFAULT})
option(WF_BUILD_TESTS  "Build the per-library console test apps (CTest)" ${WF_BUILD_TESTS_DEFAULT})
option(WF_BUILD_CLI    "Build the headless wf_cli converter"             ON)

message(STATUS "Wayforge: viewer=${WF_BUILD_VIEWER} tests=${WF_BUILD_TESTS} cli=${WF_BUILD_CLI} android=${ANDROID}")

# ---------------------------------------------------------------------------
# Third-party (FetchContent, pinned tags - see cmake/ImportDependencies.cmake)
# ---------------------------------------------------------------------------
include(Warnings)
include(ImportDependencies)
importDependencies()

# ---------------------------------------------------------------------------
# Build the Engine (libraries) first, then tests, then the Sandbox (apps)
# ---------------------------------------------------------------------------
ADD_SUBDIRECTORY(Engine)
include(BuildTests)
ADD_SUBDIRECTORY(Sandbox)
