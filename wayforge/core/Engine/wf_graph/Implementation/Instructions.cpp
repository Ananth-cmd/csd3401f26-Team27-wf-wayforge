#include "wf_graph/wf_graph.hpp"
#include <sstream>
#include <iomanip>
#include <algorithm>
#include <cctype>

namespace wf::graph {

namespace {
    std::string metres(float m) { std::ostringstream s; s << static_cast<int>(std::round(m)); return s.str() + " m"; }
    std::string lower(std::string_view v) { std::string s(v); for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c))); return s; }

    const Room* roomOfNode(const Building& b, const RouteStep& s) {
        const Level* l = b.findLevel(s.level); if (!l) return nullptr;
        const Node* n = l->findNode(s.node);   if (!n || n->room.empty()) return nullptr;
        return l->findRoom(n->room);
    }
    std::string roomLabel(const Room* r) {
        if (!r) return "the corridor";
        if (!r->code.empty() && !r->name.empty()) return r->code + " (" + r->name + ")";
        if (!r->code.empty()) return r->code;
        if (!r->name.empty()) return r->name;
        return r->id;
    }
    // Turn word from the change in heading between two legs (world y up, so left = positive cross).
    std::string turnWord(const Vec2& in, const Vec2& out) {
        const float c = cross(in, out), d = dot(in, out);
        const float ang = std::atan2(c, d) * 180.f / 3.14159265f;
        if (std::abs(ang) < 25.f) return "Continue straight";
        if (std::abs(ang) > 150.f) return "Turn around";
        if (ang > 0) return ang > 70.f ? "Turn left" : "Bear left";
        return ang < -70.f ? "Turn right" : "Bear right";
    }
}

std::vector<Instruction> instructions(const Building& b, const Route& r) {
    std::vector<Instruction> out;
    if (r.steps.size() < 2) return out;
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
    Vec2 heading = st[1].pos - st[0].pos;
    float run = 0.f;
    for (size_t k = 1; k + 1 < st.size(); ++k) {
        const RouteStep& cur = st[k]; const RouteStep& next = st[k + 1];
        // level change (link)
        if (cur.level != next.level) {
            Instruction i; i.pos = cur.pos; i.level = cur.level;
            const Level* to = b.findLevel(next.level); const Level* from = b.findLevel(cur.level);
            const bool up = to && from && to->elevation > from->elevation;
            const std::string via = cur.kind == NodeKind::Lift ? "Take the lift " : "Take the stairs ";
            i.text = via + (up ? "up" : "down") + " to " + (to ? to->name : next.level);
            out.push_back(i);
            heading = (k + 2 < st.size()) ? st[k + 2].pos - next.pos : heading;
            run = 0.f;
            continue;
        }
        const Vec2 leg = next.pos - cur.pos;
        if (dot(leg, leg) < 1e-6f) continue;
        const std::string word = turnWord(heading, leg);
        run += distance(cur.pos, next.pos);
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
    for (auto& i : out)
        if (i.text.find(" and walk ") != std::string::npos)
            i.text = i.text.substr(0, i.text.find(" and walk ")) + " and walk " + metres(i.distanceToNext);

    // 3. arrive
    {
        Instruction i; i.pos = st.back().pos; i.level = st.back().level;
        const Room* room = roomOfNode(b, st.back());
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
            if (r.kind == RoomKind::Corridor) continue;
            if (q.empty() || lower(r.code).find(q) != std::string::npos || lower(r.name).find(q) != std::string::npos) {
                out.push_back(l.id + ":" + r.id);
                if (out.size() >= maxResults) return out;
            }
        }
    return out;
}

} // namespace wf::graph
