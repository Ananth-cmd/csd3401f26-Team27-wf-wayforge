/*!
 * \file main.cpp (wf_image test)
 * \brief Console test for wf_image, run automatically by CTest and CI
 *
 * Builds small pictures in memory and checks each step gives the answer we
 * work out by hand: rectangle sums from the integral image, a dark line
 * surviving the adaptive threshold on an uneven background, a known
 * homography (and its inverse), straightening a tilted shape, and saving
 * then re-loading a PNG through stb, drawing lines / polygons, and tidying
 * a plan (an annotation outside the building, a letter inside a room).
 * Returns 0 if everything passed, so
 * CTest marks the test green; any failure prints the line and returns 1.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Hand-checkable cases for every public function in wf_image
 *   - Blueprint tidy-up and debug drawing checks (Tidy.cpp, Draw.cpp)
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-16
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// wf_image console test: integral image, adaptive threshold, homography, PNG round trip.
#include "wf_image/wf_image.hpp"   // Everything being tested.
#include <iostream>                // Printing pass/fail messages.

static int g_failures = 0;   // How many checks failed; non-zero means the test fails.
// CHECK prints the file, line and the condition that was false, then keeps going so we see every failure at once.
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)

int main() {
    using namespace wf; using namespace wf::img;

    // integral image: rectangle sums
    Image8 g(8, 8, 10);       // 8x8 image, every pixel = 10...
    g.at(3, 3) = 100;         // ...except one pixel = 100.
    Integral I = integralImage(g);
    CHECK(I.rectSum(0, 0, 7, 7) == 63 * 10 + 100);   // Whole image: 63 pixels of 10, plus the 100.
    CHECK(I.rectSum(3, 3, 3, 3) == 100);             // Just the special pixel.
    CHECK(I.rectSum(0, 0, 2, 2) == 90);              // 3x3 corner = 9 pixels of 10.

    // adaptive threshold: a dark line on a gradient background stays a line
    Image8 grad(64, 64);
    for (int y = 0; y < 64; ++y) for (int x = 0; x < 64; ++x) grad.at(x, y) = static_cast<uint8_t>(120 + x * 2);  // bright on the right
    for (int x = 4; x < 60; ++x) grad.at(x, 32) = static_cast<uint8_t>(grad.at(x, 32) - 60);                     // an ink line
    Image8 bin = adaptiveThreshold(grad, { 15, 10 });
    CHECK(bin.at(30, 32) == 0);                               // On the line: ink.
    CHECK(bin.at(30, 10) == 255);                             // Away from the line: paper, even though the background changes.
    CHECK(countInk(bin) >= 50 && countInk(bin) <= 70);        // Roughly the 56 line pixels and nothing else.

    // homography: identity and a known translation
    std::array<Vec2, 4> sq = { Vec2{0,0}, Vec2{10,0}, Vec2{10,10}, Vec2{0,10} };
    std::array<Vec2, 4> moved = { Vec2{5,5}, Vec2{15,5}, Vec2{15,15}, Vec2{5,15} };   // Same square moved by (5, 5).
    auto h = solveHomography(sq, moved);
    CHECK(h.ok());
    if (h) {
        Vec2 p = applyHomography(*h, { 2, 3 });
        CHECK(std::abs(p.x - 7.f) < 1e-4f && std::abs(p.y - 8.f) < 1e-4f);   // (2, 3) + (5, 5) = (7, 8).
        auto inv = invertHomography(*h);
        CHECK(inv.ok());
        Vec2 q = applyHomography(*inv, p);
        CHECK(std::abs(q.x - 2.f) < 1e-4f && std::abs(q.y - 3.f) < 1e-4f);   // And back again.
    }
    std::array<Vec2, 4> bad = { Vec2{0,0}, Vec2{1,1}, Vec2{2,2}, Vec2{3,3} };   // All on one line: not a real shape.
    CHECK(!solveHomography(bad, sq).ok());                                         // Must fail cleanly, not crash.

    // rectify: a skewed black quad on white becomes a full black square
    Image8 photo(100, 100, 255);
    std::array<Vec2, 4> quad = { Vec2{20,10}, Vec2{80,20}, Vec2{75,85}, Vec2{15,70} };
    // Paint the tilted shape black (point-in-polygon test on every pixel centre).
    for (int y = 0; y < 100; ++y) for (int x = 0; x < 100; ++x) {
        std::vector<Vec2> poly(quad.begin(), quad.end());
        bool in = false;
        for (size_t i = 0, j = 3; i < 4; j = i++)
            if ((poly[i].y > y + 0.5f) != (poly[j].y > y + 0.5f) &&
                x + 0.5f < (poly[j].x - poly[i].x) * (y + 0.5f - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x) in = !in;
        if (in) photo.at(x, y) = 0;
    }
    auto rect = rectify(photo, quad, 50, 50);
    CHECK(rect.ok());
    if (rect) {
        size_t ink = countInk(*rect);
        CHECK(ink > 50 * 50 * 0.9);      // Straightened, the shape should fill (almost) the whole output.
        CHECK(rect->at(25, 25) == 0);    // The centre is definitely black.
    }

    // PNG round trip through stb
    auto tmp = std::filesystem::temp_directory_path() / "wf_image_test.png";
    CHECK(savePng(bin, tmp).ok);
    auto back = load(tmp);
    CHECK(back.ok());
    if (back) { CHECK(back->width == 64 && back->height == 64); CHECK(countInk(*back) == countInk(bin)); }   // Same size, same ink.
    CHECK(!load("/nope/missing.png").ok());   // A missing file gives an error, not a crash.

    // drawing (debug pictures) and tidying (real blueprints)
    {
        Image8 plan(200, 100, 255);                                  // white paper
        drawLine(plan, {20, 20}, {180, 20}, 0, 3);                   // a "building": 3 px walls, all joined
        drawLine(plan, {180, 20}, {180, 80}, 0, 3);
        drawLine(plan, {180, 80}, {20, 80}, 0, 3);
        drawLine(plan, {20, 80}, {20, 20}, 0, 3);
        CHECK(plan.at(100, 20) == 0 && plan.at(100, 21) == 0 && plan.at(100, 50) == 255);
        fillPolygon(plan, { {60, 40}, {66, 40}, {66, 46}, {60, 46} }, 0);   // a 6 px "letter" inside a room
        CHECK(plan.at(63, 43) == 0);
        drawLine(plan, {5, 95}, {15, 95}, 0, 2);                     // an annotation outside the building box
        const size_t inkBefore = countInk(plan);

        int removed = -1;
        Image8 kept = keepMainDrawing(plan, &removed);
        CHECK(removed == 1);                                         // only the annotation goes
        CHECK(kept.at(10, 95) == 255 && kept.at(63, 43) == 0);       // the letter is inside the box: kept here
        Image8 tidy = removeSmallBlobs(kept, 10, &removed);
        CHECK(removed == 1);                                         // the letter goes
        CHECK(tidy.at(63, 43) == 255);
        CHECK(tidy.at(100, 20) == 0);                                // the walls stay (bigger than 10 px)
        CHECK(countInk(tidy) < inkBefore && countInk(tidy) > 400);
    }

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_image: all checks passed\n";
    return 0;
}
