# Zero-warning policy, per the course tutorial:
#   -Wall -Wextra on GCC/Clang, /W3 /WX- on MSVC.
# Usage: wf_apply_warnings(<target>)
function(wf_apply_warnings TARGET)
    if (CMAKE_CXX_COMPILER_ID MATCHES "GNU|Clang")
        target_compile_options(${TARGET} PRIVATE -Wall -Wextra -Wpedantic)
    elseif (MSVC)
        target_compile_options(${TARGET} PRIVATE /W3 /WX- /utf-8)
        target_compile_definitions(${TARGET} PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX)
    endif()
endfunction()
