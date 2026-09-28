// wf_core - public header.
// Errors, logging, maths, file io and platform detection. No engine, no UI.
// Everything else in Wayforge links this. Rule 1: nothing above std::filesystem.
#pragma once

#include "Platform.hpp"
#include "Math.hpp"
#include "Result.hpp"
#include "Log.hpp"
#include "FileIO.hpp"
#include "Ids.hpp"

namespace wf {
    // Version of the core library, reported by `wf_cli --version` and wf_version().
    constexpr int         kVersionMajor = 0;
    constexpr int         kVersionMinor = 1;
    constexpr const char* kVersionString = "0.1.0";
}
