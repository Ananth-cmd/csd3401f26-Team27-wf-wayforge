# Copies the freshly built wayforge.dll into the Unity project.
# If Unity is open it locks the dll, so we only warn instead of failing the build.
get_filename_component(dir "${DST}" DIRECTORY)
file(MAKE_DIRECTORY "${dir}")
file(COPY_FILE "${SRC}" "${DST}" RESULT result ONLY_IF_DIFFERENT)
if(result)
    message(WARNING "Could not copy the dll into Unity (close Unity and build again): ${result}")
else()
    message(STATUS "Copied ${SRC} -> ${DST}")
endif()
