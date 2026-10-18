/*!
 * \file Instructions.cpp
 * \brief Turn-by-turn directions for a route, and room search
 *
 * Walks the steps of a Route and turns them into short sentences the app
 * can show or read out: leave the start room, turn / bear / continue at each
 * bend (straight legs are merged into one distance), take the stairs or lift
 * at a level change, and arrive. Also searches rooms by code or name.
 *
 * Links: wf_api::wf_instructions describes the last route found by
 * findRoute / findEgress (Route.cpp); wf_api::wf_search_rooms calls searchRooms.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Turn detection from the angle between legs (straight / bear / turn / around)
 *   - Merging straight legs and level-change (stairs / lift) instructions
 *   - Case-insensitive room search by code or name
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-09-30
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_graph/wf_graph.hpp"   // Route, Instruction and the functions defined here.
#include <sstream>                 // Building the "12 m" text.
#include <iomanip>                 // Stream formatting.
#include <algorithm>               // String helpers.
#include <cctype>                  // std::tolower for case-insensitive search.

namespace wf::graph {

namespace {
    // Round to whole metres for display: 11.6 -> "12 m".
    std::string metres(float m) { std::ostringstream s; s << static_cast<int>(std::round(m)); return s.str() + " m"; }
    // Lower-case copy of a string (the unsigned char cast keeps tolower safe for non-ASCII bytes).
    std::string lower(std::string_view v) { std::string s(v); for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c))); return s; }

    // The room a route step's node belongs to, or nullptr (door nodes and missing data).
    const Room* roomOfNode(const Building& b, const RouteStep& s) {
        const Level* l = b.findLevel(s.level); if (!l) return nullptr;
        const Node* n = l->findNode(s.node);   if (!n || n->room.empty()) return nullptr;
        return l->findRoom(n->room);
    }
    // Best name to show for a room: "E2-05-12 (Lab)", else code, else name, else its id.
    std::string roomLabel(const Room* r) {
        if (!r) return "the corridor";
        if (!r->code.empty() && !r->name.empty()) return r->code + " (" + r->name + ")";
        if (!r->code.empty()) return r->code;
        if (!r->name.empty()) return r->name;
        return r->id;
    }
    // Turn word from the change in heading between two legs (world y up, so left = positive cross).
    std::string turnWord(const Vec2& in, const Vec2& out) {
        // atan2(cross, dot) = signed angle from the old heading to the new one, in degrees.
        const float c = cross(in, out), d = dot(in, out);
        const float ang = std::atan2(c, d) * 180.f / 3.14159265f;
        if (std::abs(ang) < 25.f) return "Continue straight";      // small wiggles count as straight
        if (std::abs(ang) > 150.f) return "Turn around";
        if (ang > 0) return ang > 70.f ? "Turn left" : "Bear left";   // 25-70 degrees = bear, over 70 = turn
        return ang < -70.f ? "Turn right" : "Bear right";
    }
}

std::vector<Instruction> instructions(const Building& b, const Route& r) {
    std::vector<Instruction> out;
    if (r.steps.size() < 2) return out;               // already there: nothing to say
    const auto& st = r.steps;

    // 1. leave the start room
    {
        Instruction i; i.pos = st[0].pos; i.level = st[0].level;
        const Room* room = roomOfNode(b, st[0]);
        i.text = room ? "Leave " + roomLabel(room) + " through the door" : "Start in the corridor";
        i.distanceToNext = distance(st[0].pos, st[1].pos);
        out.push_back(i);
    }

    // 2. walk legs; merge consecutive "straight" legs into one distance
    Vec2 heading = st[1].pos - st[0].pos;             // direction of the leg we just walked
    float run = 0.f;
    // Each k looks at the leg from st[k] to st[k + 1].
    for (size_t k = 1; k + 1 < st.size(); ++k) {
        const RouteStep& cur = st[k]; const RouteStep& next = st[k + 1];
        // level change (link)
        if (cur.level != next.level) {
            Instruction i; i.pos = cur.pos; i.level = cur.level;
            // Consecutive level changes are merged into one instruction ("up to Level 3").
            size_t last = k;
            while (last + 2 < st.size() && st[last + 1].level != st[last + 2].level) ++last;
            const Level* to = b.findLevel(st[last + 1].level); const Level* from = b.findLevel(cur.level);
            // Up or down is decided by comparing the two levels' elevations.
            const bool up = to && from && to->elevation > from->elevation;
            const std::string via = cur.kind == NodeKind::Lift ? "Take the lift " : "Take the stairs ";
            i.text = via + (up ? "up" : "down") + " to " + (to ? to->name : st[last + 1].level);
            out.push_back(i);
            k = last;                                     // skip the intermediate levels
            // The direction on the new level is the next leg there, so the first walk on it isn't judged
            // against the stair/lift jump.
            heading = (k + 2 < st.size()) ? st[k + 2].pos - st[k + 1].pos : heading;
            run = 0.f;
            continue;
        }
        const Vec2 leg = next.pos - cur.pos;
        if (dot(leg, leg) < 1e-6f) continue;          // two steps at the same spot: no movement
        const std::string word = turnWord(heading, leg);
        run += distance(cur.pos, next.pos);
        // Straight on after a "Continue straight" / start on the same level: just add the distance to it
        // instead of repeating "Continue straight". Turns, bears and "Leave" always start a new instruction.
        if (word == "Continue straight" && !out.empty() && out.back().level == cur.level && out.back().text.rfind("Turn", 0) != 0 && out.back().text.rfind("Bear", 0) != 0 && out.back().text.rfind("Leave", 0) != 0) {
            out.back().distanceToNext += distance(cur.pos, next.pos);
        } else {
            Instruction i; i.pos = cur.pos; i.level = cur.level;
            const std::string where = cur.kind == NodeKind::Door ? " at the door" : "";
            i.text = word + where + " and walk " + metres(distance(cur.pos, next.pos));
            i.distanceToNext = distance(cur.pos, next.pos);
            out.push_back(i);
        }
        heading = leg;
    }
    // fix up "walk N m" text for merged straights
    // (merging only grew distanceToNext, so rewrite the number at the end of the text)
    for (auto& i : out)
        if (i.text.find(" and walk ") != std::string::npos)
            i.text = i.text.substr(0, i.text.find(" and walk ")) + " and walk " + metres(i.distanceToNext);

    // 3. arrive
    {
        Instruction i; i.pos = st.back().pos; i.level = st.back().level;
        const Room* room = roomOfNode(b, st.back());
        // Exits get their own wording so egress directions end clearly.
        i.text = st.back().kind == NodeKind::Exit ? "Arrive at the exit" + (room ? " " + roomLabel(room) : std::string())
                                                  : "Arrive at " + roomLabel(room);
        out.push_back(i);
    }
    return out;
}

std::vector<std::string> searchRooms(const Building& b, std::string_view query, size_t maxResults) {
    std::vector<std::string> out;
    const std::string q = lower(query);
    for (const Level& l : b.levels)
        for (const Room& r : l.rooms) {
            if (r.kind == RoomKind::Corridor) continue;   // corridors aren't destinations
            // Empty query lists every room; otherwise match anywhere in the code or the name.
            if (q.empty() || lower(r.code).find(q) != std::string::npos || lower(r.name).find(q) != std::string::npos) {
                out.push_back(l.id + ":" + r.id);
                if (out.size() >= maxResults) return out;
            }
        }
    return out;
}

} // namespace wf::graph
