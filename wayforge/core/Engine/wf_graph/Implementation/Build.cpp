#include "wf_graph/wf_graph.hpp"
#include <algorithm>

namespace wf::graph {

bool lineOfSight(const Level& level, const Vec2& a, const Vec2& b, float clearance) {
    for (const Wall& w : level.walls) {
        // Thick wall: test against the centreline inflated by half thickness + clearance,
        // approximated by the segment distance test plus the crossing test.
        const bool crosses = segmentsIntersect(a, b, w.a, w.b);
        const float half = w.thickness * 0.5f + clearance;
        bool blocked = crosses;
        if (!blocked) {
            // near-parallel passes that graze the wall
            const float dA = distancePointToSegment(a, w.a, w.b), dB = distancePointToSegment(b, w.a, w.b);
            const float dMid = distancePointToSegment((a + b) * 0.5f, w.a, w.b);
            if (std::min({dA, dB, dMid}) < half && lineAngleDiff(angleOf(b - a), angleOf(w.b - w.a)) > degToRad(20.f)) blocked = true;
        }
        if (!blocked) continue;
        // Openings let the line through: does it pass through the door span?
        bool throughOpening = false;
        for (const Opening& o : level.openings) {
            if (o.wall != w.id) continue;
            const Vec2 d = w.direction();
            const Vec2 o0 = w.a + d * o.offset, o1 = w.a + d * (o.offset + o.width);
            // widen the door span by half thickness so the crossing point is found on the centreline
            if (segmentsIntersect(a, b, o0 - d * 0.05f, o1 + d * 0.05f)) { throughOpening = true; break; }
        }
        if (!throughOpening) return false;
    }
    return true;
}

namespace {
    // A door belongs to a room if it sits on the room's outline.
    bool doorTouchesRoom(const Level& level, const Vec2& doorPos, const std::string& roomId) {
        const Room* r = level.findRoom(roomId);
        if (!r || r->polygon.size() < 3) return true;
        float best = 1e30f;
        for (size_t i = 0; i < r->polygon.size(); ++i)
            best = std::min(best, distancePointToSegment(doorPos, r->polygon[i], r->polygon[(i + 1) % r->polygon.size()]));
        return best <= 0.35f;
    }

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
    level.nodes.clear();
    level.edges.clear();

    // 1. room nodes, one per room at its centroid (rooms already store an interior point)
    for (const Room& r : level.rooms) {
        if (r.kind == RoomKind::Corridor) continue;
        Node n; n.id = ids.next("n"); n.pos = r.centroid; n.room = r.id; n.kind = nodeKindForRoom(r.kind);
        level.nodes.push_back(n);
    }
    // 2. door nodes at every opening midpoint
    for (const Opening& o : level.openings) {
        if (o.type == OpeningType::Window) continue;
        const Wall* w = level.findWall(o.wall);
        if (!w) continue;
        Node n; n.id = ids.next("n"); n.pos = openingPosition(*w, o); n.kind = NodeKind::Door;
        level.nodes.push_back(n);
    }
    // 3. corridor nodes sampled along the long axis of each corridor face
    for (const Room& r : level.rooms) {
        if (r.kind != RoomKind::Corridor) continue;
        const Rect bb = polygonBounds(r.polygon);
        const Vec2 s = bb.size();
        const bool horizontal = s.x >= s.y;
        const float len = horizontal ? s.x : s.y;
        const int count = std::max(1, static_cast<int>(len / p.corridorSpacing));
        for (int i = 0; i < count; ++i) {
            const float t = (i + 0.5f) / count;
            Vec2 pos = horizontal ? Vec2{bb.min.x + s.x * t, bb.centre().y} : Vec2{bb.centre().x, bb.min.y + s.y * t};
            if (!pointInPolygon(pos, r.polygon)) pos = r.centroid;
            Node n; n.id = ids.next("n"); n.pos = pos; n.room = r.id; n.kind = NodeKind::Corridor;
            level.nodes.push_back(n);
        }
    }
    // 4. edges: connect nodes with line of sight (walls block, doors let through)
    const size_t N = level.nodes.size();
    std::vector<int> degree(N, 0);
    for (size_t i = 0; i < N; ++i) {
        for (size_t j = i + 1; j < N; ++j) {
            const Node& a = level.nodes[i]; const Node& b = level.nodes[j];
            const float d = distance(a.pos, b.pos);
            if (d > p.maxEdgeLength || d < 1e-4f) continue;
            // A room-interior node (room, stair, lift, exit) only ever connects to door nodes:
            // every route in and out of a room goes through a door, which is what the app
            // needs for turn prompts. Doors and corridor samples connect to anything visible.
            const bool aInRoom = a.kind != NodeKind::Door && a.kind != NodeKind::Corridor;
            const bool bInRoom = b.kind != NodeKind::Door && b.kind != NodeKind::Corridor;
            if (aInRoom && (b.kind != NodeKind::Door || !doorTouchesRoom(level, b.pos, a.room))) continue;
            if (bInRoom && (a.kind != NodeKind::Door || !doorTouchesRoom(level, a.pos, b.room))) continue;
            if (!lineOfSight(level, a.pos, b.pos, p.wallClearance)) continue;
            Edge e; e.a = a.id; e.b = b.id; e.cost = d; e.stepFree = true;
            if (a.kind == NodeKind::Door || b.kind == NodeKind::Door) {
                // record which opening the edge passes through
                const Node& door = a.kind == NodeKind::Door ? a : b;
                for (const Opening& o : level.openings) {
                    const Wall* w = level.findWall(o.wall);
                    if (w && distance(openingPosition(*w, o), door.pos) < 1e-3f) { e.via = o.id; break; }
                }
            }
            level.edges.push_back(e);
            ++degree[i]; ++degree[j];
        }
    }
    GraphStats st;
    st.nodes = static_cast<int>(N); st.edges = static_cast<int>(level.edges.size());
    for (int d : degree) if (d == 0) ++st.isolatedNodes;
    return st;
}

GraphStats buildGraph(Building& b, IdGenerator& ids, const GraphParams& p) {
    GraphStats total;
    for (Level& l : b.levels) {
        GraphStats s = buildLevelGraph(l, ids, p);
        total.nodes += s.nodes; total.edges += s.edges; total.isolatedNodes += s.isolatedNodes;
    }
    return total;
}

} // namespace wf::graph
