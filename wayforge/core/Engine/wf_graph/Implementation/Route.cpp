/*!
 * \file Route.cpp
 * \brief A* routing across every level of a building
 *
 * Flattens all levels plus the stair/lift links between them into one graph
 * keyed by "LEVEL:NODE", then runs A* from the start node to one goal
 * (findRoute) or to the nearest of many goals (findEgress = any exit).
 * Step-free routing is a single filter: edges and links marked not
 * step-free are skipped while searching. The lift wait is added once per
 * ride: the search state records whether a node was reached in a lift.
 *
 * Links: wf_api::wf_route / wf_route_to_room / wf_egress call findRoute /
 * findEgress; nodeForRoom and nearestNode turn a room code or a tap position
 * into the start/goal node. The Route returned feeds Instructions.cpp.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Joel Chua 85%, Ananthan Elangovan 15%
 *   Joel Chua
 *   - Building-wide flattened graph with stair / lift penalties
 *   - A* with a multi-goal heuristic (egress) and step-free filtering
 *   - Room-code and nearest-position lookups
 *   Ananthan Elangovan
 *   - Lift wait charged once per ride (in-lift search state)
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-09-24, 2026-10-20
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_graph/wf_graph.hpp"   // Route, RouteOptions and the functions defined here.
#include <queue>                   // std::priority_queue: the A* open list.
#include <unordered_map>           // Node / adjacency / score lookups by ref.
#include <unordered_set>           // The set of goal nodes.
#include <algorithm>               // std::max, std::min, std::reverse.

namespace wf::graph {
namespace {

// A parsed "LEVEL:NODE" reference.
struct Ref { std::string level, node; };

// Split "L5:n3" into {"L5", "n3"}; nothing if there is no colon or either side is empty.
std::optional<Ref> parseRef(std::string_view ref) {
    const size_t colon = ref.find(':');
    if (colon == std::string_view::npos || colon == 0 || colon + 1 >= ref.size()) return std::nullopt;
    return Ref{ std::string(ref.substr(0, colon)), std::string(ref.substr(colon + 1)) };
}
// Join a level id and node id back into "L5:n3".
std::string makeRef(const std::string& level, const std::string& node) { return level + ":" + node; }

// One outgoing connection: target, cost, step-free flag and lift-link flag.
struct Adj { std::string to; float cost; bool stepFree; bool lift = false; };

// Flatten the whole building into one adjacency map keyed by "L:n".
struct FlatGraph {
    std::unordered_map<std::string, const Node*>            nodes;      // ref -> node
    std::unordered_map<std::string, const Level*>           levelOf;    // ref -> the level it is on
    std::unordered_map<std::string, std::vector<Adj>>       adj;        // ref -> outgoing connections
    std::unordered_map<std::string, float>                  elevation;  // ref -> level elevation

    explicit FlatGraph(const Building& b, const GraphParams& gp = {}) {
        for (const Level& l : b.levels) {
            for (const Node& n : l.nodes) { const std::string r = makeRef(l.id, n.id); nodes[r] = &n; levelOf[r] = &l; elevation[r] = l.elevation; }
            // Edges on a level are two-way, so add both directions.
            for (const Edge& e : l.edges) {
                const std::string ra = makeRef(l.id, e.a), rb = makeRef(l.id, e.b);
                adj[ra].push_back({rb, e.cost, e.stepFree});
                adj[rb].push_back({ra, e.cost, e.stepFree});
            }
        }
        // Links join nodes on different levels (stairs, lifts). Their refs are already "L:n".
        for (const Link& lk : b.links) {
            if (!nodes.count(lk.a) || !nodes.count(lk.b)) continue;   // skip links to nodes that no longer exist
            float cost = lk.cost;
            // Stair links cost at least stairPenalty. Lift links cost their travel time; liftPenalty
            // is added once per ride in search().
            if (lk.kind == LinkKind::Stair) cost = std::max(cost, gp.stairPenalty);
            const bool lift = lk.kind == LinkKind::Lift;
            adj[lk.a].push_back({lk.b, cost, lk.stepFree, lift});
            adj[lk.b].push_back({lk.a, cost, lk.stepFree, lift});
        }
    }
    // Straight-line 3D distance between two nodes (level elevation gives the height).
    float heuristic(const std::string& a, const std::string& b) const {
        const Node* na = nodes.at(a); const Node* nb = nodes.at(b);
        const float dz = elevation.at(a) - elevation.at(b);
        return std::sqrt(distanceSq(na->pos, nb->pos) + dz * dz);     // admissible: straight-line distance
    }
};

// A* from start to whichever goal is reached first (cheapest).
Result<Route> search(const Building& b, const std::string& start, const std::unordered_set<std::string>& goals, const RouteOptions& opt) {
    FlatGraph g(b);
    // Check the inputs first so the error says what is wrong.
    if (!g.nodes.count(start)) return Result<Route>::fail("unknown start node '" + start + "'");
    for (const auto& goal : goals) if (!g.nodes.count(goal)) return Result<Route>::fail("unknown goal node '" + goal + "'");
    if (goals.empty()) return Result<Route>::fail("no goal nodes (does the building have any exits?)");

    // With several goals, estimate using the closest one so the heuristic never overestimates.
    auto h = [&](const std::string& n) {
        float best = 1e30f;
        for (const auto& goal : goals) best = std::min(best, g.heuristic(n, goal));
        return best;
    };

    // Search state: node plus in-lift flag. A lift link from an on-foot state adds liftPenalty; a
    // lift link from an in-lift state adds travel time only. Keys: "L:n" on foot, "L:n|lift" in a lift.
    const float liftWait = GraphParams{}.liftPenalty;
    auto stateOf = [](const std::string& ref, bool inLift) { return inLift ? ref + "|lift" : ref; };
    auto refOf = [](const std::string& state) {
        const size_t bar = state.find('|');
        return bar == std::string::npos ? state : state.substr(0, bar);
    };

    using QItem = std::pair<float, std::string>;                  // f, state
    // std::greater makes it a min-heap: the lowest f (cost so far + estimate) comes out first.
    std::priority_queue<QItem, std::vector<QItem>, std::greater<QItem>> open;
    std::unordered_map<std::string, float>       gScore;          // best known cost from start
    std::unordered_map<std::string, std::string> cameFrom;        // previous state on that best path
    std::unordered_map<std::string, bool>        cameStepFree;    // was the edge into this state step-free?
    gScore[start] = 0.f;
    open.push({h(start), start});
    std::string reached;                                          // the goal state we got to (empty = none)

    while (!open.empty()) {
        auto [f, cur] = open.top(); open.pop();
        const std::string curRef = refOf(cur);
        if (goals.count(curRef)) { reached = cur; break; }        // first goal popped is the cheapest
        // A state can be queued more than once; skip copies whose cost has since been beaten.
        if (f > gScore[cur] + h(curRef) + 1e-3f) continue;        // stale entry
        const bool inLift = cur != curRef;
        auto it = g.adj.find(curRef);
        if (it == g.adj.end()) continue;                          // dead end, no connections
        for (const Adj& a : it->second) {
            if (opt.stepFreeOnly && !a.stepFree) continue;      // the whole accessibility feature: one filter
            if (opt.noLifts && a.lift) continue;
            const float tentative = gScore[cur] + a.cost + (a.lift && !inLift ? liftWait : 0.f);
            const std::string next = stateOf(a.to, a.lift);
            auto gs = gScore.find(next);
            // First time seeing this state, or found a cheaper way to it: record and queue it.
            if (gs == gScore.end() || tentative < gs->second) {
                gScore[next] = tentative;
                cameFrom[next] = cur;
                cameStepFree[next] = a.stepFree;
                open.push({tentative + h(a.to), next});
            }
        }
    }
    if (reached.empty()) return Result<Route>::fail(opt.stepFreeOnly ? "no step-free route exists" : "no route exists (are the nodes connected?)");

    // Walk back from the goal to the start through cameFrom, then flip to get start -> goal.
    Route route;
    std::vector<std::string> chain;
    for (std::string n = reached; ; n = cameFrom[n]) { chain.push_back(n); if (n == start) break; }
    std::reverse(chain.begin(), chain.end());
    for (const auto& state : chain) {
        const std::string ref = refOf(state);
        const Node* n = g.nodes[ref];
        RouteStep s; s.level = g.levelOf[ref]->id; s.node = n->id; s.pos = n->pos; s.kind = n->kind; s.cumulativeCost = gScore[state];
        route.steps.push_back(s);
        // One non-step-free edge anywhere makes the whole route not step-free.
        if (state != start && !cameStepFree[state]) route.stepFree = false;
    }
    route.totalCost = gScore[reached];
    return route;
}

} // namespace

Result<Route> findRoute(const Building& b, std::string_view fromRef, std::string_view toRef, const RouteOptions& opt) {
    // Reject badly formed refs here with a hint; search() reports refs that are well formed but unknown.
    if (!parseRef(fromRef)) return Result<Route>::fail("bad node reference '" + std::string(fromRef) + "', expected LEVEL:NODE like L5:n3");
    if (!parseRef(toRef))   return Result<Route>::fail("bad node reference '" + std::string(toRef)   + "', expected LEVEL:NODE like L5:n3");
    return search(b, std::string(fromRef), { std::string(toRef) }, opt);
}

Result<Route> findEgress(const Building& b, std::string_view fromRef, const RouteOptions& opt) {
    if (!parseRef(fromRef)) return Result<Route>::fail("bad node reference '" + std::string(fromRef) + "'");
    // Every exit node on every level is a goal; A* stops at whichever is cheapest to reach.
    std::unordered_set<std::string> exits;
    for (const Level& l : b.levels) for (const Node& n : l.nodes) if (n.kind == NodeKind::Exit) exits.insert(makeRef(l.id, n.id));
    if (exits.empty()) return Result<Route>::fail("egress: the building has no exit nodes (tag a room as 'exit')");
    // Egress: stairs only; lifts allowed when stepFreeOnly.
    RouteOptions egress = opt;
    egress.noLifts = !opt.stepFreeOnly;
    return search(b, std::string(fromRef), exits, egress);
}

std::optional<std::string> nodeForRoom(const Building& b, std::string_view codeOrId) {
    for (const Level& l : b.levels) {
        for (const Room& r : l.rooms) {
            // Match either the internal id ("r3") or the room code people use ("E2-05-12").
            if (r.id != codeOrId && r.code != codeOrId) continue;
            // Prefer the room's own centre node; fall back to a corridor sample (rooms that are corridors).
            for (const Node& n : l.nodes) if (n.room == r.id && n.kind != NodeKind::Corridor) return makeRef(l.id, n.id);
            for (const Node& n : l.nodes) if (n.room == r.id) return makeRef(l.id, n.id);
        }
    }
    return std::nullopt;
}

std::optional<std::string> nearestNode(const Building& b, std::string_view levelId, const Vec2& pos) {
    const Level* l = b.findLevel(levelId);
    if (!l || l->nodes.empty()) return std::nullopt;
    // Plain linear scan; squared distance is enough for comparing.
    const Node* best = nullptr; float bestD = 1e30f;
    for (const Node& n : l->nodes) { const float d = distanceSq(n.pos, pos); if (d < bestD) { bestD = d; best = &n; } }
    return makeRef(l->id, best->id);
}

} // namespace wf::graph
