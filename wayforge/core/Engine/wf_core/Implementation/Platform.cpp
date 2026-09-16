#include "wf_core/wf_core.hpp"

namespace wf {

const char* platformName() {
#if defined(_WIN32)
    return "Windows";
#elif defined(__ANDROID__)      // must be checked before __linux__: Android defines both
    return "Android";
#elif defined(__APPLE__)
    return "macOS";
#elif defined(__linux__)
    return "Linux";
#else
    return "Unknown";
#endif
}

} // namespace wf
