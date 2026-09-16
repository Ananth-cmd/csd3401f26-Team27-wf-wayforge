wf_add_library(wf_graph DEPS wf_core wf_doc)
if(TARGET wf_graph_test)
    target_link_libraries(wf_graph_test PRIVATE wf_read)   # the test builds its level with wf_read
endif()
