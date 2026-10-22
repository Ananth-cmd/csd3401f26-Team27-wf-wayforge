/*!
 * \file Symbols.cpp
 * \brief Detection and removal of plan symbols: door arcs and leaves, stairs, lifts
 *
 * Works on segments in metres. Each function removes the segments that make
 * up a symbol so wf_read does not turn them into walls:
 *   - removeShortDiagonals: short segments off the building grid (door swing
 *     arcs, which the tracer splits into short pieces)
 *   - detectLifts:  two crossing diagonals (lift shaft X), each rebuilt from
 *     collinear pieces first
 *   - detectStairs: a run of evenly spaced parallel treads of similar length;
 *     flights side by side (dog-leg stairs) are merged
 *   - removeDoorLeaves: a door-width segment hanging off a wall end next to
 *     a door-width gap in that wall (or a gap twice as wide: double doors)
 * detectLifts / detectStairs return the symbol regions so the containing
 * rooms can be tagged (wf_read::tagSymbolRooms).
 *
 * Links: called by wf_read::convertImage / convertSvg (Convert.cpp). Lifts and
 * stairs run before clean(), arc pieces before and after it, door leaves
 * just before wf_read::interpret().
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Door arc removal as short slanted pieces off the building grid
 *   - Stair detection (evenly spaced parallel treads) and lift detection (crossing diagonals)
 *   - Door-leaf removal using the door gap next to the hinge
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_vector/wf_vector.hpp"
#include <algorithm>
#include <cmath>

namespace wf::vec {
namespace {

    // How far a line's angle is from the building grid (the main axis or the one at 90 degrees).
    float offGrid(float angle, float axis) noexcept {
        return std::min(lineAngleDiff(angle, axis), lineAngleDiff(angle, axis + kPi * 0.5f));
    }

    // Where the lines through two segments cross: t along A, u along B (0..1 = inside the segment).
    bool crossing(const Segment& A, const Segment& B, float& t, float& u) noexcept {
        const Vec2 r = A.b - A.a, s = B.b - B.a;
        const float den = cross(r, s);
        if (std::abs(den) < 1e-9f) return false;
        t = cross(B.a - A.a, s) / den;
        u = cross(B.a - A.a, r) / den;
        return true;
    }

    // Keep only the segments not marked for removal.
    std::vector<Segment> keepUnmarked(const std::vector<Segment>& in, const std::vector<uint8_t>& drop) {
        std::vector<Segment> out;
        for (size_t i = 0; i < in.size(); ++i) if (!drop[i]) out.push_back(in[i]);
        return out;
    }

} // namespace

// ---- short slanted leftovers -----------------------------------------------------------
std::vector<Segment> removeShortDiagonals(const std::vector<Segment>& in, float maxLength, float tolDeg, int* removed) {
    if (in.empty()) { if (removed) *removed = 0; return in; }
    const float axis = dominantAngle(in);
    const float tol = degToRad(tolDeg);
    std::vector<uint8_t> drop(in.size(), 0);
    int count = 0;
    for (size_t i = 0; i < in.size(); ++i)
        if (in[i].length() < maxLength && offGrid(in[i].angle(), axis) > tol) { drop[i] = 1; ++count; }
    if (removed) *removed = count;
    return keepUnmarked(in, drop);
}

// ---- lifts: an X of two crossing diagonals -----------------------------------------------
std::vector<SymbolRegion> detectLifts(std::vector<Segment>& segs, float minLength) {
    std::vector<SymbolRegion> lifts;
    if (segs.empty()) return lifts;
    const float axis = dominantAngle(segs);

    // 1. Diagonal segments (25+ degrees off the grid), any length.
    std::vector<size_t> diag;
    for (size_t i = 0; i < segs.size(); ++i)
        if (segs[i].length() >= 0.05f && offGrid(segs[i].angle(), axis) >= degToRad(25.f)) diag.push_back(i);

    // 2. Join collinear pieces: angle within 15 degrees, gap up to 0.8 m, shorter piece within
    //    0.15 m of the longer piece's line.
    std::vector<size_t> parent(diag.size());
    for (size_t i = 0; i < parent.size(); ++i) parent[i] = i;
    auto root = [&](size_t i) { while (parent[i] != i) i = parent[i] = parent[parent[i]]; return i; };
    for (size_t a = 0; a < diag.size(); ++a) {
        for (size_t b = a + 1; b < diag.size(); ++b) {
            const Segment& A = segs[diag[a]]; const Segment& B = segs[diag[b]];
            if (lineAngleDiff(A.angle(), B.angle()) > degToRad(15.f)) continue;
            const float gap = std::min({ distance(A.a, B.a), distance(A.a, B.b), distance(A.b, B.a), distance(A.b, B.b) });
            if (gap > 0.8f) continue;
            const Segment& L = A.length() >= B.length() ? A : B;
            const Segment& S = A.length() >= B.length() ? B : A;
            if (distancePointToLine(S.a, L.a, L.b) > 0.15f || distancePointToLine(S.b, L.a, L.b) > 0.15f) continue;
            parent[root(a)] = root(b);
        }
    }

    // 3. One arm per chain, along its longest piece, spanning all its pieces.
    struct Arm { Segment s; std::vector<size_t> members; };
    std::vector<Arm> arms;
    {
        std::vector<std::vector<size_t>> groups(diag.size());
        for (size_t i = 0; i < diag.size(); ++i) groups[root(i)].push_back(diag[i]);
        for (auto& g : groups) {
            if (g.empty()) continue;
            size_t longest = g[0];
            float covered = 0.f;
            for (size_t k : g) { covered += segs[k].length(); if (segs[k].length() > segs[longest].length()) longest = k; }
            const Vec2 o = segs[longest].a, d = segs[longest].direction();
            float lo = 1e30f, hi = -1e30f;
            for (size_t k : g) for (const Vec2& p : { segs[k].a, segs[k].b }) { lo = std::min(lo, dot(p - o, d)); hi = std::max(hi, dot(p - o, d)); }
            const float span = hi - lo;
            if (span < minLength || covered < span * 0.4f) continue;     // shorter than minLength or under 40% covered
            arms.push_back({ Segment{ o + d * lo, o + d * hi }, g });
        }
    }

    // 4. Lift: two arms crossing at 60+ degrees, 10-90% along each arm.
    std::vector<uint8_t> used(arms.size(), 0), drop(segs.size(), 0);
    for (size_t a = 0; a < arms.size(); ++a) {
        for (size_t b = a + 1; b < arms.size() && !used[a]; ++b) {
            if (used[b]) continue;
            const Segment& A = arms[a].s; const Segment& B = arms[b].s;
            if (lineAngleDiff(A.angle(), B.angle()) < degToRad(60.f)) continue;
            float t, u;
            if (!crossing(A, B, t, u) || t < 0.1f || t > 0.9f || u < 0.1f || u > 0.9f) continue;
            SymbolRegion r;
            r.centre = A.a + (A.b - A.a) * t;
            for (const Vec2& p : { A.a, A.b, B.a, B.b }) r.box.expand(p);
            if (r.box.size().x < minLength || r.box.size().y < minLength) continue;
            used[a] = used[b] = 1;
            for (size_t k : arms[a].members) drop[k] = 1;
            for (size_t k : arms[b].members) drop[k] = 1;
            lifts.push_back(r);
        }
    }
    segs = keepUnmarked(segs, drop);
    return lifts;
}

// ---- stairs: a row of evenly spaced treads ---------------------------------------------
std::vector<SymbolRegion> detectStairs(std::vector<Segment>& segs, int minTreads, float minGap, float maxGap) {
    std::vector<SymbolRegion> stairs;
    if (segs.empty()) return stairs;
    const float axis = dominantAngle(segs);
    std::vector<uint8_t> drop(segs.size(), 0);
    // Look along both grid directions: treads can run across the building or along it.
    for (int k = 0; k < 2; ++k) {
        const float dirAngle = axis + k * kPi * 0.5f;
        const Vec2 d{ std::cos(dirAngle), std::sin(dirAngle) }, n = perp(d);
        struct Cand { size_t idx; float off, lo, hi; };
        std::vector<Cand> c;
        for (size_t i = 0; i < segs.size(); ++i) {
            const Segment& s = segs[i];
            if (drop[i] || lineAngleDiff(s.angle(), dirAngle) > degToRad(8.f)) continue;
            if (s.length() < 0.6f || s.length() > 8.f) continue;                   // treads are 0.6..8 m wide
            const float a = dot(s.a, d), b = dot(s.b, d);
            c.push_back({ i, dot(s.centre(), n), std::min(a, b), std::max(a, b) });
        }
        std::sort(c.begin(), c.end(), [](const Cand& x, const Cand& y) { return x.off < y.off; });
        std::vector<uint8_t> used(c.size(), 0);
        for (size_t s = 0; s < c.size(); ++s) {
            if (used[s]) continue;
            std::vector<size_t> chain{ s };
            float firstGap = -1.f;
            for (size_t j = s + 1; j < c.size(); ++j) {
                if (used[j]) continue;
                const Cand& last = c[chain.back()];
                const float gap = c[j].off - last.off;
                if (gap < minGap) continue;                                        // too close (same line drawn twice)
                if (gap > maxGap) break;                                           // the row has ended
                const Cand& first = c[chain.front()];
                const float lenFirst = first.hi - first.lo, len = c[j].hi - c[j].lo;
                if (len < lenFirst * 0.75f || len > lenFirst * 1.33f) continue;   // treads are the same width
                const float overlap = std::min(first.hi, c[j].hi) - std::max(first.lo, c[j].lo);
                if (overlap < std::min(lenFirst, len) * 0.7f) continue;            // and line up with each other
                if (firstGap > 0.f && std::abs(gap - firstGap) > 0.12f) continue;  // and are evenly spaced
                if (firstGap < 0.f) firstGap = gap;
                chain.push_back(j);
            }
            if (static_cast<int>(chain.size()) < minTreads) continue;
            SymbolRegion r;
            for (size_t ci : chain) {
                used[ci] = 1; drop[c[ci].idx] = 1;
                r.box.expand(segs[c[ci].idx].a); r.box.expand(segs[c[ci].idx].b);
            }
            // Box extended 0.12 m past the first and last tread.
            for (size_t ci : { chain.front(), chain.back() })
                for (float sgn : { -1.f, 1.f }) {
                    r.box.expand(segs[c[ci].idx].a + n * (0.12f * sgn));
                    r.box.expand(segs[c[ci].idx].b + n * (0.12f * sgn));
                }
            r.centre = r.box.centre();
            stairs.push_back(r);
        }
    }
    segs = keepUnmarked(segs, drop);

    // Merge flights side by side (under 0.6 m apart, overlapping by half their length) into one
    // stair.
    auto overlap = [](float a0, float a1, float b0, float b1) { return std::min(a1, b1) - std::max(a0, b0); };
    for (bool merged = true; merged; ) {
        merged = false;
        for (size_t i = 0; i < stairs.size() && !merged; ++i)
            for (size_t j = i + 1; j < stairs.size() && !merged; ++j) {
                const Rect &a = stairs[i].box, &b = stairs[j].box;
                const float ox = overlap(a.min.x, a.max.x, b.min.x, b.max.x), oy = overlap(a.min.y, a.max.y, b.min.y, b.max.y);
                const bool sideX = ox > -0.6f && oy >= 0.5f * std::min(a.size().y, b.size().y);
                const bool sideY = oy > -0.6f && ox >= 0.5f * std::min(a.size().x, b.size().x);
                if (!sideX && !sideY) continue;
                stairs[i].box.expand(b.min); stairs[i].box.expand(b.max);
                stairs[i].centre = stairs[i].box.centre();
                stairs.erase(stairs.begin() + static_cast<std::ptrdiff_t>(j));
                merged = true;
            }
    }
    return stairs;
}

// ---- door leaves -----------------------------------------------------------------------
std::vector<Segment> removeDoorLeaves(const std::vector<Segment>& in, float minWidth, float maxWidth, int* removed) {
    const float touch = 0.15f;
    std::vector<uint8_t> drop(in.size(), 0);
    // True if any segment other than skipA / skipB comes within `touch` of point p.
    auto touchedBy = [&](const Vec2& p, size_t skipA, size_t skipB) {
        for (size_t k = 0; k < in.size(); ++k)
            if (k != skipA && k != skipB && !drop[k] && distancePointToSegment(p, in[k].a, in[k].b) < touch) return true;
        return false;
    };
    int count = 0;
    for (size_t i = 0; i < in.size(); ++i) {
        const Segment& L = in[i];
        const float len = L.length();
        if (len < minWidth * 0.8f || len > maxWidth * 1.15f) continue;
        for (int end = 0; end < 2 && !drop[i]; ++end) {
            const Vec2 hinge = end == 0 ? L.a : L.b, tip = end == 0 ? L.b : L.a;
            if (touchedBy(tip, i, i)) continue;                                    // the open end of a leaf touches nothing
            // The hinge is the free end of a wall A that runs across the leaf.
            for (size_t a = 0; a < in.size() && !drop[i]; ++a) {
                if (a == i || drop[a]) continue;
                const Segment& A = in[a];
                if (lineAngleDiff(A.angle(), L.angle()) < degToRad(60.f)) continue;
                const bool atA = distance(A.a, hinge) < touch, atB = distance(A.b, hinge) < touch;
                if (!atA && !atB) continue;
                if (touchedBy(hinge, i, a)) continue;                              // a real corner has more joining it
                const Vec2 jamb = atA ? A.a : A.b, back = atA ? A.b : A.a;
                const Vec2 out = normalize(jamb - back);                           // from the wall into the doorway
                // Next to the hinge there must be a door-sized gap, then the wall carries on.
                for (size_t b = 0; b < in.size(); ++b) {
                    if (b == i || b == a || drop[b]) continue;
                    const Segment& B = in[b];
                    if (lineAngleDiff(B.angle(), A.angle()) > degToRad(5.f)) continue;
                    if (distancePointToLine(B.a, A.a, A.b) > 0.12f || distancePointToLine(B.b, A.a, A.b) > 0.12f) continue;
                    const float g = std::min(dot(B.a - jamb, out), dot(B.b - jamb, out));
                    // Single door: gap 0.75-1.5 times the leaf length.
                    const bool single = g >= len * 0.75f && g <= len * 1.5f;
                    // Double door: gap 1.6-2.5 times the leaf length, with a matching leaf on the
                    // far jamb on the same side.
                    bool pair = false;
                    if (!single && g >= len * 1.6f && g <= len * 2.5f) {
                        const Vec2 jamb2 = jamb + out * g, side = tip - hinge;
                        for (size_t k = 0; k < in.size() && !pair; ++k) {
                            if (k == i || k == a || k == b) continue;
                            const Segment& M = in[k];
                            const float ml = M.length();
                            if (ml < len * 0.75f || ml > len * 1.33f || lineAngleDiff(M.angle(), L.angle()) > degToRad(10.f)) continue;
                            const bool fromA = distance(M.a, jamb2) < 2.f * touch, fromB = distance(M.b, jamb2) < 2.f * touch;
                            if (!fromA && !fromB) continue;
                            pair = dot((fromA ? M.b - M.a : M.a - M.b), side) > 0.f;
                        }
                    }
                    if (single || pair) { drop[i] = 1; ++count; break; }
                }
            }
        }
    }
    if (removed) *removed = count;
    return keepUnmarked(in, drop);
}

} // namespace wf::vec
