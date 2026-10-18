/*!
 * \file main.cpp (wf_vector test)
 * \brief Console test for wf_vector, run automatically by CTest and CI
 *
 * Checks every stage of wf_vector on small inputs where we know the right
 * answer: an SVG with two rooms (and a transform, a path, text to ignore),
 * finding exactly two rooms in it, face-finding on a 2x1 grid with a stray
 * line, merging/snapping/straightening noisy lines, Douglas-Peucker, and
 * the full picture path (thin -> trace -> fit -> clean -> faces) on a drawn
 * rectangle, and the blueprint symbols: a lift X, a stair flight, a door
 * leaf and slanted arc leftovers. Returns 0 if everything passed, 1 otherwise.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Test cases covering SVG import, clean-up, planar graph and the raster path
 *   - Symbol checks (Symbols.cpp): lifts, stairs, door leaves, arc leftovers
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-16
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// wf_vector console test: SVG import, thinning, tracing, DP, clean-up, planar faces.
#include "wf_vector/wf_vector.hpp"   // Everything being tested.
#include <iostream>

static int g_failures = 0;   // Number of failed checks; non-zero means the test fails.
// CHECK prints which line failed and keeps going, so one run shows every problem.
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)

int main() {
    using namespace wf; using namespace wf::vec;

    //SVG: two rooms sharing a wall, one door gap, a transform, a path
    const char* svg = R"svg(<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
        <g transform="translate(0 0)">
          <rect x="0" y="0" width="100" height="100" fill="none"/>
          <polyline points="100,0 200,0 200,100 100,100"/>
          <path d="M 100 100 L 100 60 M 100 40 L 100 0"/>
          <line x1="0" y1="0" x2="0" y2="0"/>
          <text x="5" y="5">E2-05</text>
        </g></svg>)svg";
    auto imp = importSvgText(svg);
    CHECK(imp.ok());
    if (imp) {
        CHECK(imp->width == 200.f && imp->height == 100.f);
        CHECK(imp->segments.size() == 4 + 3 + 2);        // rect 4, polyline 3, path 2, zero-length line dropped
        CHECK(imp->ignoredElements == 1);                // <text>
    }
    CHECK(!importSvgText("<html/>").ok());   // Valid XML but not an SVG: must be rejected.
    CHECK(!importSvgText("<svg>").ok());     // Broken XML: must be rejected.
    // translate(10,20) scale(2): a line from x=0 to x=5 should end up from x=10 to x=20, at y=20.
    auto tr = importSvgText(R"svg(<svg><g transform="translate(10,20) scale(2)"><line x1="0" y1="0" x2="5" y2="0"/></g></svg>)svg");
    CHECK(tr.ok() && tr->segments.size() == 1);
    if (tr) { CHECK(std::abs(tr->segments[0].a.x - 10) < 1e-4f && std::abs(tr->segments[0].b.x - 20) < 1e-4f && std::abs(tr->segments[0].a.y - 20) < 1e-4f); }

    //planar graph + faces from the SVG: 2 rooms, the door gap must not break either room
    if (imp) {
        auto segs = clean(imp->segments, { 3.f, 1.f, 1.f, 2.f, true, 8.f, 0.5f });
        PlanarGraph g = buildPlanarGraph(segs, 0.5f);
        CHECK(g.vertexCount() >= 6);
        auto faces = findFaces(g);
        // the right room has a gap in its left wall (the shared one), but the left room is closed by <rect>,
        // and the gap segments close it because 100,0-100,40 and 100,60-100,100 plus the rect edge 100,0-100,100 overlap
        CHECK(faces.size() == 2);
        float total = 0.f; for (auto& f : faces) total += f.area;
        CHECK(std::abs(total - 20000.f) < 1.f);   // The two rooms together cover the whole 200 x 100 drawing.
    }

    //pure face finding on a 2x1 grid of squares drawn as 7 segments
    std::vector<Segment> grid = {
        {{0,0},{2,0}}, {{0,1},{2,1}}, {{0,0},{0,1}}, {{1,0},{1,1}}, {{2,0},{2,1}},
        {{3,3},{4,4}}   // a dangling stroke that must not create a face
    };
    PlanarGraph pg = buildPlanarGraph(grid, 0.01f);
    CHECK(pg.edgeCount() == 8);                          // the two long lines are split at x=1, plus the stray
    auto faces = findFaces(pg);
    CHECK(faces.size() == 2);                            // Two 1x1 squares.
    for (auto& f : faces) CHECK(std::abs(f.area - 1.f) < 1e-4f);
    PlanarGraph pruned = pruneDanglingEdges(pg);
    CHECK(pruned.edgeCount() == 7);                      // The stray line is gone; the squares are untouched.

    //merge / snap / straighten
    // Two slightly wobbly halves of one horizontal wall, plus a vertical wall that nearly touches it.
    std::vector<Segment> noisy = { {{0,0},{4.95f,0.02f}}, {{5.05f,-0.01f},{10,0}}, {{10.03f,0.02f},{10,5}} };
    auto merged = mergeCollinear(noisy, 3.f, 0.15f);
    CHECK(merged.size() == 2);                                          // The two halves became one wall.
    auto snapped = snapEndpoints(merged, 0.1f);
    CHECK(snapped.size() == 2 && snapped[0].b == snapped[1].a);         // The corner now shares exactly one point.
    float axis = dominantAngle(snapped);
    CHECK(std::abs(radToDeg(axis)) < 1.f || std::abs(radToDeg(axis) - 90.f) < 1.f);   // The grid is (about) 0/90 degrees.
    auto straight = straighten(snapped, 0.f, 8.f);
    CHECK(std::abs(straight[0].a.y - straight[0].b.y) < 1e-4f);         // Now exactly horizontal...
    CHECK(std::abs(straight[1].a.x - straight[1].b.x) < 1e-4f);         // ...and exactly vertical.

    //Douglas-Peucker: a noisy straight line becomes 2 points; an L stays 3
    Polyline line; for (int i = 0; i <= 100; ++i) line.push_back({ static_cast<float>(i), (i % 2) * 0.3f });
    CHECK(douglasPeucker(line, 1.f).size() == 2);
    Polyline L; for (int i = 0; i <= 10; ++i) L.push_back({ static_cast<float>(i), 0 }); for (int i = 1; i <= 10; ++i) L.push_back({ 10, static_cast<float>(i) });
    CHECK(douglasPeucker(L, 0.5f).size() == 3);

    //thinning + tracing on a drawn thick rectangle
    img::Image8 bin(60, 40, 255);
    for (int y = 5; y < 35; ++y) for (int x = 5; x < 55; ++x)
        if (x < 9 || x >= 51 || y < 9 || y >= 31) bin.at(x, y) = 0;    // 4px thick outline
    img::Image8 sk = thin(bin);
    size_t inkBefore = img::countInk(bin), inkAfter = img::countInk(sk);
    CHECK(inkAfter < inkBefore / 2);                                    // Thinning removed most of the ink...
    CHECK(inkAfter >= 100 && inkAfter <= 200);                          // roughly the perimeter ~ 2*(46+26)
    auto runs = traceSkeleton(sk);
    CHECK(!runs.empty());
    size_t tracedPixels = 0; for (auto& r : runs) tracedPixels += r.size();
    CHECK(tracedPixels >= inkAfter * 0.9);                              // Tracing followed (almost) every skeleton pixel.
    auto fitted = fitPolylines(runs, 1.5f, 2.f);
    CHECK(fitted.size() >= 4 && fitted.size() <= 8);                    // A rectangle: about 4 straight sides.
    auto cleaned = clean(fitted, { 3.f, 2.f, 2.f, 5.f, true, 8.f, 2.f });
    PlanarGraph rg = buildPlanarGraph(cleaned, 2.f);
    auto rfaces = findFaces(rg);
    CHECK(rfaces.size() == 1);                                          // One closed room.
    if (!rfaces.empty()) CHECK(rfaces[0].area > 40 * 20 && rfaces[0].area < 50 * 30);

    // blueprint symbols (Symbols.cpp), in metres, inside a 20 x 10 m building so the grid is clear
    const std::vector<Segment> building = { {{0,0},{20,0}}, {{20,0},{20,10}}, {{20,10},{0,10}}, {{0,10},{0,0}} };
    {
        // lift: an X in the box 1..4, one arm cut in two by a door leaf drawn over it
        auto s = building;
        s.push_back({{1,4},{4,1}});                 // arm 1, whole
        s.push_back({{2.1f,2.1f},{4,4}});           // arm 2 through the crossing at (2.5, 2.5)...
        s.push_back({{1,1},{2,2}});                 // ...and its cut-off piece, not near the crossing
        auto lifts = detectLifts(s);
        CHECK(lifts.size() == 1);
        CHECK(s.size() == building.size());         // all three X pieces are gone
        if (!lifts.empty()) {
            CHECK(distance(lifts[0].centre, {2.5f, 2.5f}) < 0.05f);
            CHECK(lifts[0].box.size().x > 2.9f && lifts[0].box.size().y > 2.9f);
        }
    }
    {
        // stairs: 7 treads 2 m long, 0.3 m apart
        auto s = building;
        for (int k = 0; k < 7; ++k) s.push_back({{10, 4 + 0.3f * k}, {12, 4 + 0.3f * k}});
        s.push_back({{10, 9}, {12, 9}});            // one more line far away: not a tread
        auto stairs = detectStairs(s);
        CHECK(stairs.size() == 1);
        CHECK(s.size() == building.size() + 1);    // treads gone, the odd line kept
        if (!stairs.empty()) CHECK(stairs[0].box.contains({11, 5}));
        auto none = building;
        CHECK(detectStairs(none).empty());           // plain walls are never a staircase
    }
    {
        // door leaf: wall A ends at the hinge, a 1 m gap, wall B carries on; the leaf sticks out 1 m
        std::vector<Segment> s = { {{0,5},{3,5}}, {{4,5},{10,5}}, {{3,5},{3,6}} };
        int removed = 0;
        auto out = removeDoorLeaves(s, 0.5f, 1.6f, &removed);
        CHECK(removed == 1 && out.size() == 2);
        // the same short line with something at its far end is a real wall stub, not a leaf
        s.push_back({{2,6},{5,6}});
        CHECK(removeDoorLeaves(s, 0.5f, 1.6f).size() == 4);
    }
    {
        // arc leftovers: short and slanted goes, long slanted (a real diagonal wall) and grid lines stay
        auto s = building;
        s.push_back({{5,5},{5.3f,5.4f}});           // 0.5 m, 53 degrees off the grid
        s.push_back({{6,6},{6.9f,6.1f}});           // 0.9 m, 6 degrees off: kept at the default 12...
        s.push_back({{10,1},{13,4}});               // 4.2 m diagonal wall
        int removed = 0;
        auto out = removeShortDiagonals(s, 1.f, 12.f, &removed);
        CHECK(removed == 1 && out.size() == building.size() + 2);
        CHECK(removeShortDiagonals(s, 1.f, 5.f).size() == building.size() + 1);   // ...removed at 5
    }

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_vector: all checks passed\n";
    return 0;
}
