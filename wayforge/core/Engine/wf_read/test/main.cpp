/*!
 * \file main.cpp
 * \brief tests for wf_read
 *
 * 3 small plans i made by hand where i know the answer:
 *   1. 2 lines 0.2m apart should become 1 wall 0.2m thick
 *   2. a 0.9m gap should become a door, a 2m gap shouldnt
 *   3. a box split into 2 rooms + a corridor should give 3 rooms,
 *      2 doors, 1 corridor, and stay the same after save + load
 * run with: ctest -R wf_read
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - test cases for each step and the whole thing
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-09-14
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_read/wf_read.hpp"
#include <iostream>

static int g_failures = 0;
// prints the line + counts a fail if cond is false
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)

int main() {
    using namespace wf; using namespace wf::read; using vec::Segment;
    ReadParams p;

    // walls: 2 lines 0.2 apart -> 1 wall 0.2 thick, halfway between
    {
        IdGenerator ids;
        std::vector<Segment> segs = { {{0,0},{10,0}}, {{0,0.2f},{10,0.2f}}, {{20,5},{20,9}} };
        ReadStats st;
        auto walls = pairWalls(segs, ids, p, &st);
        CHECK(walls.size() == 2);
        CHECK(st.pairedWalls == 1 && st.singleWalls == 1);
        CHECK(std::abs(walls[0].thickness - 0.2f) < 1e-4f);
        CHECK(std::abs(walls[0].a.y - 0.1f) < 1e-4f && std::abs(walls[0].b.y - 0.1f) < 1e-4f);
        CHECK(walls[0].confidence > walls[1].confidence);   // paired wall should be more sure than the single line
    }

    // doors: 0.9m gap -> 1 wall + 1 door
    {
        IdGenerator ids;
        std::vector<Wall> walls;
        Wall a; a.id = ids.next("w"); a.a = { 0,0 }; a.b = { 4,0 };
        Wall b; b.id = ids.next("w"); b.a = { 4.9f,0 }; b.b = { 10,0 };
        Wall c; c.id = ids.next("w"); c.a = { 12,0 }; c.b = { 15,0 };       // 2m gap, too wide so stays separate
        walls = { a, b, c };
        std::vector<Opening> openings;
        bridgeDoorGaps(walls, openings, ids, p);
        CHECK(walls.size() == 2);
        CHECK(openings.size() == 1);
        if (!openings.empty()) {
            CHECK(openings[0].type == OpeningType::Door);
            CHECK(std::abs(openings[0].offset - 4.f) < 1e-4f && std::abs(openings[0].width - 0.9f) < 1e-4f);
            CHECK(openings[0].wall == walls[0].id);
            Vec2 pos = openingPosition(walls[0], openings[0]);
            CHECK(std::abs(pos.x - 4.45f) < 1e-4f);   // door centre should be in the middle of the gap
        }
    }

    // rooms: 10x8 box, split at x=5 into 2 rooms + a corridor at the bottom
    {
        IdGenerator ids;
        Level level;
        std::vector<Segment> segs = {
            {{0,0},{10,0}}, {{0,8},{10,8}}, {{0,0},{0,8}}, {{10,0},{10,8}},   // outside walls
            {{5,2},{5,8}},                                                     // wall between the 2 rooms
            {{0,2},{2,2}}, {{2.9f,2},{7,2}}, {{7.9f,2},{10,2}},                // corridor wall with 2 door gaps
        };
        auto st = interpret(segs, level, ids, p);
        CHECK(st.ok());
        if (st) {
            std::cout << "walls " << level.walls.size() << " openings " << level.openings.size() << " rooms " << level.rooms.size() << " corridors " << st->corridors << "\n";
            CHECK(level.openings.size() == 2);
            CHECK(level.rooms.size() == 3);
            int corridors = 0; float area = 0.f;
            for (auto& r : level.rooms) { if (r.kind == RoomKind::Corridor) ++corridors; area += r.area; CHECK(!r.boundary.empty()); CHECK(pointInPolygon(r.centroid, r.polygon)); }
            CHECK(corridors == 1);
            CHECK(std::abs(area - 80.f) < 0.5f);   // all rooms together should fill the 10x8 box
            // save + load should keep all 3 rooms
            Document doc; doc.addLevel(level);
            auto back = Document::fromJson(doc.toJson());
            CHECK(back.ok() && back->level(0)->rooms.size() == 3);
        }
    }

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_read: all checks passed\n";
    return 0;
}
