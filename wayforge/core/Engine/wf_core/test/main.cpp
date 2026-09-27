// wf_core console test app. Returns 0 on success, 1 on the first failure.
#include "wf_core/wf_core.hpp"
#include <iostream>
#include <cstdlib>

static int g_failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)
int main() {
    using namespace wf;
    std::cout << "wf_core test on " << platformName() << ", version " << kVersionString << "\n";

    // Math
    Vec2 a{ 3, 4 };
    CHECK(std::abs(length(a) - 5.f) < 1e-5f);
    CHECK(dot(Vec2{ 1, 0 }, Vec2{ 0, 1 }) == 0.f);
    CHECK(cross(Vec2{ 1, 0 }, Vec2{ 0, 1 }) == 1.f);
    CHECK(std::abs(distancePointToLine({ 0, 1 }, { 0, 0 }, { 1, 0 }) - 1.f) < 1e-5f);
    CHECK(std::abs(distancePointToSegment({ 5, 1 }, { 0, 0 }, { 1, 0 }) - std::sqrt(17.f)) < 1e-4f);
    CHECK(segmentsIntersect({ 0, 0 }, { 2, 2 }, { 0, 2 }, { 2, 0 }));
    CHECK(!segmentsIntersect({ 0, 0 }, { 1, 1 }, { 2, 2 }, { 3, 3 }));
    CHECK(std::abs(lineAngleDiff(0.f, kPi) - 0.f) < 1e-5f);
    CHECK(std::abs(lineAngleDiff(0.f, kPi * 0.5f) - kPi * 0.5f) < 1e-5f);

    // Log
    log::setLevel(log::Level::Debug);
    WF_LOG_DEBUG("debug message " << 42);

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_core: all checks passed\n";
    return 0;
}
