# wf_cli - the headless converter. This is what runs on Ubuntu in CI and what
# everyone develops against for the first six weeks (no Unity restart cycle).
file(GLOB_RECURSE CLI_SRC CONFIGURE_DEPENDS ${CMAKE_CURRENT_LIST_DIR}/*.cpp ${CMAKE_CURRENT_LIST_DIR}/*.hpp)
add_executable(wf_cli ${CLI_SRC})
set_property(TARGET wf_cli PROPERTY CXX_STANDARD 20)
set_property(TARGET wf_cli PROPERTY FOLDER "Sandbox")
target_link_libraries(wf_cli PRIVATE wf_core wf_doc wf_image wf_vector wf_read wf_graph)
wf_apply_warnings(wf_cli)
