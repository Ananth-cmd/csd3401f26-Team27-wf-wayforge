/*!
\file Platform.hpp

\brief Compile-time platform detection for Wayforge
Detects the operating system being targeted during compilation and defines
a matching Wayforge platform macro and readable platform name. Supported
platforms include Android, Windows, macOS, and Linux, with an Unknown
fallback for unsupported or unrecognized systems.

Android is checked before Linux because Android toolchains also define
linux. Checking Linux first would therefore incorrectly identify an
Android build as a normal Linux build.

Helper functions are provided through the wf namespace so other parts of
Wayforge can retrieve the current platform name or check whether the build
is targeting Android without repeating preprocessor checks.


Links: Used by platform-specific Wayforge code and APIs that need to select
behaviour depending on the current operating system.


\author Kervin Ong Guan Cheng (Kervinguancheng.ong@digipen.edu)



Contribution: Kervin Ong Guan Cheng 100%
Compile-time detection for Android, Windows, macOS, and Linux
Platform name macros and unknown-platform fallback
platformName() and isAndroid() helper functions


AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.



\date 2026-10-02

\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
*/
#pragma once

#if defined(__ANDROID__)
    #define WF_PLATFORM_ANDROID 1
    #define WF_PLATFORM_NAME "Android"
#elif defined(_WIN32)
    #define WF_PLATFORM_WINDOWS 1
    #define WF_PLATFORM_NAME "Windows"
#elif defined(__APPLE__)
    #define WF_PLATFORM_MACOS 1
    #define WF_PLATFORM_NAME "macOS"
#elif defined(__linux__)
    #define WF_PLATFORM_LINUX 1
    #define WF_PLATFORM_NAME "Linux"
#else
    #define WF_PLATFORM_UNKNOWN 1
    #define WF_PLATFORM_NAME "Unknown"
#endif

namespace wf {
    constexpr const char* platformName() noexcept { return WF_PLATFORM_NAME; }
    constexpr bool isAndroid() noexcept {
#if defined(WF_PLATFORM_ANDROID)
        return true;
#else
        return false;
#endif
    }
}
