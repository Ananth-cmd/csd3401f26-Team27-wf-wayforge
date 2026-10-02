/*!
 * \file wf_core.hpp
 * \brief Public header of wf_core, the base library of Wayforge
 *
 * One include that pulls in everything the rest of Wayforge needs at the
 * bottom layer: platform detection, maths (Vec2, Rect...), Result/Status
 * error handling, logging, file IO and ids. Every other library
 * (wf_doc, wf_image, wf_vector, wf_read, wf_graph, wf_api) includes this
 * file and nothing in here depends on them, so dependencies only point down.
 * It also holds the core version number shown by "wf_cli --version".
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Single entry header for the core layer
 *   - Version constants shared by the CLI and the C API
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-16
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// wf_core - public header.
// Errors, logging, maths, file io and platform detection. No engine, no UI.
// Everything else in Wayforge links this. Rule 1: nothing above std::filesystem.
#pragma once

#include "Platform.hpp"   // Which OS we are on (Windows / Linux / Android / macOS).
#include "Math.hpp"       // Vec2, Rect, distance, angles: the geometry used everywhere.
#include "Result.hpp"     // Result<T> / Status: return errors as values instead of throwing.
#include "Log.hpp"        // WF_LOG_INFO / WF_LOG_WARN ... logging macros.
#include "FileIO.hpp"     // readText, readBytes, writeText ... file helpers.
#include "Ids.hpp"        // IdGenerator: "w1", "r3", "n100001" ...

namespace wf {
    // Version of the core library, reported by `wf_cli --version` and wf_version().
    constexpr int         kVersionMajor = 0;
    constexpr int         kVersionMinor = 1;
    constexpr const char* kVersionString = "0.1.0";
}
