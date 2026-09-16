// wf_core - foundation library: maths, results, logging, file IO, platform detection.
// No third-party dependencies. Everything else depends on this; this depends on nothing.
#pragma once

namespace wf {

inline constexpr const char* kVersionString = "0.0.1";

// "Windows", "Linux", "Android" or "macOS".
const char* platformName();

// TODO(RTIS1): Vec2, Result<T>, logger, file helpers.

} // namespace wf
