# wf_api is the one SHARED library: it is what Unity loads.
#   Windows: wayforge.dll   Linux/Android: libwayforge.so   macOS: libwayforge.dylib
file(GLOB_RECURSE API_SRC CONFIGURE_DEPENDS ${CMAKE_CURRENT_LIST_DIR}/*.cpp ${CMAKE_CURRENT_LIST_DIR}/*.h)
list(FILTER API_SRC EXCLUDE REGEX "/test/")

add_library(wf_api SHARED ${API_SRC})
set_target_properties(wf_api PROPERTIES
    OUTPUT_NAME "wayforge"
    CXX_STANDARD 20
    CXX_VISIBILITY_PRESET hidden        # only WF_API symbols are exported
    VISIBILITY_INLINES_HIDDEN ON
    FOLDER "Engine")
target_include_directories(wf_api PUBLIC ${CMAKE_CURRENT_LIST_DIR}/..)
target_link_libraries(wf_api PRIVATE wf_core wf_doc wf_image wf_vector wf_read wf_graph)
wf_apply_warnings(wf_api)
if(ANDROID)
    target_link_libraries(wf_api PRIVATE log)     # __android_log_print
endif()

# After every build, copy the dll into the Unity project so Unity always has the newest one.
if(NOT ANDROID)
    add_custom_command(TARGET wf_api POST_BUILD
        COMMAND ${CMAKE_COMMAND}
            -DSRC=$<TARGET_FILE:wf_api>
            -DDST=${CMAKE_CURRENT_LIST_DIR}/../../../unity/Assets/Wayforge/Plugins/x86_64/$<TARGET_FILE_NAME:wf_api>
            -P ${CMAKE_CURRENT_LIST_DIR}/../../cmake/CopyToUnity.cmake)
endif()

# The test links the shared library exactly the way a host would.
if(WF_BUILD_TESTS)
    add_executable(wf_api_test ${CMAKE_CURRENT_LIST_DIR}/test/main.cpp)
    target_link_libraries(wf_api_test PRIVATE wf_api)
    set_property(TARGET wf_api_test PROPERTY FOLDER "Tests")
    wf_apply_warnings(wf_api_test)
    set_property(GLOBAL APPEND PROPERTY WF_TEST_TARGETS wf_api_test)
    if(WIN32)   # put the dll next to the test exe so it can be found at run time
        add_custom_command(TARGET wf_api_test POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different $<TARGET_FILE:wf_api> $<TARGET_FILE_DIR:wf_api_test>)
    endif()
endif()
