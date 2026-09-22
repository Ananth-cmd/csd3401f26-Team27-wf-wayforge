#pragma once

#include "Platform.hpp"
#include "Math.hpp"
#include "Result.hpp"
#include "Log.hpp"

namespace wf {
    // Version of the core library, reported by `wf_cli --version` and wf_version().
    constexpr int         kVersionMajor = 0;
    constexpr int         kVersionMinor = 1;
    constexpr const char* kVersionString = "0.1.0";
}
