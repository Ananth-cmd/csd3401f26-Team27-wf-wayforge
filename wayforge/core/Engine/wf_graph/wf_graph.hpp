// wf_graph - public header.
// Builds the navigation graph from rooms and doors, and answers routing
// questions on it: A* between two nodes, step-free filtering, and egress
// (cheapest path to any exit). Multi-level routing walks the building's links.
#pragma once
#include <vector>
#include <string>
#include <optional>
#include "wf_core/wf_core.hpp"
#include "wf_doc/wf_doc.hpp"

namespace wf::graph {

struct GraphParams {
    float corridorSpacing = 2.f;      // metres between corridor sample nodes
    float wallClearance   = 0.15f;    // a walk line closer than this to a wall counts as blocked
    float maxEdgeLength   = 12.f;     // do not connect nodes further apart than this (keeps the graph sparse)
    float stairPenalty    = 12.f;     // extra cost for a stair link
    float liftPenalty     = 25.f;     // extra cost for a lift link (waiting)
    bool  connectRoomsThroughDoors = true;
};

struct GraphStats { int nodes = 0; int edges = 0; int isolatedNodes = 0; };

// Replaces level.nodes and level.edges. Room nodes at room centroids, door nodes
// at opening midpoints, corridor nodes sampled along corridor long axes.
// Two nodes are connected if the straight line between them crosses no wall.
GraphStats buildLevelGraph(Level& level, IdGenerator& ids, const GraphParams& p = {});
// Rebuilds every level, keeps building.links as they are.
GraphStats buildGraph(Building& building, IdGenerator& ids, const GraphParams& p = {});

// True if segment a-b crosses no wall of the level (openings let it through).
bool lineOfSight(const Level& level, const Vec2& a, const Vec2& b, float clearance = 0.15f);

// A route across the building. Node refs are "L5:n3".
struct RouteStep {
    std::string level;
    std::string node;
    Vec2        pos;
    NodeKind    kind = NodeKind::Corridor;
    float       cumulativeCost = 0.f;
};
struct Route {
    std::vector<RouteStep> steps;
    float totalCost = 0.f;
    bool  stepFree  = true;                    // true if no non-step-free edge was used
    bool  empty() const noexcept { return steps.empty(); }
};

struct RouteOptions {
    bool stepFreeOnly = false;                 // filter out edges/links with stepFree == false before searching
};

// A* with straight-line distance as the heuristic. nodeRef = "L5:n3".
Result<Route> findRoute(const Building& b, std::string_view fromRef, std::string_view toRef, const RouteOptions& opt = {});
// Same search, target set = every exit node in the building; returns the cheapest.
Result<Route> findEgress(const Building& b, std::string_view fromRef, const RouteOptions& opt = {});
// Helper: node ref of a room's node, e.g. roomNode(b, "E2-05-12") -> "L5:n1"
std::optional<std::string> nodeForRoom(const Building& b, std::string_view roomCodeOrId);
std::optional<std::string> nearestNode(const Building& b, std::string_view levelId, const Vec2& pos);

// Turn-by-turn text for a route: "Leave E2-05-12 through the door", "Turn left and walk 12 m",
// "Take the stairs up to Level 3", "Arrive at E2-05-20". One entry per instruction, in order.
struct Instruction {
    std::string text;
    Vec2        pos;                           // where the instruction applies
    std::string level;
    float       distanceToNext = 0.f;          // metres of walking this instruction covers
};
std::vector<Instruction> instructions(const Building& b, const Route& r);

// Rooms whose code or name contains the query (case-insensitive). Returns room ids as "L1:r3".
std::vector<std::string> searchRooms(const Building& b, std::string_view query, size_t maxResults = 20);

} // namespace wf::graph
