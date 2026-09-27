// wf_image console test: integral image, adaptive threshold, homography, PNG round trip.
#include "wf_image/wf_image.hpp"
#include <iostream>

static int g_failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)

int main() {
    using namespace wf; using namespace wf::img;

    // integral image: rectangle sums
    Image8 g(8, 8, 10);
    g.at(3, 3) = 100;
    Integral I = integralImage(g);
    CHECK(I.rectSum(0, 0, 7, 7) == 63 * 10 + 100);
    CHECK(I.rectSum(3, 3, 3, 3) == 100);
    CHECK(I.rectSum(0, 0, 2, 2) == 90);

    // adaptive threshold: a dark line on a gradient background stays a line
    Image8 grad(64, 64);
    for (int y = 0; y < 64; ++y) for (int x = 0; x < 64; ++x) grad.at(x, y) = static_cast<uint8_t>(120 + x * 2);  // bright on the right
    for (int x = 4; x < 60; ++x) grad.at(x, 32) = static_cast<uint8_t>(grad.at(x, 32) - 60);                     // an ink line
    Image8 bin = adaptiveThreshold(grad, {15, 10});
    CHECK(bin.at(30, 32) == 0);
    CHECK(bin.at(30, 10) == 255);
    CHECK(countInk(bin) >= 50 && countInk(bin) <= 70);

    // homography: identity and a known translation
    std::array<Vec2, 4> sq = {Vec2{0,0}, Vec2{10,0}, Vec2{10,10}, Vec2{0,10}};
    std::array<Vec2, 4> moved = {Vec2{5,5}, Vec2{15,5}, Vec2{15,15}, Vec2{5,15}};
    auto h = solveHomography(sq, moved);
    CHECK(h.ok());
    if (h) {
        Vec2 p = applyHomography(*h, {2, 3});
        CHECK(std::abs(p.x - 7.f) < 1e-4f && std::abs(p.y - 8.f) < 1e-4f);
        auto inv = invertHomography(*h);
        CHECK(inv.ok());
        Vec2 q = applyHomography(*inv, p);
        CHECK(std::abs(q.x - 2.f) < 1e-4f && std::abs(q.y - 3.f) < 1e-4f);
    }
    std::array<Vec2, 4> bad = {Vec2{0,0}, Vec2{1,1}, Vec2{2,2}, Vec2{3,3}};
    CHECK(!solveHomography(bad, sq).ok());

    // rectify: a skewed black quad on white becomes a full black square
    Image8 photo(100, 100, 255);
    std::array<Vec2, 4> quad = {Vec2{20,10}, Vec2{80,20}, Vec2{75,85}, Vec2{15,70}};
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
        CHECK(ink > 50 * 50 * 0.9);
        CHECK(rect->at(25, 25) == 0);
    }

    // PNG round trip through stb
    auto tmp = std::filesystem::temp_directory_path() / "wf_image_test.png";
    CHECK(savePng(bin, tmp).ok);
    auto back = load(tmp);
    CHECK(back.ok());
    if (back) { CHECK(back->width == 64 && back->height == 64); CHECK(countInk(*back) == countInk(bin)); }
    CHECK(!load("/nope/missing.png").ok());

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_image: all checks passed\n";
    return 0;
}
