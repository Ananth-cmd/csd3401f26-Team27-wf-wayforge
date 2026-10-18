/*!
 * \file Link.cpp
 * \brief Building-level navigation: exit doors and inter-floor links
 *
 * markExitDoors() turns the node of every door with a room on one side only
 * into an Exit node. linkFloors() links each stair / lift room to the room of
 * the same kind within maxOffset on the next floor up; lift links are
 * step-free. prepareNavigation() runs buildGraph() and both of the above.
 *
 * Links: called by wf_cli (build / graph / route) and wf_api::wf_build_graph.
 * Route.cpp follows the links when a route changes floor.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Automatic exit detection from door position
 *   - Automatic stair / lift links between floors, step-free flag per link
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_graph/wf_graph.hpp"
#include <algorithm>
#include <unordered_set>

namespace wf::graph {
namespace {

    bool insideAnyRoom(const Level& level, const Vec2& p) {
        for (const Room& r : level.rooms)
            if (r.polygon.size() >= 3 && pointInPolygon(p, r.polygon)) return true;
        return false;
    }

    // Room node of a room (the non-corridor node whose room id matches).
    const Node* roomNode(const Level& level, const Room& room) {
        for (const Node& n : level.nodes)
            if (n.room == room.id && n.kind != NodeKind::Corridor) return &n;
        return nullptr;
    }

} // namespace

int markExitDoors(Level& level) {
    int exits = 0;
    for (const Opening& o : level.openings) {
        if (o.type == OpeningType::Window) continue;
        const Wall* w = level.findWall(o.wall);
        if (!w) continue;
        const Vec2 mid = openingPosition(*w, o);
        // Probe both sides of the wall just past its thickness.
        const Vec2 n = perp(w->direction()) * (w->thickness * 0.5f + 0.3f);
        const bool sideA = insideAnyRoom(level, mid + n), sideB = insideAnyRoom(level, mid - n);
        if (sideA == sideB) continue;
        for (Node& node : level.nodes)
            if (node.kind == NodeKind::Door && distance(node.pos, mid) < 1e-3f) { node.kind = NodeKind::Exit; ++exits; }
    }
    return exits;
}

int linkFloors(Building& b, float maxOffset) {
    // Drop links whose end nodes no longer exist.
    std::unordered_set<std::string> refs;
    for (const Level& l : b.levels) for (const Node& n : l.nodes) refs.insert(l.id + ":" + n.id);
    b.links.erase(std::remove_if(b.links.begin(), b.links.end(),
        [&](const Link& k) { return !refs.count(k.a) || !refs.count(k.b); }), b.links.end());

    // Link consecutive floors in elevation order.
    std::vector<const Level*> order;
    for (const Level& l : b.levels) order.push_back(&l);
    std::stable_sort(order.begin(), order.end(), [](const Level* x, const Level* y) { return x->elevation < y->elevation; });

    int added = 0;
    for (size_t i = 0; i + 1 < order.size(); ++i) {
        const Level& lo = *order[i]; const Level& hi = *order[i + 1];
        for (const Room& r : lo.rooms) {
            if (r.kind != RoomKind::Stair && r.kind != RoomKind::Lift) continue;
            const Node* a = roomNode(lo, r);
            if (!a) continue;
            // Closest room of the same kind on the floor above.
            const Room* best = nullptr; float bestD = maxOffset;
            for (const Room& u : hi.rooms) {
                if (u.kind != r.kind) continue;
                const float d = distance(u.centroid, r.centroid);
                if (d <= bestD) { bestD = d; best = &u; }
            }
            if (!best) continue;
            const Node* c = roomNode(hi, *best);
            if (!c) continue;
            Link k;
            k.a = lo.id + ":" + a->id;
            k.b = hi.id + ":" + c->id;
            // Skip if an equivalent link exists (rebuilt graph with the same ids, or added manually).
            const bool exists = std::any_of(b.links.begin(), b.links.end(), [&](const Link& o) {
                return (o.a == k.a && o.b == k.b) || (o.a == k.b && o.b == k.a); });
            if (exists) continue;
            k.kind = r.kind == RoomKind::Lift ? LinkKind::Lift : LinkKind::Stair;
            k.stepFree = r.kind == RoomKind::Lift;
            k.cost = std::max(1.f, hi.elevation - lo.elevation) * (r.kind == RoomKind::Lift ? 2.f : 4.f);
            b.links.push_back(k);
            ++added;
        }
    }
    return added;
}

NavStats prepareNavigation(Building& b, const GraphParams& p) {
    NavStats s;
    IdGenerator ids;
    ids.bump(100000);                                              // keep node ids clear of wall / room ids
    s.graph = buildGraph(b, ids, p);
    for (Level& l : b.levels) s.exits += markExitDoors(l);
    linkFloors(b);
    s.links = static_cast<int>(b.links.size());
    return s;
}

} // namespace wf::graph
