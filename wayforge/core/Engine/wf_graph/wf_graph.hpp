/*!
 * \file wf_graph.hpp
 * \brief Navigation graph and routing: public header
 *
 * Builds the navigation graph from rooms and doors, and answers routing
 * questions on it: A* between two nodes, step-free filtering, and egress
 * (cheapest path to any exit). Multi-level routing walks the building's links.
 * Also turns a route into turn-by-turn text and searches rooms by code/name.
 *
 * Nodes are referred to across the whole building as "LEVEL:NODE", e.g. "L5:n3",
 * because node ids are only unique inside one level's list.
 *
 * Links: wf_read produces the rooms/walls/openings this graph is built from;
 * wf_api (wf_build_graph, wf_route, wf_egress, wf_instructions, wf_search_rooms)
 * calls the functions here for the Unity app.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Graph parameters, route / instruction data types and the public API
 *   - "LEVEL:NODE" reference scheme for routing across levels
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-09-21
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// wf_graph - public header.
// Builds the navigation graph from rooms and doors, and answers routing
// questions on it: A* between two nodes, step-free filtering, and egress
// (cheapest path to any exit). Multi-level routing walks the building's links.
#pragma once
#include <vector>              // Route steps, instruction lists, search results.
#include <string>              // Level / node ids and instruction text.
#include <optional>            // nodeForRoom / nearestNode may find nothing.
#include "wf_core/wf_core.hpp" // Vec2, Result<T>, IdGenerator.
#include "wf_doc/wf_doc.hpp"   // Building, Level, Node, Edge, Link, Room.

namespace wf::graph {

// Tuning values for buildLevelGraph / buildGraph. All distances are in metres.
struct GraphParams {
    float corridorSpacing = 2.f;      // metres between corridor sample nodes
    float wallClearance   = 0.15f;    // a walk line closer than this to a wall counts as blocked
    float maxEdgeLength   = 12.f;     // do not connect nodes further apart than this (keeps the graph sparse)
    float stairPenalty    = 12.f;     // extra cost for a stair link
    float liftPenalty     = 25.f;     // extra cost for a lift link (waiting)
    bool  connectRoomsThroughDoors = true;   // room nodes only connect to the doors on their outline
};

// Summary returned after building; isolatedNodes > 0 usually means a room has no reachable door.
struct GraphStats { int nodes = 0; int edges = 0; int isolatedNodes = 0; };

// Replaces level.nodes and level.edges. Room nodes at room centroids, door nodes
// at opening midpoints, corridor nodes sampled along corridor long axes.
// Two nodes are connected if the straight line between them crosses no wall.
GraphStats buildLevelGraph(Level& level, IdGenerator& ids, const GraphParams& p = {});
// Rebuilds every level, keeps building.links as they are.
GraphStats buildGraph(Building& building, IdGenerator& ids, const GraphParams& p = {});

// --- building-level navigation (Link.cpp) ------------------------------------------------
// Set NodeKind::Exit on door nodes whose opening has a room on one side only. Returns the count.
int markExitDoors(Level& level);
// Link every stair / lift room to the room of the same kind within maxOffset metres on the next
// level up (by elevation). Lift links are step-free. Links to missing nodes are removed first and
// existing links are not duplicated. Returns the number of links added.
int linkFloors(Building& building, float maxOffset = 3.f);
struct NavStats { GraphStats graph; int exits = 0; int links = 0; };   // links: total after linking
// buildGraph() with node ids from 100000, then markExitDoors() on every level and linkFloors().
NavStats prepareNavigation(Building& building, const GraphParams& p = {});

// True if segment a-b crosses no wall of the level (openings let it through).
bool lineOfSight(const Level& level, const Vec2& a, const Vec2& b, float clearance = 0.15f);

// A route across the building. Node refs are "L5:n3".
// One step of a route: the node walked through and the total cost to reach it.
struct RouteStep {
    std::string level;                         // level id, e.g. "L5"
    std::string node;                          // node id inside that level, e.g. "n3"
    Vec2        pos;                           // node position on its level
    NodeKind    kind = NodeKind::Corridor;     // room / door / corridor / stair / lift / exit
    float       cumulativeCost = 0.f;          // cost from the start up to this step
};
// The full path from start to goal, in walking order.
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
// Helper: ref of the node closest to a point on a level (e.g. where the user tapped).
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
