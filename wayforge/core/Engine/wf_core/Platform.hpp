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