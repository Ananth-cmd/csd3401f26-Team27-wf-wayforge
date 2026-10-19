/*!
 * \file RasterRooms.cpp
 * \brief Rooms from the cleaned plan image (enclosed paper regions)
 *
 * Rooms are the paper regions enclosed by ink (walls, door leaves, door
 * arcs) in the cleaned plan image:
 *   1. stair and lift symbol boxes are erased
 *   2. ink is dilated by closeGap / 2 to seal small breaks
 *   3. paper regions are labelled (4-connected); border-touching regions are
 *      outside, regions outside [minArea, maxArea] are dropped. Groups of 3+
 *      small regions filling a near-square box (lift with an X) become one
 *      lift room
 *   4. kept regions are grown over the dilated band to the wall centres
 *   5. outlines are traced along pixel edges and simplified; holes of at
 *      least minArea (a core inside a ring corridor) are joined to the outline
 *      by a zero-width cut so the polygon leaves them out; the room point is
 *      the pixel furthest from the outline
 *
 * Links: called by convertImage (Convert.cpp) with the tidied ink image;
 * replaces the rooms from wf_read::interpret for image input.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Region labelling with gap sealing, growth to wall centres, edge tracing
 *   - Holes cut into the outline (ring corridors around a core)
 *   - Lift detection from regions split by an X
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-19
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_read/Convert.hpp"
#include <algorithm>
#include <cmath>
#include <deque>

namespace wf::read {
namespace {

    // Square dilation of a 0/1 mask by r pixels (separable, prefix sums).
    std::vector<uint8_t> dilate(const std::vector<uint8_t>& m, int w, int h, int r) {
        std::vector<uint8_t> tmp(m.size(), 0), out(m.size(), 0);
        std::vector<int> pre(static_cast<size_t>(std::max(w, h)) + 1);
        for (int y = 0; y < h; ++y) {
            pre[0] = 0;
            for (int x = 0; x < w; ++x) pre[x + 1] = pre[x] + m[static_cast<size_t>(y) * w + x];
            for (int x = 0; x < w; ++x)
                tmp[static_cast<size_t>(y) * w + x] = pre[std::min(w, x + r + 1)] - pre[std::max(0, x - r)] > 0;
        }
        for (int x = 0; x < w; ++x) {
            pre[0] = 0;
            for (int y = 0; y < h; ++y) pre[y + 1] = pre[y] + tmp[static_cast<size_t>(y) * w + x];
            for (int y = 0; y < h; ++y)
                out[static_cast<size_t>(y) * w + x] = pre[std::min(h, y + r + 1)] - pre[std::max(0, y - r)] > 0;
        }
        return out;
    }

    constexpr int DX[4] = { 1, 0, -1, 0 };
    constexpr int DY[4] = { 0, 1, 0, -1 };

    // Outer outline of region `id`, as pixel-corner points (x right, y down). Starts at the
    // top-left corner of the region's first pixel in raster order and keeps the region on the right.
    std::vector<Vec2> traceOutline(const std::vector<int>& label, int w, int h, int id, int startPixel) {
        auto in = [&](int x, int y) { return x >= 0 && y >= 0 && x < w && y < h && label[static_cast<size_t>(y) * w + x] == id; };
        const int sx = startPixel % w, sy = startPixel / w;
        int cx = sx, cy = sy, dir = 0;                                    // 0 E, 1 S, 2 W, 3 N
        std::vector<Vec2> pts;
        const size_t guard = static_cast<size_t>(w + h) * 8 + 1000000;
        for (size_t step = 0; step < guard; ++step) {
            // Pixels ahead on the left / right of the current heading.
            int lx, ly, rx, ry;
            switch (dir) {
                case 0:  rx = cx;     ry = cy;     lx = cx;     ly = cy - 1; break;
                case 1:  rx = cx - 1; ry = cy;     lx = cx;     ly = cy;     break;
                case 2:  rx = cx - 1; ry = cy - 1; lx = cx - 1; ly = cy;     break;
                default: rx = cx;     ry = cy - 1; lx = cx - 1; ly = cy - 1; break;
            }
            int nd = dir;
            if (in(lx, ly)) nd = (dir + 3) % 4;                           // turn left
            else if (!in(rx, ry)) nd = (dir + 1) % 4;                     // turn right
            if (nd != dir || pts.empty()) pts.push_back({ static_cast<float>(cx), static_cast<float>(cy) });
            dir = nd;
            cx += DX[dir]; cy += DY[dir];
            if (cx == sx && cy == sy && dir == 3) break;                  // outline closed
        }
        return pts;
    }

    // Outlines of the holes in region `id` of at least minPx pixels (areas enclosed by the region,
    // such as a service core inside a ring corridor), traced like traceOutline().
    std::vector<std::vector<Vec2>> traceHoles(const std::vector<int>& label, int w, int h, int id,
                                              int x0, int y0, int x1, int y1, size_t minPx) {
        std::vector<std::vector<Vec2>> holes;
        x0 = std::max(0, x0 - 1); y0 = std::max(0, y0 - 1); x1 = std::min(w - 1, x1 + 1); y1 = std::min(h - 1, y1 + 1);
        const int bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        // 0 = region, 1 = other (not yet reached), 2 = reached from the box edge, 3+ = hole number
        std::vector<int> m(static_cast<size_t>(bw) * bh);
        for (int y = 0; y < bh; ++y)
            for (int x = 0; x < bw; ++x)
                m[static_cast<size_t>(y) * bw + x] = label[static_cast<size_t>(y + y0) * w + x + x0] == id ? 0 : 1;
        std::vector<int> stack;
        auto fill = [&](int s, int value) {
            size_t count = 0;
            m[static_cast<size_t>(s)] = value; stack.push_back(s);
            while (!stack.empty()) {
                const int i = stack.back(); stack.pop_back();
                ++count;
                const int x = i % bw, y = i / bw;
                for (int k = 0; k < 4; ++k) {
                    const int nx = x + DX[k], ny = y + DY[k];
                    if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
                    const int j = ny * bw + nx;
                    if (m[static_cast<size_t>(j)] != 1) continue;
                    m[static_cast<size_t>(j)] = value; stack.push_back(j);
                }
            }
            return count;
        };
        for (int x = 0; x < bw; ++x) {
            if (m[static_cast<size_t>(x)] == 1) fill(x, 2);
            if (m[static_cast<size_t>(bh - 1) * bw + x] == 1) fill((bh - 1) * bw + x, 2);
        }
        for (int y = 0; y < bh; ++y) {
            if (m[static_cast<size_t>(y) * bw] == 1) fill(y * bw, 2);
            if (m[static_cast<size_t>(y) * bw + bw - 1] == 1) fill(y * bw + bw - 1, 2);
        }
        int next = 3;
        for (int s = 0; s < bw * bh; ++s) {
            if (m[static_cast<size_t>(s)] != 1) continue;
            const int hole = next++;
            if (fill(s, hole) < minPx) continue;
            auto pts = traceOutline(m, bw, bh, hole, s);
            for (Vec2& q : pts) { q.x += static_cast<float>(x0); q.y += static_cast<float>(y0); }
            if (pts.size() >= 3) holes.push_back(std::move(pts));
        }
        return holes;
    }

    // Joins a hole into an outline with a zero-width cut between their closest corners. Both are
    // given with the same winding.
    void spliceHole(std::vector<Vec2>& outline, std::vector<Vec2> hole) {
        std::reverse(hole.begin(), hole.end());
        size_t bi = 0, bj = 0;
        float best = 1e30f;
        for (size_t i = 0; i < outline.size(); ++i)
            for (size_t j = 0; j < hole.size(); ++j) {
                const float d = distance(outline[i], hole[j]);
                if (d < best) { best = d; bi = i; bj = j; }
            }
        std::vector<Vec2> out(outline.begin(), outline.begin() + static_cast<std::ptrdiff_t>(bi) + 1);
        for (size_t k = 0; k <= hole.size(); ++k) out.push_back(hole[(bj + k) % hole.size()]);
        out.insert(out.end(), outline.begin() + static_cast<std::ptrdiff_t>(bi), outline.end());
        outline = std::move(out);
    }

    float signedArea(const std::vector<Vec2>& p) {
        float s = 0.f;
        for (size_t i = 0; i < p.size(); ++i) s += cross(p[i], p[(i + 1) % p.size()]);
        return s * 0.5f;
    }

    float perimeter(const std::vector<Vec2>& p) {
        float s = 0.f;
        for (size_t i = 0; i < p.size(); ++i) s += distance(p[i], p[(i + 1) % p.size()]);
        return s;
    }

} // namespace

std::vector<Room> roomsFromInk(const img::Image8& ink, float mpp, const std::vector<Rect>& clearPixels,
                               IdGenerator& ids, const RasterRoomParams& p) {
    const int w = ink.width, h = ink.height;
    std::vector<Room> rooms;
    if (w < 3 || h < 3 || mpp <= 0.f) return rooms;
    const size_t n = static_cast<size_t>(w) * h;

    // 1. ink mask, symbol areas cleared
    std::vector<uint8_t> wall(n);
    for (size_t i = 0; i < n; ++i) wall[i] = ink.pixels[i] < 128;
    for (const Rect& r : clearPixels) {
        const int x0 = std::max(0, static_cast<int>(r.min.x) + 1), x1 = std::min(w - 1, static_cast<int>(r.max.x) - 1);
        const int y0 = std::max(0, static_cast<int>(r.min.y) + 1), y1 = std::min(h - 1, static_cast<int>(r.max.y) - 1);
        for (int y = y0; y <= y1; ++y) for (int x = x0; x <= x1; ++x) wall[static_cast<size_t>(y) * w + x] = 0;
    }

    // 2. seal small breaks
    const int r = std::max(1, static_cast<int>(std::lround(p.closeGap * 0.5f / mpp)));
    const std::vector<uint8_t> blocked = dilate(wall, w, h, r);

    // 3. label paper regions
    std::vector<int> label(n, -1);
    std::vector<size_t> areaPx;
    std::vector<uint8_t> touchesBorder;
    std::vector<int> firstPixel;
    std::vector<int> bx0, by0, bx1, by1;                                  // region bounding boxes (pixels)
    std::vector<int> stack;
    for (size_t s = 0; s < n; ++s) {
        if (blocked[s] || label[s] >= 0) continue;
        const int id = static_cast<int>(areaPx.size());
        areaPx.push_back(0); touchesBorder.push_back(0); firstPixel.push_back(static_cast<int>(s));
        bx0.push_back(w); by0.push_back(h); bx1.push_back(-1); by1.push_back(-1);
        label[s] = id; stack.push_back(static_cast<int>(s));
        while (!stack.empty()) {
            const int i = stack.back(); stack.pop_back();
            ++areaPx[id];
            const int x = i % w, y = i / w;
            bx0[id] = std::min(bx0[id], x); bx1[id] = std::max(bx1[id], x);
            by0[id] = std::min(by0[id], y); by1[id] = std::max(by1[id], y);
            if (x == 0 || y == 0 || x == w - 1 || y == h - 1) touchesBorder[id] = 1;
            for (int k = 0; k < 4; ++k) {
                const int nx = x + DX[k], ny = y + DY[k];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const size_t j = static_cast<size_t>(ny) * w + nx;
                if (blocked[j] || label[j] >= 0) continue;
                label[j] = id; stack.push_back(static_cast<int>(j));
            }
        }
    }
    const float pxArea = mpp * mpp;
    std::vector<uint8_t> keep(areaPx.size(), 0), isLift(areaPx.size(), 0);
    for (size_t id = 0; id < areaPx.size(); ++id) {
        const float a = static_cast<float>(areaPx[id]) * pxArea;
        keep[id] = !touchesBorder[id] && a >= p.minArea && a <= p.maxArea;
    }

    // Lifts: group small inner regions with touching boxes; a group of 3+ filling a near-square
    // box of liftMinSide..liftMaxSide becomes one lift room.
    {
        std::vector<size_t> small;
        for (size_t id = 0; id < areaPx.size(); ++id)
            if (!touchesBorder[id] && !keep[id] && static_cast<float>(areaPx[id]) * pxArea >= 0.05f) small.push_back(id);
        std::vector<size_t> parent(small.size());
        for (size_t i = 0; i < parent.size(); ++i) parent[i] = i;
        auto root = [&](size_t i) { while (parent[i] != i) i = parent[i] = parent[parent[i]]; return i; };
        const int touch = 2 * r + 2;                                      // max gap between boxes (dilated line)
        for (size_t i = 0; i < small.size(); ++i)
            for (size_t j = i + 1; j < small.size(); ++j) {
                const size_t a = small[i], b = small[j];
                if (bx0[a] - touch <= bx1[b] && bx0[b] - touch <= bx1[a] && by0[a] - touch <= by1[b] && by0[b] - touch <= by1[a])
                    parent[root(i)] = root(j);
            }
        std::vector<std::vector<size_t>> groups(small.size());
        for (size_t i = 0; i < small.size(); ++i) groups[root(i)].push_back(small[i]);
        for (const auto& g : groups) {
            if (g.size() < 3) continue;
            int x0 = w, y0 = h, x1 = -1, y1 = -1;
            size_t px = 0;
            for (size_t id : g) { x0 = std::min(x0, bx0[id]); y0 = std::min(y0, by0[id]); x1 = std::max(x1, bx1[id]); y1 = std::max(y1, by1[id]); px += areaPx[id]; }
            // Add back the r pixels the dilation removed on each side.
            const float sw = static_cast<float>(x1 - x0 + 1 + 2 * r) * mpp, sh = static_cast<float>(y1 - y0 + 1 + 2 * r) * mpp;
            const float lo = std::min(sw, sh), hi = std::max(sw, sh);
            if (lo < p.liftMinSide || hi > p.liftMaxSide || hi > lo * 1.6f) continue;
            if (static_cast<float>(px) * pxArea < 0.15f * sw * sh) continue;  // minimum paper fraction
            const int keepId = static_cast<int>(g[0]);
            for (size_t id : g) {
                if (static_cast<int>(id) == keepId) continue;
                for (int y = by0[id]; y <= by1[id]; ++y)
                    for (int x = bx0[id]; x <= bx1[id]; ++x) {
                        int& l = label[static_cast<size_t>(y) * w + x];
                        if (l == static_cast<int>(id)) l = keepId;
                    }
                areaPx[keepId] += areaPx[id]; areaPx[id] = 0;
            }
            keep[keepId] = 1; isLift[keepId] = 1;
        }
    }
    for (size_t i = 0; i < n; ++i) if (label[i] >= 0 && !keep[label[i]]) label[i] = touchesBorder[label[i]] ? -2 : -1;   // -2 = outside

    // 4. grow kept regions over the dilated band and the walls, up to the wall centre
    const int reach = r + std::max(1, static_cast<int>(std::lround(p.wallHalf / mpp)));
    std::vector<int> dist(n, -1);
    std::deque<int> queue;
    for (size_t i = 0; i < n; ++i) if (label[i] >= 0) { dist[i] = 0; queue.push_back(static_cast<int>(i)); }
    while (!queue.empty()) {
        const int i = queue.front(); queue.pop_front();
        if (dist[i] >= reach) continue;
        const int x = i % w, y = i / w;
        for (int k = 0; k < 4; ++k) {
            const int nx = x + DX[k], ny = y + DY[k];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const size_t j = static_cast<size_t>(ny) * w + nx;
            if (label[j] != -1) continue;                                // already a room, or outside
            label[j] = label[i]; dist[j] = dist[i] + 1; queue.push_back(static_cast<int>(j));
        }
    }

    // 5. outlines and room points
    // Distance from each room pixel to the nearest pixel outside its room (for the room point).
    std::vector<int> inner(n, -1);
    for (size_t i = 0; i < n; ++i) {
        if (label[i] < 0) continue;
        const int x = static_cast<int>(i % w), y = static_cast<int>(i / w);
        for (int k = 0; k < 4; ++k) {
            const int nx = x + DX[k], ny = y + DY[k];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || label[static_cast<size_t>(ny) * w + nx] != label[i]) { inner[i] = 0; queue.push_back(static_cast<int>(i)); break; }
        }
    }
    while (!queue.empty()) {
        const int i = queue.front(); queue.pop_front();
        const int x = i % w, y = i / w;
        for (int k = 0; k < 4; ++k) {
            const int nx = x + DX[k], ny = y + DY[k];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const size_t j = static_cast<size_t>(ny) * w + nx;
            if (label[j] != label[i] || inner[j] >= 0) continue;
            inner[j] = inner[i] + 1; queue.push_back(static_cast<int>(j));
        }
    }
    std::vector<int> best(areaPx.size(), -1);
    for (size_t i = 0; i < n; ++i)
        if (label[i] >= 0 && (best[label[i]] < 0 || inner[i] > inner[best[label[i]]])) best[label[i]] = static_cast<int>(i);

    // Trace start: first pixel of each grown region in raster order.
    std::vector<int> start(areaPx.size(), -1);
    for (size_t i = 0; i < n; ++i) if (label[i] >= 0 && start[label[i]] < 0) start[label[i]] = static_cast<int>(i);

    const float H = static_cast<float>(h);
    auto toPlan = [&](Vec2 px) { return Vec2{ px.x * mpp, (H - px.y) * mpp }; };
    for (size_t id = 0; id < areaPx.size(); ++id) {
        if (!keep[id] || start[id] < 0) continue;
        auto outline = traceOutline(label, w, h, static_cast<int>(id), start[id]);
        if (outline.size() < 3) continue;
        outline.push_back(outline.front());
        const float tolerance = std::max(1.f, p.simplify / mpp);
        auto simple = vec::douglasPeucker(outline, tolerance);
        if (simple.size() > 1) simple.pop_back();
        if (simple.size() < 3) continue;
        // Holes of at least minArea (a core inside a ring corridor) are cut out of the outline.
        const size_t minHolePx = static_cast<size_t>(p.minArea / pxArea);
        int hx0 = w, hy0 = h, hx1 = -1, hy1 = -1;
        for (const Vec2& q : outline) {
            hx0 = std::min(hx0, static_cast<int>(q.x)); hy0 = std::min(hy0, static_cast<int>(q.y));
            hx1 = std::max(hx1, static_cast<int>(q.x)); hy1 = std::max(hy1, static_cast<int>(q.y));
        }
        for (auto& hole : traceHoles(label, w, h, static_cast<int>(id), hx0, hy0, hx1, hy1, minHolePx)) {
            hole.push_back(hole.front());
            auto hs = vec::douglasPeucker(hole, tolerance);
            if (hs.size() > 1) hs.pop_back();
            if (hs.size() >= 3) spliceHole(simple, std::move(hs));
        }

        Room room;
        room.id = ids.next("r");
        for (const Vec2& q : simple) room.polygon.push_back(toPlan(q));
        if (signedArea(room.polygon) < 0.f) std::reverse(room.polygon.begin(), room.polygon.end());   // anticlockwise, y up
        room.area = std::abs(signedArea(room.polygon));
        const int b = best[id];
        room.centroid = toPlan({ static_cast<float>(b % w) + 0.5f, static_cast<float>(b / w) + 0.5f });
        // Corridor: narrow for its length (mean width = 2 * area / perimeter).
        const float per = perimeter(room.polygon), width = per > 0.f ? 2.f * room.area / per : 0.f;
        room.kind = width > 0.f && width < p.corridorWidth && per * 0.5f > 5.f * width ? RoomKind::Corridor : RoomKind::Unknown;
        if (isLift[id]) room.kind = RoomKind::Lift;
        room.confidence = 0.8f;
        rooms.push_back(std::move(room));
    }
    return rooms;
}

} // namespace wf::read
