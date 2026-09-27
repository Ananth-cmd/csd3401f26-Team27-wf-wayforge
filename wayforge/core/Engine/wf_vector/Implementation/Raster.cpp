#include "wf_vector/wf_vector.hpp"
#include <algorithm>
#include <array>

namespace wf::vec {

// ---- Zhang-Suen thinning ---------------------------------------------------------
// Classic two sub-iteration algorithm. Works on a 0/1 grid where 1 = ink.
img::Image8 thin(const img::Image8& binary) {
    const int W = binary.width, H = binary.height;
    std::vector<uint8_t> g(static_cast<size_t>(W) * H, 0);
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) g[static_cast<size_t>(y) * W + x] = binary.at(x, y) < 128 ? 1 : 0;
    auto P = [&](int x, int y) -> uint8_t { return (x < 0 || y < 0 || x >= W || y >= H) ? 0 : g[static_cast<size_t>(y) * W + x]; };

    std::vector<size_t> toClear;
    bool changed = true;
    while (changed) {
        changed = false;
        for (int step = 0; step < 2; ++step) {
            toClear.clear();
            for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
                if (!P(x, y)) continue;
                // neighbours P2..P9 clockwise starting at north
                const uint8_t p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1);
                const uint8_t p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
                const int B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                if (B < 2 || B > 6) continue;
                const std::array<uint8_t, 9> seq = {p2, p3, p4, p5, p6, p7, p8, p9, p2};
                int A = 0;
                for (int k = 0; k < 8; ++k) if (seq[static_cast<size_t>(k)] == 0 && seq[static_cast<size_t>(k + 1)] == 1) ++A;
                if (A != 1) continue;
                const bool cond = step == 0 ? (p2 * p4 * p6 == 0 && p4 * p6 * p8 == 0)
                                            : (p2 * p4 * p8 == 0 && p2 * p6 * p8 == 0);
                if (cond) toClear.push_back(static_cast<size_t>(y) * W + x);
            }
            if (!toClear.empty()) changed = true;
            for (size_t i : toClear) g[i] = 0;
        }
    }
    img::Image8 out(W, H, 255);
    for (size_t i = 0; i < g.size(); ++i) if (g[i]) out.pixels[i] = 0;
    return out;
}

// ---- skeleton tracing --------------------------------------------------------------
namespace {
    constexpr int dx8[8] = { 1, 0, -1, 0, 1, -1, -1, 1 };   // 4-neighbours first, then diagonals
    constexpr int dy8[8] = { 0, 1, 0, -1, 1, 1, -1, -1 };
}

