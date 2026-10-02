/*!
 * \file FileIO.hpp
 * \brief Small, safe helpers for reading and writing files
 *
 * Declares the file functions every other Wayforge library uses: read a
 * text or binary file, write one back, check a file exists, make a folder,
 * and get a file's extension in lower case. All paths are std::filesystem
 * paths, so the same code works on Windows, Linux and inside the Android
 * app's sandbox. Every function returns a Result/Status instead of throwing,
 * so a missing file becomes a readable error message, not a crash.
 *
 * Used by: wf_image (loading pictures), wf_doc (saving/loading .wfb),
 * wf_api (choosing how to open a plan by its extension).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Designed the Result/Status based file API (no exceptions)
 *   - Cross-platform paths through std::filesystem
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-22
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// File helpers built on std::filesystem. Never concatenate paths with "/" -
// use fs::path so Windows, Linux and the Android sandbox all behave.
#pragma once
#include <filesystem>   // fs::path, the cross-platform path type.
#include <string>       // Text file contents come back as a std::string.
#include <vector>       // Binary file contents come back as a byte vector.
#include <cstdint>      // uint8_t, one byte.
#include "Result.hpp"   // Result<T> / Status: "it worked, here is the value" or "it failed, here is why".

namespace wf::io {

namespace fs = std::filesystem;   // Short name so the declarations below stay readable.

Result<std::string>          readText (const fs::path& path);                                   // Whole file as text (Windows "\r" removed).
Result<std::vector<uint8_t>> readBytes(const fs::path& path);                                   // Whole file as raw bytes (images, etc.).
Status                       writeText (const fs::path& path, std::string_view text);           // Write text, creating folders if needed.
Status                       writeBytes(const fs::path& path, const std::vector<uint8_t>& bytes); // Write raw bytes, creating folders if needed.
bool                         exists(const fs::path& path) noexcept;                              // True if the file/folder is there. Never throws.
Status                       ensureDirectory(const fs::path& dir);                               // Make the folder (and its parents) if missing.
std::string                  lowerExtension(const fs::path& path);   // ".SVG" -> ".svg"

} // namespace wf::io
