/*!
 * \file main.cpp
 * \brief Console test for wf_graph
 *
 * Builds a small level (two rooms and a corridor, each room with a door) with
 * wf_read, then checks: line of sight through doors but not walls, graph
 * building with no isolated nodes, A* between the two rooms, bad references
 * rejected, and on a second level linked by stairs and a lift: step-free
 * routing and egress to an exit. Last, two separate blocks on one level: the
 * fallback edges must not join them through their walls; with outer doors a
 * route goes outside between them through no wall, and follows a footpath when
 * the site has one; with no outer doors one last-resort link still makes the
 * second block reachable.
 *
 * Prints each failed CHECK with its file and line and returns 1, so CTest
 * (and the CI desktop job) fails if anything breaks.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Test level, line-of-sight, routing, step-free and egress checks
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-09-22
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// wf_graph console test: graph build, line of sight through doors, A*, step-free, egress, multi-level.
#include "wf_graph/wf_graph.hpp"   // Everything under test.
#include "wf_read/wf_read.hpp"     // read::interpret: turns line segments into walls, doors and rooms.
#include <iostream>                // Printing results and failures.
#include <cmath>                   // std::abs for positions.

// Counts failed checks; CHECK keeps going after a failure so one run shows every problem.
static int g_failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)

// Builds the same 2-room + corridor level used in wf_read's test, on a given level id/elevation.
static wf::Level makeLevel(wf::IdGenerator& ids, const std::string& id, float elevation) {
    using namespace wf; using vec::Segment;
    Level level; level.id = id; level.name = "Level " + id; level.elevation = elevation;
    // 10 x 8 m box. Corridor along the bottom (y 0..2), two rooms above split at x = 5.
    // The wall at y = 2 has gaps at x 2..2.9 and 7..7.9: those become the two doors.
    std::vector<Segment> segs = {
        {{0,0},{10,0}}, {{0,8},{10,8}}, {{0,0},{0,8}}, {{10,0},{10,8}},   // outer walls
        {{5,2},{5,8}},                                                    // wall between the rooms
        {{0,2},{2,2}}, {{2.9f,2},{7,2}}, {{7.9f,2},{10,2}},               // corridor wall with two gaps
    };
    auto st = read::interpret(segs, level, ids, {});
    if (!st) std::cerr << st.error() << "\n";
    return level;
}

// Two copies of makeLevel's block on one level: the second 12 m along and 0.5 m up, leaving a 2 m
// gap between them (two separate buildings, like neighbouring campus blocks). outerDoors: each block
// gets a door to the outside in its bottom wall (x 4..4.9), into its corridor.
static wf::Level makeTwoBlocks(wf::IdGenerator& ids, bool outerDoors = false) {
    using namespace wf; using vec::Segment;
    Level level; level.id = "L1"; level.name = "Level 1";
    std::vector<Segment> block = {
        {{0,8},{10,8}}, {{0,0},{0,8}}, {{10,0},{10,8}},
        {{5,2},{5,8}},
        {{0,2},{2,2}}, {{2.9f,2},{7,2}}, {{7.9f,2},{10,2}},
    };
    if (outerDoors) { block.push_back({{0,0},{4,0}}); block.push_back({{4.9f,0},{10,0}}); }
    else block.push_back({{0,0},{10,0}});
    std::vector<Segment> segs = block;
    for (const Segment& s : block) segs.push_back({ { s.a.x + 12.f, s.a.y + 0.5f }, { s.b.x + 12.f, s.b.y + 0.5f } });
    auto st = read::interpret(segs, level, ids, {});
    if (!st) std::cerr << st.error() << "\n";
    return level;
}

int main() {
    using namespace wf; using namespace wf::graph;

    IdGenerator ids;   // shared by both levels so node ids never repeat
    Building b;
    b.levels.push_back(makeLevel(ids, "L1", 0.f));
    Level& l1 = b.levels[0];
    CHECK(l1.rooms.size() == 3);                                  // 2 rooms + the corridor

    // line of sight: through the door yes, through the wall no
    CHECK(lineOfSight(l1, {2.45f, 1.f}, {2.45f, 3.f}));          // door at x 2..2.9
    CHECK(!lineOfSight(l1, {1.f, 1.f}, {1.f, 3.f}));             // solid wall
    CHECK(!lineOfSight(l1, {2.5f, 5.f}, {7.5f, 5.f}));           // partition at x=5

    GraphStats st = buildLevelGraph(l1, ids);
    std::cout << "nodes " << st.nodes << " edges " << st.edges << " isolated " << st.isolatedNodes << "\n";
    CHECK(st.nodes >= 2 + 2 + 4);                                 // 2 rooms, 2 doors, corridor samples
    CHECK(st.isolatedNodes == 0);                                 // every node can be reached

    // tag rooms so we can route by code; find the two non-corridor rooms
    std::string leftRoom, rightRoom;
    for (auto& r : l1.rooms) {
        if (r.kind == RoomKind::Corridor) continue;
        if (r.centroid.x < 5) { r.code = "E2-01-01"; leftRoom = r.id; } else { r.code = "E2-01-02"; rightRoom = r.id; }
    }
    // Route from the left room to the right room: must go out a door, along the corridor, in the other door.
    auto from = nodeForRoom(b, "E2-01-01"); auto to = nodeForRoom(b, "E2-01-02");
    CHECK(from && to);
    if (from && to) {
        auto route = findRoute(b, *from, *to);
        CHECK(route.ok());
        if (route) {
            std::cout << "route cost " << route->totalCost << " steps " << route->steps.size() << "\n";
            CHECK(route->steps.size() >= 4);                      // room -> door -> corridor... -> door -> room
            // substr(3) drops the "L1:" prefix to compare plain node ids.
            CHECK(route->steps.front().node == from->substr(3) && route->steps.back().node == to->substr(3));
            CHECK(route->totalCost > 8.f && route->totalCost < 20.f);   // longer than straight across, not a huge detour
            bool passedDoor = false; for (auto& s : route->steps) if (s.kind == NodeKind::Door) passedDoor = true;
            CHECK(passedDoor);
            CHECK(route->stepFree);                               // one level, no stairs
        }
    }
    // Bad input must fail cleanly, not crash.
    CHECK(!findRoute(b, "L1:n1", "L9:n1").ok());                  // level L9 doesn't exist
    CHECK(!findRoute(b, "garbage", "L1:n1").ok());                // not LEVEL:NODE

    // --- second level, linked by a stair (not step-free) and a lift (step-free)
    b.levels.push_back(makeLevel(ids, "L2", 4.f));               // same layout, 4 m higher
    buildLevelGraph(b.levels[1], ids);
    Level& l2 = b.levels[1];
    const Node& lowerNode = b.levels[0].nodes.back();   // some corridor node on L1
    // Make one L2 room the building's exit.
    for (auto& r : l2.rooms) if (r.kind != RoomKind::Corridor) { r.code = "E2-02-01"; r.kind = RoomKind::Exit; break; }
    l2.nodes.clear(); l2.edges.clear(); buildLevelGraph(l2, ids);   // rebuild so the exit room gets an Exit node
    // Stair between an L1 corridor node and an L2 corridor node; stairs are not step-free.
    Link stair; stair.a = "L1:" + lowerNode.id; stair.b = "L2:" + l2.nodes.back().id; stair.kind = LinkKind::Stair; stair.stepFree = false; stair.cost = 12.f;
    b.links.push_back(stair);

    auto upTo = nodeForRoom(b, "E2-02-01");
    CHECK(upTo.has_value());
    if (from && upTo) {
        // Normal route uses the stairs, so it ends on L2 and is not step-free.
        auto r1 = findRoute(b, *from, *upTo);
        CHECK(r1.ok());
        if (r1) { CHECK(!r1->stepFree); CHECK(r1->steps.back().level == "L2"); }
        // step-free: no lift yet -> impossible
        auto r2 = findRoute(b, *from, *upTo, {true});
        CHECK(!r2.ok());
        // add a lift link, now step-free works
        Link lift = stair; lift.kind = LinkKind::Lift; lift.stepFree = true; lift.cost = 25.f;
        b.links.push_back(lift);
        auto r3 = findRoute(b, *from, *upTo, {true});
        CHECK(r3.ok());
        if (r3) CHECK(r3->stepFree);
        // egress from L1 finds the exit on L2
        auto eg = findEgress(b, *from);
        CHECK(eg.ok());
        if (eg) CHECK(eg->steps.back().kind == NodeKind::Exit);
    }
    // nearest node helper
    auto nn = nearestNode(b, "L1", {2.45f, 2.f});               // a point in the left door
    CHECK(nn.has_value());

    // --- two separate blocks on one level: fallback edges (for rooms with no door found) must not
    //     join them through their walls. Each block keeps its own corridor, so no route between them.
    {
        IdGenerator ids2;
        Building campus;
        campus.levels.push_back(makeTwoBlocks(ids2));
        Level& lv = campus.levels[0];
        CHECK(lv.rooms.size() == 6);                              // 2 rooms + a corridor per block
        buildLevelGraph(lv, ids2);
        // Code the rooms, then pick two in the west block and one in the east block by position.
        int n = 0;
        std::string west, west2, east;
        for (auto& r : lv.rooms) {
            if (r.kind == RoomKind::Corridor) continue;
            r.code = "B-01-0" + std::to_string(++n);
            if (r.centroid.x > 11.f) east = r.code;
            else if (west.empty()) west = r.code;
            else west2 = r.code;
        }
        auto w = nodeForRoom(campus, west), w2 = nodeForRoom(campus, west2), e = nodeForRoom(campus, east);
        CHECK(w && w2 && e);
        if (w && w2 && e) {
            CHECK(findRoute(campus, *w, *w2).ok());               // inside one block: through the corridor
            CHECK(!findRoute(campus, *w, *e).ok());               // across the gap: no way through the walls
        }
        for (const Edge& edge : lv.edges) {                        // no edge spans the 2 m gap (x 10..12)
            const Node* a = lv.findNode(edge.a); const Node* b2 = lv.findNode(edge.b);
            if (a && b2) CHECK((a->pos.x < 11.f) == (b2->pos.x < 11.f));
        }
    }

    // Code the non-corridor rooms of a level, then give back one west room and one east room.
    auto westAndEast = [](Building& bld) {
        int n = 0;
        std::string west, east;
        for (auto& r : bld.levels[0].rooms) {
            if (r.kind == RoomKind::Corridor) continue;
            r.code = "C-01-0" + std::to_string(++n);
            if (r.centroid.x > 11.f) east = r.code; else if (west.empty()) west = r.code;
        }
        return std::make_pair(nodeForRoom(bld, west), nodeForRoom(bld, east));
    };

    // --- two blocks, each with a door to the outside: prepareNavigation adds outdoor paths, so the
    //     route goes out one exit, round the outside and in the other, never through a wall.
    {
        IdGenerator ids3;
        Building campus;
        campus.levels.push_back(makeTwoBlocks(ids3, true));
        const NavStats nav = prepareNavigation(campus);
        std::cout << "outdoor: exits " << nav.exits << " outdoor edges " << nav.outdoorEdges << " cut-off links " << nav.cutOffLinks << "\n";
        CHECK(nav.exits >= 2);                                    // one outer door per block
        CHECK(nav.outdoorEdges > 0);
        CHECK(nav.cutOffLinks == 0);                              // joined outside, no link through walls needed
        auto [w, e] = westAndEast(campus);
        CHECK(w && e);
        if (w && e) {
            auto route = findRoute(campus, *w, *e);
            CHECK(route.ok());
            if (route) {
                int exitsPassed = 0;
                for (size_t i = 0; i < route->steps.size(); ++i) {
                    if (route->steps[i].kind == NodeKind::Exit) ++exitsPassed;
                    if (i > 0) CHECK(lineOfSight(campus.levels[0], route->steps[i - 1].pos, route->steps[i].pos));
                }
                CHECK(exitsPassed == 2);                          // out of one block, into the other
            }
        }
    }

    // --- the same two blocks with a footpath in the site, 3 m below both doors (y = -3). Walking off
    //     it costs offPathFactor (2) times more, so the route steps out to the path, follows it and
    //     comes back in (about 2 + 12 + 2.5 m, cost ~21) rather than the 12 m straight line between
    //     the doors (cost 24).
    {
        IdGenerator ids5;
        Building campus;
        campus.levels.push_back(makeTwoBlocks(ids5, true));
        campus.site = R"({"roads":[{"kind":"path","name":"Test Walk","points":[[-5,-3],[30,-3]]}]})";
        prepareNavigation(campus);
        auto [w, e] = westAndEast(campus);
        CHECK(w && e);
        if (w && e) {
            auto route = findRoute(campus, *w, *e);
            CHECK(route.ok());
            if (route) {
                bool onPath = false;
                for (const auto& s : route->steps) if (std::abs(s.pos.y + 3.f) < 0.01f) onPath = true;
                CHECK(onPath);                                    // walked along the footpath
                for (size_t i = 1; i < route->steps.size(); ++i)
                    CHECK(lineOfSight(campus.levels[0], route->steps[i - 1].pos, route->steps[i].pos));
            }
        }
    }

    // --- the same blocks with no outer doors: joinCutOffBlocks gives the second one link, so every
    //     block can still be reached.
    {
        IdGenerator ids4;
        Building campus;
        campus.levels.push_back(makeTwoBlocks(ids4, false));
        const NavStats nav = prepareNavigation(campus);
        CHECK(nav.exits == 0);
        CHECK(nav.cutOffLinks == 1);
        auto [w, e] = westAndEast(campus);
        CHECK(w && e);
        if (w && e) CHECK(findRoute(campus, *w, *e).ok());
    }

    // Non-zero exit tells CTest the test failed.
    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_graph: all checks passed\n";
    return 0;
}