std::vector<Polyline> traceSkeleton(const img::Image8& skel) {
    const int W = skel.width, H = skel.height;
    auto ink = [&](int x, int y) { return skel.inside(x, y) && skel.at(x, y) < 128; };
    std::vector<uint8_t> nb(static_cast<size_t>(W) * H, 0);          // neighbour count
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        if (!ink(x, y)) continue;
        int n = 0; for (int k = 0; k < 8; ++k) if (ink(x + dx8[k], y + dy8[k])) ++n;
        nb[static_cast<size_t>(y) * W + x] = static_cast<uint8_t>(n);
    }
    auto isJunction = [&](int x, int y) { return nb[static_cast<size_t>(y) * W + x] >= 3; };
    std::vector<uint8_t> visited(static_cast<size_t>(W) * H, 0);
    auto vis = [&](int x, int y) -> uint8_t& { return visited[static_cast<size_t>(y) * W + x]; };

    std::vector<Polyline> runs;
    auto walkFrom = [&](int sx, int sy, int nx, int ny) {
        Polyline run;
        run.push_back({static_cast<float>(sx), static_cast<float>(sy)});
        int px = sx, py = sy, cx = nx, cy = ny;
        for (int guard = 0; guard < W * H; ++guard) {
            run.push_back({static_cast<float>(cx), static_cast<float>(cy)});
            if (isJunction(cx, cy)) break;                          // stop at junctions
            vis(cx, cy) = 1;
            int bx = -1, by = -1;
            for (int k = 0; k < 8; ++k) {
                const int tx = cx + dx8[k], ty = cy + dy8[k];
                if (!ink(tx, ty) || (tx == px && ty == py)) continue;
                if (vis(tx, ty) && !isJunction(tx, ty)) continue;
                // do not step onto a pixel that is also adjacent to the previous one via a
                // shorter (4-connected) route we already took - avoids zig-zag doubles
                bx = tx; by = ty; break;
            }
            if (bx < 0) break;                                       // endpoint
            if (bx == sx && by == sy) { run.push_back({static_cast<float>(sx), static_cast<float>(sy)}); break; }   // closed loop
            px = cx; py = cy; cx = bx; cy = by;
        }
        if (run.size() >= 2) runs.push_back(std::move(run));
    };

    // 1. runs that start at endpoints or junctions
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        if (!ink(x, y)) continue;
        const int n = nb[static_cast<size_t>(y) * W + x];
        if (n == 1 || n >= 3) {
            for (int k = 0; k < 8; ++k) {
                const int tx = x + dx8[k], ty = y + dy8[k];
                if (!ink(tx, ty)) continue;
                if (isJunction(tx, ty)) {
                    if (isJunction(x, y) && (y * W + x) < (ty * W + tx)) { runs.push_back({{static_cast<float>(x), static_cast<float>(y)}, {static_cast<float>(tx), static_cast<float>(ty)}}); }
                    else if (!isJunction(x, y)) { walkFrom(x, y, tx, ty); }
                    continue;
                }
                if (vis(tx, ty)) continue;
                walkFrom(x, y, tx, ty);
            }
            if (n == 1) vis(x, y) = 1;
        }
    }
    // 2. closed loops with no endpoint or junction at all
    for (int y = 0; y < H; ++y) for (int x = 0; x < W; ++x) {
        if (!ink(x, y) || vis(x, y) || isJunction(x, y)) continue;
        for (int k = 0; k < 8; ++k) {
            const int tx = x + dx8[k], ty = y + dy8[k];
            if (ink(tx, ty) && !vis(tx, ty)) { vis(x, y) = 1; walkFrom(x, y, tx, ty); break; }
        }
    }
    return runs;
}

// ---- Douglas-Peucker ---------------------------------------------------------------
static void dpRecurse(const Polyline& pts, size_t i0, size_t i1, float tol, std::vector<uint8_t>& keep) {
    if (i1 <= i0 + 1) return;
    float best = -1.f; size_t bi = i0;
    for (size_t i = i0 + 1; i < i1; ++i) {
        const float d = distancePointToSegment(pts[i], pts[i0], pts[i1]);
        if (d > best) { best = d; bi = i; }
    }
    if (best > tol) {
        keep[bi] = 1;
        dpRecurse(pts, i0, bi, tol, keep);
        dpRecurse(pts, bi, i1, tol, keep);
    }
}

Polyline douglasPeucker(const Polyline& pts, float tolerance) {
    if (pts.size() < 3) return pts;
    std::vector<uint8_t> keep(pts.size(), 0);
    keep.front() = keep.back() = 1;
    // Closed loops: the chord is degenerate, so pin the point furthest from the start first.
    if (distance(pts.front(), pts.back()) < 1e-3f) {
        size_t far = 0; float best = -1.f;
        for (size_t i = 0; i < pts.size(); ++i) { const float d = distanceSq(pts[i], pts.front()); if (d > best) { best = d; far = i; } }
        keep[far] = 1;
        dpRecurse(pts, 0, far, tolerance, keep);
        dpRecurse(pts, far, pts.size() - 1, tolerance, keep);
    } else {
        dpRecurse(pts, 0, pts.size() - 1, tolerance, keep);
    }
    Polyline out;
    for (size_t i = 0; i < pts.size(); ++i) if (keep[i]) out.push_back(pts[i]);
    return out;
}

std::vector<Segment> fitPolylines(const std::vector<Polyline>& runs, float tolerance, float minLength) {
    std::vector<Segment> out;
    for (const auto& run : runs) {
        const Polyline simp = douglasPeucker(run, tolerance);
        for (size_t i = 0; i + 1 < simp.size(); ++i) {
            Segment s; s.a = simp[i]; s.b = simp[i + 1];
            if (s.length() >= minLength) out.push_back(s);
        }
    }
    return out;
}

} // namespace wf::vec
