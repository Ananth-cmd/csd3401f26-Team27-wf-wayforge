/*!
 * \file Build.cpp
 * \brief Building the navigation graph from rooms, doors and corridors
 *
 * Places nodes on a level (one per room, one per door, several along each
 * corridor) and joins two nodes with an edge when a person could walk
 * straight between them without going through a wall. Doors let the walk
 * line through; rooms are only entered and left through their doors, so
 * every route has a door step the app can announce.
 *
 * Links: wf_api::wf_build_graph -> buildGraph -> buildLevelGraph for every
 * level. The nodes/edges written here are what Route.cpp searches.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Line-of-sight test with thick walls, clearance and door openings
 *   - Room / door / corridor node placement and edge rules
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-09-21
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_graph/wf_graph.hpp"   // GraphParams, GraphStats and the functions defined here.
#include <algorithm>               // std::min / std::max.

namespace wf::graph {

bool lineOfSight(const Level& level, const Vec2& a, const Vec2& b, float clearance) {
    for (const Wall& w : level.walls) {
        // Thick wall: test against the centreline inflated by half thickness + clearance,
        // approximated by the segment distance test plus the crossing test.
        const bool crosses = segmentsIntersect(a, b, w.a, w.b);
        const float half = w.thickness * 0.5f + clearance;
        bool blocked = crosses;
        if (!blocked) {
            // The line doesn't cross the centreline, but it may still clip the wall's thickness:
            // check how close its two ends and its middle get to the wall.
            const float dA = distancePointToSegment(a, w.a, w.b), dB = distancePointToSegment(b, w.a, w.b);
            const float dMid = distancePointToSegment((a + b) * 0.5f, w.a, w.b);
            // Only counts as blocked if it also comes in at an angle (> 20 degrees);
            // a line running alongside the wall is just walking down a corridor.
            if (std::min({dA, dB, dMid}) < half && lineAngleDiff(angleOf(b - a), angleOf(w.b - w.a)) > degToRad(20.f)) blocked = true;
        }
        if (!blocked) continue;
        // Openings let the line through: does it pass through the door span?
        bool throughOpening = false;
        for (const Opening& o : level.openings) {
            if (o.wall != w.id) continue;                 // only openings in this wall matter
            const Vec2 d = w.direction();                 // unit vector along the wall
            // The opening runs from offset to offset + width, measured from wall end a.
            const Vec2 o0 = w.a + d * o.offset, o1 = w.a + d * (o.offset + o.width);
            // widen the door span by 5 cm each side so a line through the very edge of the door still counts
            if (segmentsIntersect(a, b, o0 - d * 0.05f, o1 + d * 0.05f)) { throughOpening = true; break; }
        }
        // Blocked by this wall and not through one of its doors: no line of sight.
        if (!throughOpening) return false;
    }
    return true;
}

namespace {
    // A door belongs to a room if it sits on the room's outline.
    bool doorTouchesRoom(const Level& level, const Vec2& doorPos, const std::string& roomId) {
        const Room* r = level.findRoom(roomId);
        // Unknown room or no real outline: don't block the edge on it.
        if (!r || r->polygon.size() < 3) return true;
        // Distance from the door to the nearest side of the room polygon.
        float best = 1e30f;
        for (size_t i = 0; i < r->polygon.size(); ++i)
            best = std::min(best, distancePointToSegment(doorPos, r->polygon[i], r->polygon[(i + 1) % r->polygon.size()]));
        // 35 cm allows for the door sitting in the middle of a thick wall.
        return best <= 0.35f;
    }

    // Stairs, lifts and exits get their own node kinds so routing and instructions can spot them.
    NodeKind nodeKindForRoom(RoomKind k) {
        switch (k) {
            case RoomKind::Stair: return NodeKind::Stair;
            case RoomKind::Lift:  return NodeKind::Lift;
            case RoomKind::Exit:  return NodeKind::Exit;
            default:              return NodeKind::Room;
        }
    }
}

GraphStats buildLevelGraph(Level& level, IdGenerator& ids, const GraphParams& p) {
    // Start from scratch every time; the graph is always rebuilt, never patched.
    level.nodes.clear();
    level.edges.clear();

    // 1. room nodes, one per room at its centroid (rooms already store an interior point)
    for (const Room& r : level.rooms) {
        if (r.kind == RoomKind::Corridor) continue;   // corridors get sampled nodes in step 3
        Node n; n.id = ids.next("n"); n.pos = r.centroid; n.room = r.id; n.kind = nodeKindForRoom(r.kind);
        level.nodes.push_back(n);
    }
    // 2. door nodes at every opening midpoint
    for (const Opening& o : level.openings) {
        if (o.type == OpeningType::Window) continue;  // you can't walk through a window
        const Wall* w = level.findWall(o.wall);
        if (!w) continue;                             // opening points at a wall that no longer exists
        Node n; n.id = ids.next("n"); n.pos = openingPosition(*w, o); n.kind = NodeKind::Door;
        level.nodes.push_back(n);
    }
    // 3. corridor nodes sampled along the long axis of each corridor face
    for (const Room& r : level.rooms) {
        if (r.kind != RoomKind::Corridor) continue;
        const Rect bb = polygonBounds(r.polygon);
        const Vec2 s = bb.size();
        const bool horizontal = s.x >= s.y;           // the longer side is the walking direction
        const float len = horizontal ? s.x : s.y;
        // One node every corridorSpacing metres, at least one per corridor.
        const int count = std::max(1, static_cast<int>(len / p.corridorSpacing));
        for (int i = 0; i < count; ++i) {
            // (i + 0.5) / count puts nodes in the middle of each equal slice, not on the ends.
            const float t = (i + 0.5f) / count;
            Vec2 pos = horizontal ? Vec2{bb.min.x + s.x * t, bb.centre().y} : Vec2{bb.centre().x, bb.min.y + s.y * t};
            // L-shaped corridors: the bounding-box centre line can fall outside; use the centroid instead.
            if (!pointInPolygon(pos, r.polygon)) pos = r.centroid;
            Node n; n.id = ids.next("n"); n.pos = pos; n.room = r.id; n.kind = NodeKind::Corridor;
            level.nodes.push_back(n);
        }
    }
    // 4. edges: connect nodes with line of sight (walls block, doors let through)
    const size_t N = level.nodes.size();
    std::vector<int> degree(N, 0);                    // edges per node, to count isolated nodes
    // Try every pair once (j > i).
    for (size_t i = 0; i < N; ++i) {
        for (size_t j = i + 1; j < N; ++j) {
            const Node& a = level.nodes[i]; const Node& b = level.nodes[j];
            const float d = distance(a.pos, b.pos);
            // Too far apart, or the same spot (zero-length edge): skip.
            if (d > p.maxEdgeLength || d < 1e-4f) continue;
            // A room-interior node (room, stair, lift, exit) only ever connects to door nodes:
            // every route in and out of a room goes through a door, which is what the app
            // needs for turn prompts. Doors and corridor samples connect to anything visible.
            const bool aInRoom = a.kind != NodeKind::Door && a.kind != NodeKind::Corridor;
            const bool bInRoom = b.kind != NodeKind::Door && b.kind != NodeKind::Corridor;
            // ...and only to a door that is actually on that room's outline.
            if (aInRoom && (b.kind != NodeKind::Door || !doorTouchesRoom(level, b.pos, a.room))) continue;
            if (bInRoom && (a.kind != NodeKind::Door || !doorTouchesRoom(level, a.pos, b.room))) continue;
            if (!lineOfSight(level, a.pos, b.pos, p.wallClearance)) continue;
            // Edge cost is the walking distance; every edge on one level is step-free (stairs are links).
            Edge e; e.a = a.id; e.b = b.id; e.cost = d; e.stepFree = true;
            if (a.kind == NodeKind::Door || b.kind == NodeKind::Door) {
                // record which opening the edge passes through
                const Node& door = a.kind == NodeKind::Door ? a : b;
                // Door nodes don't store their opening id, so find the opening at the same position.
                for (const Opening& o : level.openings) {
                    const Wall* w = level.findWall(o.wall);
                    if (w && distance(openingPosition(*w, o), door.pos) < 1e-3f) { e.via = o.id; break; }
                }
            }
            level.edges.push_back(e);
            ++degree[i]; ++degree[j];
        }
    }
    // Report what was built so callers (and the test) can spot unreachable nodes.
    GraphStats st;
    st.nodes = static_cast<int>(N); st.edges = static_cast<int>(level.edges.size());
    for (int d : degree) if (d == 0) ++st.isolatedNodes;
    return st;
}

GraphStats buildGraph(Building& b, IdGenerator& ids, const GraphParams& p) {
    // Each level is built on its own; links between levels are left untouched.
    GraphStats total;
    for (Level& l : b.levels) {
        GraphStats s = buildLevelGraph(l, ids, p);
        total.nodes += s.nodes; total.edges += s.edges; total.isolatedNodes += s.isolatedNodes;
    }
    return total;
}

} // namespace wf::graph
