// wf_vector console test: SVG import, thinning, tracing, DP, clean-up, planar faces.
#include "wf_vector/wf_vector.hpp"
#include <iostream>

static int g_failures = 0;
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
    CHECK(!importSvgText("<html/>").ok());
    CHECK(!importSvgText("<svg>").ok());
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
        CHECK(std::abs(total - 20000.f) < 1.f);
    }

    //pure face finding on a 2x1 grid of squares drawn as 7 segments
    std::vector<Segment> grid = {
        {{0,0},{2,0}}, {{0,1},{2,1}}, {{0,0},{0,1}}, {{1,0},{1,1}}, {{2,0},{2,1}},
        {{3,3},{4,4}}   // a dangling stroke that must not create a face
    };
    PlanarGraph pg = buildPlanarGraph(grid, 0.01f);
    CHECK(pg.edgeCount() == 8);                          // the two long lines are split at x=1, plus the stray
    auto faces = findFaces(pg);
    CHECK(faces.size() == 2);
    for (auto& f : faces) CHECK(std::abs(f.area - 1.f) < 1e-4f);
    PlanarGraph pruned = pruneDanglingEdges(pg);
    CHECK(pruned.edgeCount() == 7);

    //merge / snap / straighten
    std::vector<Segment> noisy = { {{0,0},{4.95f,0.02f}}, {{5.05f,-0.01f},{10,0}}, {{10.03f,0.02f},{10,5}} };
    auto merged = mergeCollinear(noisy, 3.f, 0.15f);
    CHECK(merged.size() == 2);
    auto snapped = snapEndpoints(merged, 0.1f);
    CHECK(snapped.size() == 2 && snapped[0].b == snapped[1].a);
    float axis = dominantAngle(snapped);
    CHECK(std::abs(radToDeg(axis)) < 1.f || std::abs(radToDeg(axis) - 90.f) < 1.f);
    auto straight = straighten(snapped, 0.f, 8.f);
    CHECK(std::abs(straight[0].a.y - straight[0].b.y) < 1e-4f);
    CHECK(std::abs(straight[1].a.x - straight[1].b.x) < 1e-4f);

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
    CHECK(inkAfter < inkBefore / 2);
    CHECK(inkAfter >= 100 && inkAfter <= 200);                          // roughly the perimeter ~ 2*(46+26)
    auto runs = traceSkeleton(sk);
    CHECK(!runs.empty());
    size_t tracedPixels = 0; for (auto& r : runs) tracedPixels += r.size();
    CHECK(tracedPixels >= inkAfter * 0.9);
    auto fitted = fitPolylines(runs, 1.5f, 2.f);
    CHECK(fitted.size() >= 4 && fitted.size() <= 8);
    auto cleaned = clean(fitted, { 3.f, 2.f, 2.f, 5.f, true, 8.f, 2.f });
    PlanarGraph rg = buildPlanarGraph(cleaned, 2.f);
    auto rfaces = findFaces(rg);
    CHECK(rfaces.size() == 1);
    if (!rfaces.empty()) CHECK(rfaces[0].area > 40 * 20 && rfaces[0].area < 50 * 30);

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_vector: all checks passed\n";
    return 0;
}
