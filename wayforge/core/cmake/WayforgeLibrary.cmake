# ---------------------------------------------------------------------------
# wf_add_library(<name> [DEPS <targets...>])
#
# The "copy it, change the name" library recipe from the build plan (5.2),
# folded into one function so every Engine library is identical:
#   - public header at the library root, internals under Implementation/
#   - STATIC library, C++20, warnings on
#   - its own console test app  <name>_test  from test/main.cpp
# ---------------------------------------------------------------------------
function(wf_add_library LIB_NAME)
    cmake_parse_arguments(WF "" "" "DEPS" ${ARGN})

    file(GLOB_RECURSE SRC_FILES CONFIGURE_DEPENDS
        ${CMAKE_CURRENT_LIST_DIR}/*.cpp
        ${CMAKE_CURRENT_LIST_DIR}/*.hpp
        ${CMAKE_CURRENT_LIST_DIR}/*.h)
    list(FILTER SRC_FILES EXCLUDE REGEX "/test/")

    add_library(${LIB_NAME} STATIC ${SRC_FILES})
    set_property(TARGET ${LIB_NAME} PROPERTY CXX_STANDARD 20)
    set_property(TARGET ${LIB_NAME} PROPERTY FOLDER "Engine")
    source_group(TREE ${CMAKE_CURRENT_LIST_DIR} FILES ${SRC_FILES})

    # Public headers live at the library root: #include "wf_core/wf_core.hpp"
    target_include_directories(${LIB_NAME} PUBLIC ${CMAKE_CURRENT_LIST_DIR}/..)
    if(WF_DEPS)
        target_link_libraries(${LIB_NAME} PUBLIC ${WF_DEPS})
    endif()
    wf_apply_warnings(${LIB_NAME})

    # Each library gets its own tiny console test app
    if(WF_BUILD_TESTS AND EXISTS ${CMAKE_CURRENT_LIST_DIR}/test/main.cpp)
        add_executable(${LIB_NAME}_test ${CMAKE_CURRENT_LIST_DIR}/test/main.cpp)
        target_link_libraries(${LIB_NAME}_test PRIVATE ${LIB_NAME})
        set_property(TARGET ${LIB_NAME}_test PROPERTY FOLDER "Tests")
        wf_apply_warnings(${LIB_NAME}_test)
        set_property(GLOBAL APPEND PROPERTY WF_TEST_TARGETS ${LIB_NAME}_test)
    endif()
endfunction()
