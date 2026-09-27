#include "wf_graph/wf_graph.hpp"
#include <queue>
#include <unordered_map>
#include <unordered_set>
#include <algorithm>

namespace wf::graph {
namespace {

struct Ref { std::string level, node; };

std::optional<Ref> parseRef(std::string_view ref) {
    const size_t colon = ref.find(':');
    if (colon == std::string_view::npos || colon == 0 || colon + 1 >= ref.size()) return std::nullopt;
    return Ref{ std::string(ref.substr(0, colon)), std::string(ref.substr(colon + 1)) };
}
std::string makeRef(const std::string& level, const std::string& node) { return level + ":" + node; }

struct Adj { std::string to; float cost; bool stepFree; };

// Flatten the whole building into one adjacency map keyed by "L:n".
struct FlatGraph {
    std::unordered_map<std::string, const Node*>            nodes;      // ref -> node
    std::unordered_map<std::string, const Level*>           levelOf;
    std::unordered_map<std::string, std::vector<Adj>>       adj;
    std::unordered_map<std::string, float>                  elevation;  // ref -> level elevation

    explicit FlatGraph(const Building& b, const GraphParams& gp = {}) {
        for (const Level& l : b.levels) {
            for (const Node& n : l.nodes) { const std::string r = makeRef(l.id, n.id); nodes[r] = &n; levelOf[r] = &l; elevation[r] = l.elevation; }
            for (const Edge& e : l.edges) {
                const std::string ra = makeRef(l.id, e.a), rb = makeRef(l.id, e.b);
                adj[ra].push_back({rb, e.cost, e.stepFree});
                adj[rb].push_back({ra, e.cost, e.stepFree});
            }
        }
        for (const Link& lk : b.links) {
            if (!nodes.count(lk.a) || !nodes.count(lk.b)) continue;
            float cost = lk.cost;
            if (lk.kind == LinkKind::Stair) cost = std::max(cost, gp.stairPenalty);
            if (lk.kind == LinkKind::Lift)  cost = std::max(cost, gp.liftPenalty);
            adj[lk.a].push_back({lk.b, cost, lk.stepFree});
            adj[lk.b].push_back({lk.a, cost, lk.stepFree});
        }
    }
    float heuristic(const std::string& a, const std::string& b) const {
        const Node* na = nodes.at(a); const Node* nb = nodes.at(b);
        const float dz = elevation.at(a) - elevation.at(b);
        return std::sqrt(distanceSq(na->pos, nb->pos) + dz * dz);     // admissible: straight-line distance
    }
};

Result<Route> search(const Building& b, const std::string& start, const std::unordered_set<std::string>& goals, const RouteOptions& opt) {
    FlatGraph g(b);
    if (!g.nodes.count(start)) return Result<Route>::fail("unknown start node '" + start + "'");
    for (const auto& goal : goals) if (!g.nodes.count(goal)) return Result<Route>::fail("unknown goal node '" + goal + "'");
    if (goals.empty()) return Result<Route>::fail("no goal nodes (does the building have any exits?)");

    auto h = [&](const std::string& n) {
        float best = 1e30f;
        for (const auto& goal : goals) best = std::min(best, g.heuristic(n, goal));
        return best;
    };

    using QItem = std::pair<float, std::string>;                  // f, node
    std::priority_queue<QItem, std::vector<QItem>, std::greater<QItem>> open;
    std::unordered_map<std::string, float>       gScore;
    std::unordered_map<std::string, std::string> cameFrom;
    std::unordered_map<std::string, bool>        cameStepFree;
    gScore[start] = 0.f;
    open.push({h(start), start});
    std::string reached;

    while (!open.empty()) {
        auto [f, cur] = open.top(); open.pop();
        if (goals.count(cur)) { reached = cur; break; }
        if (f > gScore[cur] + h(cur) + 1e-3f) continue;           // stale entry
        auto it = g.adj.find(cur);
        if (it == g.adj.end()) continue;
        for (const Adj& a : it->second) {
            if (opt.stepFreeOnly && !a.stepFree) continue;      // the whole accessibility feature: one filter
            const float tentative = gScore[cur] + a.cost;
            auto gs = gScore.find(a.to);
            if (gs == gScore.end() || tentative < gs->second) {
                gScore[a.to] = tentative;
                cameFrom[a.to] = cur;
                cameStepFree[a.to] = a.stepFree;
                open.push({tentative + h(a.to), a.to});
            }
        }
    }
    if (reached.empty()) return Result<Route>::fail(opt.stepFreeOnly ? "no step-free route exists" : "no route exists (are the nodes connected?)");

    Route route;
    std::vector<std::string> chain;
    for (std::string n = reached; ; n = cameFrom[n]) { chain.push_back(n); if (n == start) break; }
    std::reverse(chain.begin(), chain.end());
    for (const auto& ref : chain) {
        const Node* n = g.nodes[ref];
        RouteStep s; s.level = g.levelOf[ref]->id; s.node = n->id; s.pos = n->pos; s.kind = n->kind; s.cumulativeCost = gScore[ref];
        route.steps.push_back(s);
        if (ref != start && !cameStepFree[ref]) route.stepFree = false;
    }
    route.totalCost = gScore[reached];
    return route;
}

} // namespace

Result<Route> findRoute(const Building& b, std::string_view fromRef, std::string_view toRef, const RouteOptions& opt) {
    if (!parseRef(fromRef)) return Result<Route>::fail("bad node reference '" + std::string(fromRef) + "', expected LEVEL:NODE like L5:n3");
    if (!parseRef(toRef))   return Result<Route>::fail("bad node reference '" + std::string(toRef)   + "', expected LEVEL:NODE like L5:n3");
    return search(b, std::string(fromRef), { std::string(toRef) }, opt);
}

Result<Route> findEgress(const Building& b, std::string_view fromRef, const RouteOptions& opt) {
    if (!parseRef(fromRef)) return Result<Route>::fail("bad node reference '" + std::string(fromRef) + "'");
    std::unordered_set<std::string> exits;
    for (const Level& l : b.levels) for (const Node& n : l.nodes) if (n.kind == NodeKind::Exit) exits.insert(makeRef(l.id, n.id));
    if (exits.empty()) return Result<Route>::fail("egress: the building has no exit nodes (tag a room as 'exit')");
    return search(b, std::string(fromRef), exits, opt);
}

std::optional<std::string> nodeForRoom(const Building& b, std::string_view codeOrId) {
    for (const Level& l : b.levels) {
        for (const Room& r : l.rooms) {
            if (r.id != codeOrId && r.code != codeOrId) continue;
            for (const Node& n : l.nodes) if (n.room == r.id && n.kind != NodeKind::Corridor) return makeRef(l.id, n.id);
            for (const Node& n : l.nodes) if (n.room == r.id) return makeRef(l.id, n.id);
        }
    }
    return std::nullopt;
}

std::optional<std::string> nearestNode(const Building& b, std::string_view levelId, const Vec2& pos) {
    const Level* l = b.findLevel(levelId);
    if (!l || l->nodes.empty()) return std::nullopt;
    const Node* best = nullptr; float bestD = 1e30f;
    for (const Node& n : l->nodes) { const float d = distanceSq(n.pos, pos); if (d < bestD) { bestD = d; best = &n; } }
    return makeRef(l->id, best->id);
}

} // namespace wf::graph
