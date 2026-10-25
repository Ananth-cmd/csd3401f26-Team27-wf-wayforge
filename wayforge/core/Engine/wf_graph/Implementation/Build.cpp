/*!
 * \file Build.cpp
 * \brief Building the navigation graph from rooms, doors and corridors
 *
 * Places nodes on a level (one per room, one per door, several along each
 * corridor) and joins two nodes with an edge when a person could walk
 * straight between them without going through a wall. Doors let the walk
 * line through; rooms are only entered and left through their doors, so
 * every route has a door step the app can announce. A stair or lift
 * standing open in a corridor or hall joins that space directly. Rooms left
 * outside the main connected group get a fallback edge to the nearest door
 * or corridor node, with a cost penalty.
 *
 * Links: wf_api::wf_build_graph -> buildGraph -> buildLevelGraph for every
 * level. The nodes/edges written here are what Route.cpp searches.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Joel Chua 70%, Ananthan Elangovan 30%
 *   Joel Chua
 *   - Line-of-sight test with thick walls, clearance and door openings
 *   - Room / door / corridor node placement and edge rules
 *   Ananthan Elangovan
 *   - Corridor nodes along the corridor centre line
 *   - Door-to-room tolerance, edges for open stairs and lifts
 *   - Fallback edges joining disconnected rooms to the main graph
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-09-21, 2026-10-19
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_graph/wf_graph.hpp"   // GraphParams, GraphStats and the functions defined here.
#include <algorithm>               // std::min / std::max.
#include <unordered_map>           // std::unordered_map.

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
        // Extend the tested line 5 cm at both ends: a room-to-door line ends exactly on the wall,
        // and without the margin rounding decides whether it hits the opening span.
        const Vec2 along = b - a;
        const float len = length(along);
        const Vec2 ext = len > 1e-6f ? along * (0.05f / len) : Vec2{};
        for (const Opening& o : level.openings) {
            if (o.wall != w.id || o.type == OpeningType::Window) continue;   // only walkable openings in this wall
            const Vec2 d = w.direction();                 // unit vector along the wall
            // The opening runs from offset to offset + width, measured from wall end a.
            const Vec2 o0 = w.a + d * o.offset, o1 = w.a + d * (o.offset + o.width);
            // widen the door span by 5 cm each side so a line through the very edge of the door still counts
            if (segmentsIntersect(a - ext, b + ext, o0 - d * 0.05f, o1 + d * 0.05f)) { throughOpening = true; break; }
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
        // On the outline: within 1 m of it.
        return best <= 1.0f;
    }

    // Whether room-interior node r may have an edge to node o: o is a door on r's outline, or r is
    // a stair / lift and o is a corridor node or the room node of a room containing r.
    bool roomNodeMayJoin(const Level& level, const Node& r, const Node& o) {
        if (o.kind == NodeKind::Door) return doorTouchesRoom(level, o.pos, r.room);
        if (r.kind != NodeKind::Stair && r.kind != NodeKind::Lift) return false;
        if (o.kind == NodeKind::Corridor) return true;
        const Room* host = level.findRoom(o.room);
        return host && host->id != r.room && host->polygon.size() >= 3 && pointInPolygon(r.pos, host->polygon);
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
    // 3. corridor nodes along the middle of each corridor: points of a 0.5 m grid inside the
    //    polygon, taken in order of distance from its edge (centre line first), each at least
    //    corridorSpacing from those already taken and at least 0.3 m from the edge.
    for (const Room& r : level.rooms) {
        if (r.kind != RoomKind::Corridor) continue;
        const Rect bb = polygonBounds(r.polygon);
        const float step = 0.5f;
        std::vector<std::pair<float, Vec2>> cand;          // (edge distance, position)
        for (float y = bb.min.y + step * 0.5f; y < bb.max.y; y += step)
            for (float x = bb.min.x + step * 0.5f; x < bb.max.x; x += step) {
                const Vec2 pos{ x, y };
                if (!pointInPolygon(pos, r.polygon)) continue;
                float edge = 1e30f;
                for (size_t k = 0; k < r.polygon.size(); ++k)
                    edge = std::min(edge, distancePointToSegment(pos, r.polygon[k], r.polygon[(k + 1) % r.polygon.size()]));
                if (edge >= 0.3f) cand.push_back({ edge, pos });
            }
        std::stable_sort(cand.begin(), cand.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
        std::vector<Vec2> taken;
        bool any = false;
        for (const auto& [edge, pos] : cand) {
            bool near = false;
            for (const Vec2& q : taken) if (distance(q, pos) < p.corridorSpacing) { near = true; break; }
            if (near) continue;
            // Skip points inside another room (open stair or lift in the corridor).
            bool inOther = false;
            for (const Room& o : level.rooms)
                if (&o != &r && o.kind != RoomKind::Corridor && o.polygon.size() >= 3 && pointInPolygon(pos, o.polygon)) { inOther = true; break; }
            if (inOther) continue;
            taken.push_back(pos);
            Node n; n.id = ids.next("n"); n.pos = pos; n.room = r.id; n.kind = NodeKind::Corridor;
            level.nodes.push_back(n);
            any = true;
        }
        if (!any) {                                       // no grid point fits: one node at the room point
            Node n; n.id = ids.next("n"); n.pos = r.centroid; n.room = r.id; n.kind = NodeKind::Corridor;
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
            // Room-interior nodes (room, stair, lift, exit) connect to the door nodes on their room's
            // outline; stair and lift nodes also connect to corridor nodes and to the room node of a
            // room containing them. Door and corridor nodes connect to any visible node.
            const bool aInRoom = a.kind != NodeKind::Door && a.kind != NodeKind::Corridor;
            const bool bInRoom = b.kind != NodeKind::Door && b.kind != NodeKind::Corridor;
            if (aInRoom && !roomNodeMayJoin(level, a, b)) continue;
            if (bInRoom && !roomNodeMayJoin(level, b, a)) continue;
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
    // 5. Fallback edges: each room outside the largest connected group joins the nearest door or
    //    corridor node of another group within missingDoorReach of its outline, preferring one in
    //    line of sight. The edge cost includes missingDoorPenalty. Repeated until no group joins.
    std::vector<size_t> group(N);
    for (size_t i = 0; i < N; ++i) group[i] = i;
    auto root = [&](size_t i) { while (group[i] != i) i = group[i] = group[group[i]]; return i; };
    std::unordered_map<std::string, size_t> index;
    for (size_t i = 0; i < N; ++i) index[level.nodes[i].id] = i;
    for (const Edge& e : level.edges) group[root(index[e.a])] = root(index[e.b]);
    for (bool joined = true; joined; ) {
        joined = false;
        std::vector<size_t> size(N, 0);
        for (size_t i = 0; i < N; ++i) ++size[root(i)];
        size_t largest = 0;
        for (size_t i = 0; i < N; ++i) if (size[root(i)] > size[root(largest)]) largest = i;
        for (size_t i = 0; i < N; ++i) {
            const Node& r = level.nodes[i];
            if (r.kind == NodeKind::Door || r.kind == NodeKind::Corridor || root(i) == root(largest)) continue;
            const Room* room = level.findRoom(r.room);
            if (!room || room->polygon.size() < 3) continue;
            size_t best = N;
            float bestScore = 1e30f;
            for (size_t j = 0; j < N; ++j) {
                const Node& o = level.nodes[j];
                if (root(j) == root(i) || (o.kind != NodeKind::Door && o.kind != NodeKind::Corridor)) continue;
                float edge = pointInPolygon(o.pos, room->polygon) ? 0.f : 1e30f;
                for (size_t k = 0; k < room->polygon.size(); ++k)
                    edge = std::min(edge, distancePointToSegment(o.pos, room->polygon[k], room->polygon[(k + 1) % room->polygon.size()]));
                if (edge > p.missingDoorReach) continue;
                const float score = distance(r.pos, o.pos) + (lineOfSight(level, r.pos, o.pos, p.wallClearance) ? 0.f : 100.f);
                if (score < bestScore) { bestScore = score; best = j; }
            }
            if (best == N) continue;
            Edge e; e.a = r.id; e.b = level.nodes[best].id;
            e.cost = distance(r.pos, level.nodes[best].pos) + p.missingDoorPenalty; e.stepFree = true;
            level.edges.push_back(e);
            ++degree[i]; ++degree[best];
            group[root(i)] = root(best);
            joined = true;
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
