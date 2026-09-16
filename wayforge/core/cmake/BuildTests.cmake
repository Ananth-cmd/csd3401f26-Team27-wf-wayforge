# ---------------------------------------------------------------------------
# Test wiring. Every Engine library has its own tiny console test app
# (Engine/<lib>/test/main.cpp) that returns 0 on success. This module
# registers each of them with CTest so `ctest --test-dir build/desktop`
# runs everything. GoogleTest can be dropped in later via FetchContent
# without changing the library CMakeLists.
# ---------------------------------------------------------------------------
if(WF_BUILD_TESTS)
    enable_testing()
    get_property(_wf_tests GLOBAL PROPERTY WF_TEST_TARGETS)
    foreach(t ${_wf_tests})
        add_test(NAME ${t} COMMAND ${t})
        set_tests_properties(${t} PROPERTIES WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}/..")
    endforeach()
    message(STATUS "Registered tests: ${_wf_tests}")
endif()
