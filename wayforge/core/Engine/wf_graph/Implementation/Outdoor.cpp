/*!
 * \file Outdoor.cpp
 * \brief Walking outside between blocks on the ground floor, and a last-resort way into cut-off blocks
 *
 * linkOutdoors() lets a route leave one block by an exit door, walk around the
 * other buildings and go in by another block's exit door. Each exit door gets
 * a step point straight out of the doorway, and each block (a connected group
 * of the ground floor's graph) a waypoint just outside every corner of its
 * outline (the convex hull of its rooms). Every two of these that can see each
 * other are joined by a straight outdoor edge: no wall in the way, not through
 * a room, not over water (the site's "water" areas, if the file has a site).
 *
 * joinCutOffBlocks() runs after the floors are linked. A block on the ground
 * floor that still can't be reached from the rest of the building (no exit
 * door drawn yet, no bridge) gets one edge to the nearest door or corridor of
 * the main part, through the fewest walls, so every block stays routable.
 *
 * Links: prepareNavigation() in Link.cpp calls both. The edges and waypoint
 * nodes added here are searched by Route.cpp like any other.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Outdoor waypoints around each block and the outdoor visibility edges
 *   - One link into blocks that are otherwise cut off
 *
 * AI declaration: Claude Opus was used as a support tool for writing and debugging this code and the comments.
 *
 * \date 2026-11-20
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_graph/wf_graph.hpp"   // GraphParams, lineOfSight, wallsCrossed and the functions defined here.
#include <nlohmann/json.hpp>       // Reading the water areas out of Building::site.
#include <algorithm>               // std::sort, std::unique, std::max.
#include <cmath>                   // std::floor.
#include <unordered_map>           // Room grid cells, node lookups.
#include <unordered_set>           // Rooms already counted for a block.

namespace wf::graph {
namespace {

using Polygon = std::vector<Vec2>;

// Union-find over indices: which nodes are joined up.
struct Groups {
    std::vector<size_t> parent;
    explicit Groups(size_t n) : parent(n) { for (size_t i = 0; i < n; ++i) parent[i] = i; }
    size_t root(size_t i) { while (parent[i] != i) i = parent[i] = parent[parent[i]]; return i; }
    void join(size_t a, size_t b) { parent[root(a)] = root(b); }   // b's group keeps its root
};

// Convex hull of a set of points, counter-clockwise (Andrew's monotone chain).
Polygon convexHull(Polygon pts) {
    std::sort(pts.begin(), pts.end(), [](const Vec2& a, const Vec2& b) { return a.x < b.x || (a.x == b.x && a.y < b.y); });
    pts.erase(std::unique(pts.begin(), pts.end()), pts.end());
    if (pts.size() < 3) return pts;
    Polygon h(2 * pts.size());
    size_t k = 0;
    for (size_t i = 0; i < pts.size(); ++i) {                       // lower half
        while (k >= 2 && cross(h[k - 1] - h[k - 2], pts[i] - h[k - 2]) <= 0.f) --k;
        h[k++] = pts[i];
    }
    for (size_t i = pts.size() - 1, t = k + 1; i-- > 0; ) {         // upper half
        while (k >= t && cross(h[k - 1] - h[k - 2], pts[i] - h[k - 2]) <= 0.f) --k;
        h[k++] = pts[i];
    }
    h.resize(k - 1);                                                // last point repeats the first
    return h;
}

// The rooms of a level in 10 m grid cells, for quick "is this point inside a room" tests.
class RoomGrid {
public:
    explicit RoomGrid(const Level& level) : m_level(level) {
        for (size_t i = 0; i < level.rooms.size(); ++i) {
            const Room& r = level.rooms[i];
            if (r.polygon.size() < 3) continue;
            const Rect bb = polygonBounds(r.polygon);
            for (int x = cellOf(bb.min.x); x <= cellOf(bb.max.x); ++x)
                for (int y = cellOf(bb.min.y); y <= cellOf(bb.max.y); ++y) m_cells[key(x, y)].push_back(i);
        }
    }
    bool inside(const Vec2& q) const {
        const auto it = m_cells.find(key(cellOf(q.x), cellOf(q.y)));
        if (it == m_cells.end()) return false;
        for (size_t i : it->second) if (pointInPolygon(q, m_level.rooms[i].polygon)) return true;
        return false;
    }
private:
    static int cellOf(float v) { return static_cast<int>(std::floor(v / 10.f)); }
    static long long key(int x, int y) { return (static_cast<long long>(x) << 32) ^ static_cast<unsigned int>(y); }
    const Level& m_level;
    std::unordered_map<long long, std::vector<size_t>> m_cells;
};

// True when the line a-b runs through a room: a point on it every 2 m, more than 1 m from both
// ends (an end may be a door in a room's wall), is inside a room.
bool throughRoom(const RoomGrid& rooms, const Vec2& a, const Vec2& b) {
    const float len = distance(a, b);
    for (float s = 1.f; s < len - 1.f; s += 2.f)
        if (rooms.inside(a + (b - a) * (s / len))) return true;
    return false;
}

// The site's water areas ("areas" with kind "water"), if the file has a site.
std::vector<Polygon> waterAreas(const Building& b) {
    std::vector<Polygon> out;
    if (b.site.empty()) return out;
    const nlohmann::json site = nlohmann::json::parse(b.site, nullptr, false);
    if (site.is_discarded() || !site.is_object()) return out;
    const auto areas = site.find("areas");
    if (areas == site.end() || !areas->is_array()) return out;
    for (const auto& a : *areas) {
        if (!a.is_object() || a.value("kind", std::string()) != "water") continue;
        const auto poly = a.find("polygon");
        if (poly == a.end() || !poly->is_array()) continue;
        Polygon w;
        for (const auto& p : *poly)
            if (p.is_array() && p.size() == 2 && p[0].is_number() && p[1].is_number()) w.push_back({ p[0].get<float>(), p[1].get<float>() });
        if (w.size() >= 3) out.push_back(std::move(w));
    }
    return out;
}

// True when the line a-b starts, ends or crosses into water.
bool overWater(const std::vector<Polygon>& water, const Vec2& a, const Vec2& b) {
    for (const Polygon& w : water) {
        if (pointInPolygon(a, w) || pointInPolygon(b, w)) return true;
        for (size_t i = 0; i < w.size(); ++i) if (segmentsIntersect(a, b, w[i], w[(i + 1) % w.size()])) return true;
    }
    return false;
}

} // namespace

int linkOutdoors(Building& b, Level& ground, IdGenerator& ids, const GraphParams& p) {
    const size_t N = ground.nodes.size();
    if (N == 0) return 0;

    // 1. Blocks: the groups of the ground floor's graph. A group counts as a block when it has an
    //    exit door or an indoor corridor (not just a room that lost its door).
    std::unordered_map<std::string, size_t> index;
    for (size_t i = 0; i < N; ++i) index[ground.nodes[i].id] = i;
    Groups groups(N);
    for (const Edge& e : ground.edges) {
        const auto a = index.find(e.a), c = index.find(e.b);
        if (a != index.end() && c != index.end()) groups.join(a->second, c->second);
    }
    std::vector<char> isBlock(N, 0);
    for (size_t i = 0; i < N; ++i) {
        const Node& n = ground.nodes[i];
        if (n.kind == NodeKind::Exit || (n.kind == NodeKind::Corridor && !n.room.empty())) isBlock[groups.root(i)] = 1;
    }
    // Rooms of each block, blocks in node order (so the waypoint ids come out the same every run).
    std::vector<size_t> order;
    std::unordered_map<size_t, std::vector<std::string>> roomsOf;
    std::unordered_set<std::string> seen;
    for (size_t i = 0; i < N; ++i) {
        const size_t g = groups.root(i);
        const Node& n = ground.nodes[i];
        if (!isBlock[g] || n.room.empty() || !seen.insert(n.room).second) continue;
        if (!roomsOf.count(g)) order.push_back(g);
        roomsOf[g].push_back(n.room);
    }

    // 2. A waypoint outdoorClearance outside each corner of each block's outline. Skipped when it
    //    lands in a room (another block is that close) or in water, or within 1 m of another one.
    const RoomGrid rooms(ground);
    const std::vector<Polygon> water = waterAreas(b);
    std::vector<Vec2> waypoints;
    for (const size_t g : order) {
        Polygon pts;
        for (const auto& id : roomsOf[g])
            if (const Room* r = ground.findRoom(id)) pts.insert(pts.end(), r->polygon.begin(), r->polygon.end());
        const Polygon hull = convexHull(std::move(pts));
        if (hull.size() < 3) continue;
        for (size_t k = 0; k < hull.size(); ++k) {
            const Vec2& prev = hull[(k + hull.size() - 1) % hull.size()];
            const Vec2& cur = hull[k];
            const Vec2& next = hull[(k + 1) % hull.size()];
            // Outward normals of the two sides meeting at this corner (counter-clockwise: outward is
            // to the right). Moving along their sum, scaled by 1 / (1 + cos), puts the point
            // outdoorClearance away from both sides.
            const Vec2 d1 = normalize(cur - prev), d2 = normalize(next - cur);
            const Vec2 n1{ d1.y, -d1.x }, n2{ d2.y, -d2.x };
            const Vec2 pos = cur + (n1 + n2) * (p.outdoorClearance / std::max(1.f + dot(n1, n2), 0.2f));
            if (rooms.inside(pos) || overWater(water, pos, pos)) continue;
            bool near = false;
            for (const Vec2& w : waypoints) if (distance(w, pos) < 1.f) { near = true; break; }
            if (!near) waypoints.push_back(pos);
        }
    }

    // 3. Outdoor nodes (plain corridor nodes with no room). Each exit door gets a step point
    //    exitStep metres straight out of its doorway, on the side with no room, joined to the door;
    //    the outdoor edges start from there. A line leaving the door itself at an angle brushes past
    //    the door's jambs, which the line-of-sight test counts as a wall. Then the corner waypoints.
    std::vector<size_t> outdoor;
    int added = 0;
    for (size_t i = 0; i < N; ++i) {
        if (ground.nodes[i].kind != NodeKind::Exit) continue;
        const Vec2 door = ground.nodes[i].pos;
        const std::string doorId = ground.nodes[i].id;
        bool found = false;
        Vec2 step;
        std::string via;
        for (const Opening& o : ground.openings) {
            if (o.type == OpeningType::Window) continue;
            const Wall* w = ground.findWall(o.wall);
            if (!w || distance(openingPosition(*w, o), door) > 1e-3f) continue;
            const Vec2 n = perp(w->direction());
            const float out = w->thickness * 0.5f + p.exitStep;
            if (!rooms.inside(door + n * out)) { step = door + n * out; found = true; }
            else if (!rooms.inside(door - n * out)) { step = door - n * out; found = true; }
            via = o.id;
            break;
        }
        if (!found || overWater(water, step, step) || !lineOfSight(ground, door, step, p.wallClearance)) continue;
        Node s; s.id = ids.next("n"); s.pos = step; s.kind = NodeKind::Corridor;
        Edge e; e.a = doorId; e.b = s.id; e.cost = distance(door, step); e.stepFree = true; e.via = via;
        ground.nodes.push_back(s);
        ground.edges.push_back(e);
        outdoor.push_back(ground.nodes.size() - 1);
        ++added;
    }
    for (const Vec2& w : waypoints) {
        Node n; n.id = ids.next("n"); n.pos = w; n.kind = NodeKind::Corridor;
        ground.nodes.push_back(n);
        outdoor.push_back(ground.nodes.size() - 1);
    }

    // 4. Join every two outdoor nodes that can see each other outside.
    for (size_t x = 0; x < outdoor.size(); ++x) {
        for (size_t y = x + 1; y < outdoor.size(); ++y) {
            const Node& a = ground.nodes[outdoor[x]];
            const Node& c = ground.nodes[outdoor[y]];
            const float d = distance(a.pos, c.pos);
            if (d < 1e-3f) continue;
            if (overWater(water, a.pos, c.pos)) continue;
            if (!lineOfSight(ground, a.pos, c.pos, p.wallClearance)) continue;
            if (throughRoom(rooms, a.pos, c.pos)) continue;
            Edge e; e.a = a.id; e.b = c.id; e.cost = d * p.outdoorCostFactor; e.stepFree = true;
            ground.edges.push_back(e);
            ++added;
        }
    }
    return added;
}

int joinCutOffBlocks(Building& b, Level& ground, const GraphParams& p) {
    // Every node of the building as "LEVEL:NODE", joined by edges on each level and by the links.
    std::unordered_map<std::string, size_t> index;
    std::vector<char> inRoom;                                        // node belongs to a room (not a door or outdoor point)
    size_t total = 0;
    for (const Level& l : b.levels)
        for (const Node& n : l.nodes) { index[l.id + ":" + n.id] = total++; inRoom.push_back(n.room.empty() ? 0 : 1); }
    Groups groups(total);
    auto joinRefs = [&](const std::string& x, const std::string& y) {
        const auto a = index.find(x), c = index.find(y);
        if (a != index.end() && c != index.end()) groups.join(a->second, c->second);
    };
    for (const Level& l : b.levels) for (const Edge& e : l.edges) joinRefs(l.id + ":" + e.a, l.id + ":" + e.b);
    for (const Link& k : b.links) joinRefs(k.a, k.b);

    const size_t G = ground.nodes.size();
    std::vector<size_t> at(G);                                       // ground node -> building-wide index
    for (size_t i = 0; i < G; ++i) at[i] = index.at(ground.id + ":" + ground.nodes[i].id);
    auto walkable = [](const Node& n) { return n.kind == NodeKind::Door || n.kind == NodeKind::Corridor || n.kind == NodeKind::Exit; };

    int added = 0;
    for (bool joined = true; joined; ) {
        joined = false;
        // The main part of the building: the group with the most room nodes (first one on a tie).
        // Doors and outdoor waypoints don't count, so a patch of outdoor points never wins.
        std::vector<size_t> size(total, 0);
        for (size_t i = 0; i < total; ++i) size[groups.root(i)] += inRoom[i];
        size_t mainPart = groups.root(0);
        for (size_t i = 0; i < total; ++i) if (size[groups.root(i)] > size[mainPart]) mainPart = groups.root(i);
        std::vector<size_t> groupOf(G);
        for (size_t i = 0; i < G; ++i) groupOf[i] = groups.root(at[i]);

        std::vector<char> tried(total, 0);
        for (size_t i = 0; i < G; ++i) {
            // A block (it has an indoor corridor) outside the main part.
            const Node& n = ground.nodes[i];
            if (n.kind != NodeKind::Corridor || n.room.empty()) continue;
            const size_t g = groupOf[i];
            if (g == mainPart || tried[g]) continue;
            tried[g] = 1;
            // Its doors / corridors paired with the main part's within cutOffReach, nearest first.
            struct Pair { float d; size_t a, c; };
            std::vector<Pair> pairs;
            for (size_t a = 0; a < G; ++a) {
                if (groupOf[a] != g || !walkable(ground.nodes[a])) continue;
                for (size_t c = 0; c < G; ++c) {
                    if (groupOf[c] != mainPart || !walkable(ground.nodes[c])) continue;
                    const float d = distance(ground.nodes[a].pos, ground.nodes[c].pos);
                    if (d > 1e-4f && d <= p.cutOffReach) pairs.push_back({ d, a, c });
                }
            }
            std::sort(pairs.begin(), pairs.end(), [](const Pair& x, const Pair& y) { return x.d < y.d; });
            // Score: length plus 100 per wall in the way, so a real gap beats any wall.
            float bestScore = 1e30f;
            const Pair* best = nullptr;
            for (const Pair& pr : pairs) {
                if (pr.d >= bestScore) break;                        // walls only add to the score
                const float score = pr.d + 100.f * static_cast<float>(wallsCrossed(ground, ground.nodes[pr.a].pos, ground.nodes[pr.c].pos, p.wallClearance));
                if (score < bestScore) { bestScore = score; best = &pr; }
            }
            if (!best) continue;                                     // nothing within reach: stays cut off
            Edge e; e.a = ground.nodes[best->a].id; e.b = ground.nodes[best->c].id;
            e.cost = best->d + p.missingDoorPenalty; e.stepFree = true;
            ground.edges.push_back(e);
            groups.join(at[best->a], at[best->c]);                   // the main part keeps its root
            ++added;
            joined = true;
        }
    }
    return added;
}

} // namespace wf::graph
