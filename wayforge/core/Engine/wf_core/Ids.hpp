/*!
 * \file Ids.hpp
 * \brief Short, readable ids for everything in a building
 *
 * Every wall, door, room and navigation node gets an id like "w12", "o3",
 * "r5" or "n100001". IdGenerator hands out the next number for a prefix,
 * and idNumber() reads the number back out of an id. Short ids keep the
 * .wfb file easy to read in a text editor and easy to link together
 * (a door stores the id of the wall it sits in, a room lists its walls).
 *
 * Used by: wf_read (naming walls, doors, rooms), wf_graph (naming nodes),
 * wf_doc (adding elements when the user edits the plan).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Prefix + counter id scheme shared by every library
 *   - bump() so new ids never clash with ids loaded from a file
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-27
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// Simple string-id helpers. Ids inside a .wfb are short strings ("w12", "r3")
// so the file stays readable in a text editor.
#pragma once
#include <string>        // Ids are std::string.
#include <string_view>   // Prefixes and ids are passed in without copying.

namespace wf {

// Makes "w1", "w2", ... / "r1", ... Thread-unsafe by design (single document per thread).
class IdGenerator {
public:
    // Next id for this prefix: next("w") -> "w1", then "w2" ... The counter is shared by all prefixes.
    std::string next(std::string_view prefix) {
        return std::string(prefix) + std::to_string(++m_counter);
    }
    // Jump the counter forward so new ids start after existing ones (e.g. graph nodes start at 100001).
    void bump(int atLeast) noexcept { if (atLeast > m_counter) m_counter = atLeast; }
    void reset() noexcept { m_counter = 0; }                 // Start again from 1.
    int  counter() const noexcept { return m_counter; }      // The last number handed out.
private:
    int m_counter = 0;   // Last number used; next() adds one before using it.
};

// "w42" -> 42, anything unparsable -> -1
int idNumber(std::string_view id) noexcept;

} // namespace wf
