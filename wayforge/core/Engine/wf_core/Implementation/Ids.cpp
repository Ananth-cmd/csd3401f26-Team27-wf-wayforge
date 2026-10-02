/*!
 * \file Ids.cpp
 * \brief Implementation of the id helpers
 *
 * Reads the number part of an id ("w42" -> 42). Used when a building is
 * loaded from a .wfb file, so the IdGenerator can be bumped past the
 * highest existing number and new elements never reuse an old id.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Safe id parsing with std::from_chars (no exceptions, no locale)
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-27
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_core/Ids.hpp"   // Declaration of idNumber().
#include <cctype>            // std::isdigit to find where the number starts.
#include <charconv>          // std::from_chars: fast text -> int that never throws.

namespace wf {

int idNumber(std::string_view id) noexcept {
    size_t i = 0;
    // Skip the letters at the front ("w", "r", "n" ...) until the first digit.
    while (i < id.size() && !std::isdigit(static_cast<unsigned char>(id[i]))) ++i;
    if (i >= id.size()) return -1;   // No digits at all, e.g. "wall".
    int value = 0;
    // Turn the digits into a number. ec tells us if it failed (e.g. the number is too big).
    auto [ptr, ec] = std::from_chars(id.data() + i, id.data() + id.size(), value);
    return ec == std::errc{} ? value : -1;
}

} // namespace wf
