wf_add_library(wf_image DEPS wf_core)
# stb is tools-only (Y*) on the approved list: it is used by the CLI and the
# editor DLL, never by the shipped Android app. Kept PRIVATE so nothing leaks.
target_link_libraries(wf_image PRIVATE stb)
