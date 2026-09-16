# The applications. Thin executables that link against the Engine libraries.
if(WF_BUILD_CLI)
    add_subdirectory(wf_cli)
endif()
if(WF_BUILD_VIEWER)
    add_subdirectory(wf_viewer)
endif()
