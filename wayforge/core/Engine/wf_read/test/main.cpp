/*!
 * \file main.cpp
 * \brief Tests for wf_read: walls, doors and rooms
 *
 * Three small hand-made plans with known answers:
 *   1. Two lines 0.2 m apart should become one wall 0.2 m thick.
 *   2. A 0.9 m gap between two walls should become a door. A 2 m gap should not.
 *   3. A box split into two rooms and a corridor should give 3 rooms, 2 doors
 *      and 1 corridor, and still be the same after saving and loading.
 * Run with: ctest -R wf_read
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - Test cases for each step and for the whole read
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-09-14
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_read/wf_read.hpp"
#include <iostream>

static int g_failures = 0;
// Prints the line number and counts a failure when cond is false
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)

int main() {
    using namespace wf; using namespace wf::read; using vec::Segment;
    ReadParams p;

    // --- walls: two parallel lines 0.2 apart become one wall, 0.2 thick, halfway between them
    {
        IdGenerator ids;
        std::vector<Segment> segs = { {{0,0},{10,0}}, {{0,0.2f},{10,0.2f}}, {{20,5},{20,9}} };
        ReadStats st;
        auto walls = pairWalls(segs, ids, p, &st);
        CHECK(walls.size() == 2);
        CHECK(st.pairedWalls == 1 && st.singleWalls == 1);
        CHECK(std::abs(walls[0].thickness - 0.2f) < 1e-4f);
        CHECK(std::abs(walls[0].a.y - 0.1f) < 1e-4f && std::abs(walls[0].b.y - 0.1f) < 1e-4f);
        CHECK(walls[0].confidence > walls[1].confidence);   // the paired wall is more certain than the lone line
    }

    // --- doors: a 0.9 m gap in a straight wall becomes one wall + one door
    {
        IdGenerator ids;
        std::vector<Wall> walls;
        Wall a; a.id = ids.next("w"); a.a = { 0,0 }; a.b = { 4,0 };
        Wall b; b.id = ids.next("w"); b.a = { 4.9f,0 }; b.b = { 10,0 };
        Wall c; c.id = ids.next("w"); c.a = { 12,0 }; c.b = { 15,0 };       // 2 m gap: too wide, stays separate
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
            CHECK(std::abs(pos.x - 4.45f) < 1e-4f);   // door centre is in the middle of the gap
        }
    }

    // --- rooms: a 10x8 box, split at x=5 into two rooms, with a corridor along the bottom
    {
        IdGenerator ids;
        Level level;
        std::vector<Segment> segs = {
            {{0,0},{10,0}}, {{0,8},{10,8}}, {{0,0},{0,8}}, {{10,0},{10,8}},   // outside walls
            {{5,2},{5,8}},                                                     // wall between the two rooms
            {{0,2},{2,2}}, {{2.9f,2},{7,2}}, {{7.9f,2},{10,2}},                // corridor wall with two door gaps
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
            CHECK(std::abs(area - 80.f) < 0.5f);   // all rooms together fill the 10x8 box
            // saving and loading keeps all 3 rooms
            Document doc; doc.addLevel(level);
            auto back = Document::fromJson(doc.toJson());
            CHECK(back.ok() && back->level(0)->rooms.size() == 3);
        }
    }

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_read: all checks passed\n";
    return 0;
}
