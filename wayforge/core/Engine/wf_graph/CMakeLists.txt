# wf_graph: navigation graph, A* routing and turn-by-turn instructions.
# Author: Joel Chua (c.jialiang@digipen.edu)
#
# wf_add_library (core/cmake/WayforgeLibrary.cmake) builds the static library from every
# .cpp/.hpp here except test/, and the wf_graph_test console app from test/main.cpp.
wf_add_library(wf_graph DEPS wf_core wf_doc)
if(TARGET wf_graph_test)
    target_link_libraries(wf_graph_test PRIVATE wf_read)   # the test builds its level with wf_read
endif()
