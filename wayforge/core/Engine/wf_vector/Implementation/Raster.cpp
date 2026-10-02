/*!
 * \file Raster.cpp
 * \brief From thick ink pixels to straight line segments
 *
 * The "raster path" of wf_vector, in three steps:
 *   1. thin()          - shave thick wall strokes down to 1-pixel-wide lines (Zhang-Suen)
 *   2. traceSkeleton() - follow those thin lines pixel by pixel into chains,
 *                        cutting the chain wherever three or more lines meet
 *   3. fitPolylines()  - replace each wobbly chain with a few straight segments
 *                        (Douglas-Peucker keeps only the points that matter)
 * The segments are still in pixels; Clean.cpp scales them to metres next.
 *
 * Links: wf_api::wf_convert_image -> img::adaptiveThreshold -> thin ->
 *        traceSkeleton -> fitPolylines -> vec::scale / vec::clean (Clean.cpp).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu), Kervin Ong
 *
 * Contribution: Ananthan Elangovan 50%, Kervin Ong 50%
 *   - Zhang-Suen thinning
 *   - Skeleton tracing that splits at junctions and handles closed loops
 *   - Douglas-Peucker simplification and segment fitting
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-28
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_vector/wf_vector.hpp"   // Image8 in, Polyline / Segment out.
#include <algorithm>
#include <array>                     // The 8 neighbours of a pixel.

namespace wf::vec {

    // Zhang-Suen thinning
    // two sub-iteration algorithm. Works on a 0/1 grid where 1 = ink.
    img::Image8 thin(const img::Image8& binary) {
        const int W = binary.width, H = binary.height;
        // Copy the picture into a simple grid: 1 = ink (dark pixel), 0 = paper.
        std::vector<uint8_t> g(static_cast<size_t>(W) * H, 0);
        for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) g[static_cast<size_t>(y) * W + x] = binary.at(x, y) < 128 ? 1 : 0;
        // P(x, y) reads the grid; anything outside the picture counts as paper.
        auto P = [&](int x, int y) -> uint8_t { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : g[static_cast<size_t>(y) * W + x]; };

        std::vector<size_t> toClear;
        bool changed = true;
        // Peel off the outer layer of ink again and again until nothing more can be removed.
        while (changed) {
            changed = false;
            // Two half-steps per round (one peels from the bottom-right, one from the top-left) so the line stays centred.
            for (int step = 0; step < 2; ++step) {
                toClear.clear();
                for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
                    if (!P(x, y)) continue;
                    // neighbours P2..P9 clockwise starting at north
                    const uint8_t p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1);
                    const uint8_t p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
                    const int B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;   // How many ink neighbours.
                    if (B < 2 || B > 6) continue;   // An end of a line (keep it) or deep inside the stroke (not the edge yet).
                    // A = how many times we go paper -> ink walking round the neighbours. 1 means removing this pixel won't break the line in two.
                    const std::array<uint8_t, 9> seq = { p2, p3, p4, p5, p6, p7, p8, p9, p2 };
                    int A = 0;
                    for (int k = 0; k < 8; ++k) if (seq[static_cast<size_t>(k)] == 0 && seq[static_cast<size_t>(k + 1)] == 1) ++A;
                    if (A != 1) continue;
                    const bool cond = step == 0 ? (p2 * p4 * p6 == 0 && p4 * p6 * p8 == 0)
                        : (p2 * p4 * p8 == 0 && p2 * p6 * p8 == 0);
                    if (cond) toClear.push_back(static_cast<size_t>(y) * W + x);   // Mark it; don't clear yet or we'd affect our own checks.
                }
                if (!toClear.empty()) changed = true;
                for (size_t i : toClear) g[i] = 0;   // Now remove everything marked in this half-step.
            }
        }
        // Back to a normal image: 0 = ink, 255 = paper.
        img::Image8 out(W, H, 255);
        for (size_t i = 0; i < g.size(); ++i) if (g[i]) out.pixels[i] = 0;
        return out;
    }

    // skeleton tracing
    namespace {
        constexpr int dx8[8] = { 1, 0, -1, 0, 1, -1, -1, 1 };   // 4-neighbours first, then diagonals
        constexpr int dy8[8] = { 0, 1, 0, -1, 1, 1, -1, -1 };
    }

    std::vector<Polyline> traceSkeleton(const img::Image8& skel) {
        const int W = skel.width, H = skel.height;
        auto ink = [&](int x, int y) { return skel.inside(x, y) && skel.at(x, y) < 128; };
        // Count the ink neighbours of every ink pixel: 1 = end of a line, 2 = middle, 3+ = where lines meet.
        std::vector<uint8_t> nb(static_cast<size_t>(W) * H, 0);          // neighbour count
        for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
            if (!ink(x, y)) continue;
            int n = 0; for (int k = 0; k < 8; ++k) if (ink(x + dx8[k], y + dy8[k])) ++n;
            nb[static_cast<size_t>(y) * W + x] = static_cast<uint8_t>(n);
        }
        auto isJunction = [&](int x, int y) { return nb[static_cast<size_t>(y) * W + x] >= 3; };
        std::vector<uint8_t> visited(static_cast<size_t>(W) * H, 0);   // Pixels already part of a chain.
        auto vis = [&](int x, int y) -> uint8_t& { return visited[static_cast<size_t>(y) * W + x]; };

        std::vector<Polyline> runs;
        // Follow the line from (sx, sy), first stepping to (nx, ny), until it ends, hits a junction, or loops back.
        auto walkFrom = [&](int sx, int sy, int nx, int ny) {
            Polyline run;
            run.push_back({ static_cast<float>(sx), static_cast<float>(sy) });
            int px = sx, py = sy, cx = nx, cy = ny;   // Previous and current pixel.
            for (int guard = 0; guard < W * H; ++guard) {
                run.push_back({ static_cast<float>(cx), static_cast<float>(cy) });
                if (isJunction(cx, cy)) break;                          // stop at junctions
                vis(cx, cy) = 1;
                // Pick the next ink pixel: not the one we came from, and not one already used.
                int bx = -1, by = -1;
                for (int k = 0; k < 8; ++k) {
                    const int tx = cx + dx8[k], ty = cy + dy8[k];
                    if (!ink(tx, ty) || (tx == px && ty == py)) continue;
                    if (vis(tx, ty) && !isJunction(tx, ty)) continue;
                    //avoids zig-zag doubles
                    bx = tx; by = ty; break;
                }
                if (bx < 0) break;   // endpoint
                if (bx == sx && by == sy) { run.push_back({ static_cast<float>(sx), static_cast<float>(sy) }); break; }   // closed loop
                px = cx; py = cy; cx = bx; cy = by;   // Step forward.
            }
            if (run.size() >= 2) runs.push_back(std::move(run));
            };

        // runs that start at endpoints or junctions
        for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
            if (!ink(x, y)) continue;
            const int n = nb[static_cast<size_t>(y) * W + x];
            if (n == 1 || n >= 3) {
                // Start one chain in every direction that leaves this end/junction.
                for (int k = 0; k < 8; ++k) {
                    const int tx = x + dx8[k], ty = y + dy8[k];
                    if (!ink(tx, ty)) continue;
                    if (isJunction(tx, ty)) {
                        // Two junction pixels side by side: link them with a tiny 2-point chain (only once, from the lower index).
                        if (isJunction(x, y) && (y * W + x) < (ty * W + tx)) { runs.push_back({ {static_cast<float>(x), static_cast<float>(y)}, {static_cast<float>(tx), static_cast<float>(ty)} }); }
                        else if (!isJunction(x, y)) { walkFrom(x, y, tx, ty); }
                        continue;
                    }
                    if (vis(tx, ty)) continue;   // Already traced from the other end.
                    walkFrom(x, y, tx, ty);
                }
                if (n == 1) vis(x, y) = 1;
            }
        }
        // closed loops with no endpoint or junction at all
        // (e.g. a room drawn as one closed outline with nothing touching it)
        for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
            if (!ink(x, y) || vis(x, y) || isJunction(x, y)) continue;
            for (int k = 0; k < 8; ++k) {
                const int tx = x + dx8[k], ty = y + dy8[k];
                if (ink(tx, ty) && !vis(tx, ty)) { vis(x, y) = 1; walkFrom(x, y, tx, ty); break; }
            }
        }
        return runs;
    }

    // Douglas-Peucker
    // Keep the point furthest from the straight line between i0 and i1 if it's further than tol,
    // then do the same on both halves. Points that are close to a straight line get dropped.
    static void dpRecurse(const Polyline& pts, size_t i0, size_t i1, float tol, std::vector<uint8_t>& keep) {
        if (i1 <= i0 + 1) return;   // No points in between.
        float best = -1.f; size_t bi = i0;
        for (size_t i = i0 + 1; i < i1; ++i) {
            const float d = distancePointToSegment(pts[i], pts[i0], pts[i1]);
            if (d > best) { best = d; bi = i; }
        }
        if (best > tol) {
            keep[bi] = 1;   // A real bend: keep it as a corner.
            dpRecurse(pts, i0, bi, tol, keep);
            dpRecurse(pts, bi, i1, tol, keep);
        }
    }

    Polyline douglasPeucker(const Polyline& pts, float tolerance) {
        if (pts.size() < 3) return pts;
        std::vector<uint8_t> keep(pts.size(), 0);
        keep.front() = keep.back() = 1;   // The two ends are always kept.
        // the chord is degenerate, so pin the point furthest from the start first.
        // (a closed loop starts and ends on the same pixel, so "the line from start to end" has no length)
        if (distance(pts.front(), pts.back()) < 1e-3f) {
            size_t far = 0; float best = -1.f;
            for (size_t i = 0; i < pts.size(); ++i) { const float d = distanceSq(pts[i], pts.front()); if (d > best) { best = d; far = i; } }
            keep[far] = 1;
            dpRecurse(pts, 0, far, tolerance, keep);
            dpRecurse(pts, far, pts.size() - 1, tolerance, keep);
        }
        else {
            dpRecurse(pts, 0, pts.size() - 1, tolerance, keep);
        }
        Polyline out;
        for (size_t i = 0; i < pts.size(); ++i) if (keep[i]) out.push_back(pts[i]);
        return out;
    }

    std::vector<Segment> fitPolylines(const std::vector<Polyline>& runs, float tolerance, float minLength) {
        std::vector<Segment> out;
        for (const auto& run : runs) {
            const Polyline simp = douglasPeucker(run, tolerance);   // Wobbly chain -> just its corners.
            // Each pair of neighbouring corners becomes one straight segment.
            for (size_t i = 0; i + 1 < simp.size(); ++i) {
                Segment s; s.a = simp[i]; s.b = simp[i + 1];
                if (s.length() >= minLength) out.push_back(s);   // Skip tiny bits (specks, text).
            }
        }
        return out;
    }

} // namespace wf::vec
