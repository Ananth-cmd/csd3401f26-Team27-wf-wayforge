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
 * Contribution: Joel Chua 95%, Ananthan Elangovan 5%
 *   Joel Chua
 *   - Graph parameters, route / instruction data types and the public API
 *   - "LEVEL:NODE" reference scheme for routing across levels
 *   Ananthan Elangovan
 *   - Graph parameters for rooms without a found door and for passing through rooms
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
    float liftPenalty     = 25.f;     // extra cost for boarding a lift (waiting), once per ride
    bool  connectRoomsThroughDoors = true;   // room nodes only connect to the doors on their outline
    float missingDoorReach   = 3.f;   // fallback edges: max distance from a cut-off room's outline (no corridor reachable) to the node it joins
    float missingDoorPenalty = 10.f;  // extra cost added to each fallback edge
    float throughRoomPenalty = 5.f;   // extra cost for passing through a room (not a corridor, lobby or exit) on the way
    float outdoorClearance   = 1.5f;  // outdoor waypoints sit this far outside the corners of each block's outline
    float exitStep           = 1.f;   // outdoor paths start this far straight out of each exit door
    float outdoorCostFactor  = 1.f;   // outdoor edge cost = length x this (above 1 favours indoor routes and bridges)
    float offPathFactor      = 2.f;   // when the site has walkways: walking outside off them costs length x this
    float roadFactor         = 1.2f;  // walking along a road costs length x this (footpaths and cycle paths: x1)
    float walkwayReach       = 30.f;  // exit steps and block corners join walkways within this many metres
    float walkwayJoin        = 3.f;   // a walkway's end this close to another walkway joins it there
    bool  linkCutOffBlocks   = false; // prepareNavigation: give a block with no way in one link through its walls (off:
                                      // a route must never tell someone to walk through a wall; such a block shows as
                                      // not joined until its doors are drawn)
    float cutOffReach        = 12.f;  // joinCutOffBlocks: longest link allowed for a block with no way in
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
// links: total after linking. outdoorEdges / cutOffLinks: added by linkOutdoors / joinCutOffBlocks.
struct NavStats { GraphStats graph; int exits = 0; int links = 0; int outdoorEdges = 0; int cutOffLinks = 0; };
// buildGraph() with node ids from 100000, then on the lowest level markExitDoors() and
// linkOutdoors(), then linkFloors(), then joinCutOffBlocks() if p.linkCutOffBlocks is on (off by default).
NavStats prepareNavigation(Building& building, const GraphParams& p = {});

// --- walking outside on the ground floor (Outdoor.cpp) ------------------------------------
// Lets routes go outside between blocks. Each exit door gets a node exitStep metres straight out of
// it, and each corner of every block's outline (convex hull of its rooms) a waypoint
// outdoorClearance metres outside it. Every two of these that can see each other are joined: the
// straight line crosses no wall, no room, no water and no neighbouring building (the site's "water"
// areas and "buildings", when the file has a site). When the site has walkways ("roads": footpaths,
// cycle paths, roads) they become paths too, each of those points joins the walkways within
// walkwayReach, and walking off them costs offPathFactor times more, so routes keep to the
// walkways. Needs markExitDoors() first. Returns the edges added.
int linkOutdoors(Building& building, Level& ground, IdGenerator& ids, const GraphParams& p = {});
// A block on the ground floor that still can't be reached from the rest of the building (no exit
// door drawn, no bridge) gets one edge to the nearest door or corridor of another part, through the
// fewest walls and at most cutOffReach long, costing missingDoorPenalty extra. Run after
// linkFloors() so bridges count. Returns the number of edges added. That edge goes through a wall,
// so prepareNavigation only calls this when GraphParams::linkCutOffBlocks is on.
int joinCutOffBlocks(Building& building, Level& ground, const GraphParams& p = {});

// True if segment a-b crosses no wall of the level (openings let it through).
bool lineOfSight(const Level& level, const Vec2& a, const Vec2& b, float clearance = 0.15f);
// How many walls segment a-b runs into without going through one of their doors.
int wallsCrossed(const Level& level, const Vec2& a, const Vec2& b, float clearance = 0.15f);

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
    bool noLifts = false;                      // filter out lift links (set by findEgress unless stepFreeOnly)
};

// A* with straight-line distance as the heuristic. nodeRef = "L5:n3".
Result<Route> findRoute(const Building& b, std::string_view fromRef, std::string_view toRef, const RouteOptions& opt = {});
// Same search, target set = every exit node in the building; returns the cheapest. Uses stairs
// only, unless opt.stepFreeOnly.
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
