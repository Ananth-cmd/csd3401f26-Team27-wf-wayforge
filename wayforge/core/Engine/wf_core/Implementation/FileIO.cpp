/*!
 * \file FileIO.cpp
 * \brief Implementation of the Wayforge file helpers
 *
 * Reads and writes whole files in one go. Every function checks that the
 * file actually opened and reports a clear message through Result/Status
 * if it did not, so callers (image loader, .wfb loader) can show the user
 * what went wrong instead of crashing.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Whole-file text and binary reading with clear error messages
 *   - Line-ending normalisation so files parse the same on every OS
 *   - Writes create missing folders automatically
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-22
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_core/FileIO.hpp"   // Declarations of everything in this file.
#include <fstream>              // std::ifstream / std::ofstream for the actual reading and writing.
#include <iterator>             // std::istreambuf_iterator: read a whole stream in one line.
#include <algorithm>            // std::remove and std::transform.
#include <cctype>               // std::tolower for the extension helper.

namespace wf::io {

Result<std::string> readText(const fs::path& path) {
    // Open in binary mode so nothing is changed behind our back; we clean line endings ourselves below.
    std::ifstream in(path, std::ios::in | std::ios::binary);
    if (!in) return Result<std::string>::fail("cannot open file for reading: " + path.string());   // Missing file or no permission.
    // Copy every character from the file into the string, start to end.
    std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    // Normalise Windows line endings so parsers see the same bytes on every platform.
    text.erase(std::remove(text.begin(), text.end(), '\r'), text.end());
    return text;   // Success: the Result now holds the text.
}

Result<std::vector<uint8_t>> readBytes(const fs::path& path) {
    // Same idea as readText, but the bytes are kept exactly as they are (used for PNG/JPG images).
    std::ifstream in(path, std::ios::in | std::ios::binary);
    if (!in) return Result<std::vector<uint8_t>>::fail("cannot open file for reading: " + path.string());
    std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    return bytes;
}

Status writeText(const fs::path& path, std::string_view text) {
    // Make sure the folder exists first, e.g. saving to "out/debug/plan.wfb" when "out/debug" is new.
    if (path.has_parent_path()) {
        if (auto s = ensureDirectory(path.parent_path()); !s) return s;   // Pass the folder error straight back.
    }
    // trunc = replace the old file completely instead of adding to the end of it.
    std::ofstream out(path, std::ios::out | std::ios::binary | std::ios::trunc);
    if (!out) return Status::fail("cannot open file for writing: " + path.string());
    out.write(text.data(), static_cast<std::streamsize>(text.size()));
    if (!out) return Status::fail("write failed: " + path.string());   // e.g. the disk is full.
    return Status::success();
}

Status writeBytes(const fs::path& path, const std::vector<uint8_t>& bytes) {
    // Byte version of writeText (same steps: make the folder, open, write, check).
    if (path.has_parent_path()) {
        if (auto s = ensureDirectory(path.parent_path()); !s) return s;
    }
    std::ofstream out(path, std::ios::out | std::ios::binary | std::ios::trunc);
    if (!out) return Status::fail("cannot open file for writing: " + path.string());
    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));   // ofstream wants char*, our bytes are uint8_t.
    if (!out) return Status::fail("write failed: " + path.string());
    return Status::success();
}

bool exists(const fs::path& path) noexcept {
    std::error_code ec;              // The error_code overload never throws; any problem just means "not there".
    return fs::exists(path, ec);
}

Status ensureDirectory(const fs::path& dir) {
    std::error_code ec;
    if (dir.empty() || fs::exists(dir, ec)) return Status::success();   // Nothing to do: no folder given, or it's already there.
    fs::create_directories(dir, ec);   // Creates every missing folder along the way, like "mkdir -p".
    if (ec) return Status::fail("cannot create directory " + dir.string() + ": " + ec.message());
    return Status::success();
}

std::string lowerExtension(const fs::path& path) {
    std::string ext = path.extension().string();   // "plan.SVG" -> ".SVG"
    // Lower-case every letter so ".SVG", ".Svg" and ".svg" are all treated the same (wf_api checks for ".svg").
    std::transform(ext.begin(), ext.end(), ext.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return ext;
}

} // namespace wf::io
