#include "wf_vector/wf_vector.hpp"
#include <algorithm>
#include <unordered_map>
#include <numeric>

namespace wf::vec {

Rect bounds(const std::vector<Segment>& segs) noexcept {
    Rect r; for (auto& s : segs) { r.expand(s.a); r.expand(s.b); } return r;
}

std::vector<Segment> scale(const std::vector<Segment>& in, float factor, Vec2 origin, bool flipY, float height) {
    std::vector<Segment> out; out.reserve(in.size());
    auto xf = [&](Vec2 p) { if (flipY) p.y = height - p.y; return (p - origin) * factor; };
    for (const auto& s : in) { Segment t = s; t.a = xf(s.a); t.b = xf(s.b); out.push_back(t); }
    return out;
}

// Two segments merge if they are near-parallel, near-collinear, and their
// projections onto the shared line touch or overlap (allowing a small gap).
std::vector<Segment> mergeCollinear(const std::vector<Segment>& in, float angleDeg, float gap) {
    std::vector<Segment> segs = in;
    const float angTol = degToRad(angleDeg);
    bool changed = true;
    int passes = 0;
    while (changed && passes++ < 50) {
        changed = false;
        std::vector<uint8_t> dead(segs.size(), 0);
        for (size_t i = 0; i < segs.size(); ++i) {
            if (dead[i]) continue;
            for (size_t j = i + 1; j < segs.size(); ++j) {
                if (dead[j]) continue;
                const Segment& A = segs[i]; const Segment& B = segs[j];
                if (lineAngleDiff(A.angle(), B.angle()) > angTol) continue;
                if (distancePointToLine(B.a, A.a, A.b) > gap || distancePointToLine(B.b, A.a, A.b) > gap) continue;
                const Vec2 d = A.direction();
                const float a0 = 0.f, a1 = dot(A.b - A.a, d);
                const float b0 = dot(B.a - A.a, d), b1 = dot(B.b - A.a, d);
                const float lo = std::min(a0, a1), hi = std::max(a0, a1);
                const float blo = std::min(b0, b1), bhi = std::max(b0, b1);
                if (bhi < lo - gap || blo > hi + gap) continue;          // no overlap, too far apart
                const float nlo = std::min(lo, blo), nhi = std::max(hi, bhi);
                Segment m; m.a = A.a + d * nlo; m.b = A.a + d * nhi;
                m.confidence = std::max(A.confidence, B.confidence);
                segs[i] = m; dead[j] = 1; changed = true;
            }
        }
        std::vector<Segment> next;
        for (size_t i = 0; i < segs.size(); ++i) if (!dead[i]) next.push_back(segs[i]);
        segs.swap(next);
    }
    return segs;
}

// Cluster endpoints with a union-find over a spatial hash; each cluster becomes its mean.
std::vector<Segment> snapEndpoints(const std::vector<Segment>& in, float snap) {
    std::vector<Vec2> pts; pts.reserve(in.size() * 2);
    for (auto& s : in) { pts.push_back(s.a); pts.push_back(s.b); }
    const size_t n = pts.size();
    std::vector<size_t> parent(n); std::iota(parent.begin(), parent.end(), 0);
    auto find = [&](size_t x) { while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    auto unite = [&](size_t a, size_t b) { a = find(a); b = find(b); if (a != b) parent[a] = b; };

    const float cell = std::max(snap, 1e-4f);
    std::unordered_map<long long, std::vector<size_t>> grid;
    auto key = [&](int gx, int gy) { return (static_cast<long long>(gx) << 32) ^ (static_cast<long long>(gy) & 0xffffffffLL); };
    for (size_t i = 0; i < n; ++i) {
        const int gx = static_cast<int>(std::floor(pts[i].x / cell)), gy = static_cast<int>(std::floor(pts[i].y / cell));
        for (int oy = -1; oy <= 1; ++oy) for (int ox = -1; ox <= 1; ++ox) {
            auto it = grid.find(key(gx + ox, gy + oy));
            if (it == grid.end()) continue;
            for (size_t j : it->second) if (distanceSq(pts[i], pts[j]) <= snap * snap) unite(i, j);
        }
        grid[key(gx, gy)].push_back(i);
    }
    std::unordered_map<size_t, std::pair<Vec2, int>> acc;
    for (size_t i = 0; i < n; ++i) { auto& a = acc[find(i)]; a.first += pts[i]; a.second++; }
    std::vector<Segment> out; out.reserve(in.size());
    for (size_t i = 0; i < in.size(); ++i) {
        Segment s = in[i];
        auto& ca = acc[find(2 * i)]; auto& cb = acc[find(2 * i + 1)];
        s.a = ca.first / static_cast<float>(ca.second);
        s.b = cb.first / static_cast<float>(cb.second);
        if (s.length() > 1e-5f) out.push_back(s);
    }
    return out;
}

// Skeleton tracing leaves corners slightly open (junction pixels are split off).
// Where two non-parallel segments end near each other, extend both to their
// line intersection so the corner closes and face-finding can see the loop.
std::vector<Segment> closeCorners(const std::vector<Segment>& in, float maxGap, float minAngleDeg) {
    std::vector<Segment> segs = in;
    const float minAng = degToRad(minAngleDeg);
    for (size_t i = 0; i < segs.size(); ++i) {
        for (size_t j = i + 1; j < segs.size(); ++j) {
            if (lineAngleDiff(segs[i].angle(), segs[j].angle()) < minAng) continue;
            Vec2* ends_i[2] = { &segs[i].a, &segs[i].b };
            Vec2* ends_j[2] = { &segs[j].a, &segs[j].b };
            for (Vec2* pi : ends_i) for (Vec2* pj : ends_j) {
                if (distance(*pi, *pj) > maxGap || distance(*pi, *pj) < 1e-6f) continue;
                // line intersection
                const Vec2 r = segs[i].b - segs[i].a, s = segs[j].b - segs[j].a;
                const float den = cross(r, s);
                if (std::abs(den) < 1e-9f) continue;
                const float t = cross(segs[j].a - segs[i].a, s) / den;
                const Vec2 x = segs[i].a + r * t;
                if (distance(x, *pi) > maxGap * 1.5f || distance(x, *pj) > maxGap * 1.5f) continue;
                *pi = x; *pj = x;
            }
        }
    }
    return segs;
}

// Skeleton tracing also trims T-junctions: the stem stops a few pixels short of
// the bar. Extend any endpoint that lies within maxGap of a non-parallel segment
// onto that segment's line.
std::vector<Segment> closeTJunctions(const std::vector<Segment>& in, float maxGap, float minAngleDeg) {
    std::vector<Segment> segs = in;
    const float minAng = degToRad(minAngleDeg);
    for (size_t i = 0; i < segs.size(); ++i) {
        Vec2* ends[2] = { &segs[i].a, &segs[i].b };
        for (Vec2* e : ends) {
            float bestD = maxGap; const Segment* bestS = nullptr;
            for (size_t j = 0; j < segs.size(); ++j) {
                if (i == j) continue;
                if (lineAngleDiff(segs[i].angle(), segs[j].angle()) < minAng) continue;
                const float d = distancePointToSegment(*e, segs[j].a, segs[j].b);
                if (d < bestD) { bestD = d; bestS = &segs[j]; }
            }
            if (!bestS) continue;
            // move the endpoint along its own line onto the other segment's line
            const Vec2 r = segs[i].b - segs[i].a, s = bestS->b - bestS->a;
            const float den = cross(r, s);
            if (std::abs(den) < 1e-9f) continue;
            const float t = cross(bestS->a - segs[i].a, s) / den;
            const Vec2 x = segs[i].a + r * t;
            if (distance(x, *e) <= maxGap * 1.5f) *e = x;
        }
    }
    return segs;
}

float dominantAngle(const std::vector<Segment>& in) {
    std::array<float, 90> hist{};
    for (auto& s : in) {
        float deg = radToDeg(s.angle());
        deg = std::fmod(std::fmod(deg, 90.f) + 90.f, 90.f);
        hist[static_cast<size_t>(deg) % 90] += s.length();
    }
    size_t best = 0;
    for (size_t i = 1; i < hist.size(); ++i) if (hist[i] > hist[best]) best = i;
    // refine to the weighted mean inside the winning bin +-1
    float sum = 0.f, wsum = 0.f;
    for (auto& s : in) {
        float deg = std::fmod(std::fmod(radToDeg(s.angle()), 90.f) + 90.f, 90.f);
        float diff = std::abs(deg - static_cast<float>(best));
        diff = std::min(diff, 90.f - diff);
        if (diff <= 1.5f) { sum += (deg - static_cast<float>(best) > 45.f ? deg - 90.f : (static_cast<float>(best) - deg > 45.f ? deg + 90.f : deg)) * s.length(); wsum += s.length(); }
    }
    float deg = wsum > 0.f ? sum / wsum : static_cast<float>(best);
    deg = std::fmod(std::fmod(deg, 90.f) + 90.f, 90.f);
    return degToRad(deg);
}

std::vector<Segment> straighten(const std::vector<Segment>& in, float axisAngle, float tolDeg) {
    std::vector<Segment> out; out.reserve(in.size());
    const float tol = degToRad(tolDeg);
    for (const auto& s : in) {
        Segment t = s;
        const float ang = s.angle();
        // candidate axes: axisAngle + k * 90deg
        float bestAxis = ang; float bestDiff = 1e9f;
        for (int k = 0; k < 4; ++k) {
            const float axis = axisAngle + k * kPi * 0.5f;
            const float d = angleDiff(ang, axis);
            if (d < bestDiff) { bestDiff = d; bestAxis = axis; }
        }
        if (bestDiff <= tol) {
            const Vec2 c = s.centre();
            const Vec2 dir{std::cos(bestAxis), std::sin(bestAxis)};
            const float half = s.length() * 0.5f;
            t.a = c - dir * half; t.b = c + dir * half;
        }
        out.push_back(t);
    }
    return out;
}

std::vector<Segment> clean(const std::vector<Segment>& in, const CleanParams& p) {
    std::vector<Segment> s = mergeCollinear(in, p.mergeAngleDeg, p.mergeGap);
    s = closeCorners(s, p.cornerGap);
    s = closeTJunctions(s, p.cornerGap);
    s = snapEndpoints(s, p.snapDistance);
    if (p.straighten && !s.empty()) {
        s = straighten(s, dominantAngle(s), p.straightenTolDeg);
        s = closeCorners(s, p.cornerGap);
        s = closeTJunctions(s, p.cornerGap);
        s = snapEndpoints(s, p.snapDistance);
        s = mergeCollinear(s, p.mergeAngleDeg, p.mergeGap);   // straightening often makes new collinear pairs
        s = snapEndpoints(s, p.snapDistance);
    }
    std::erase_if(s, [&](const Segment& x) { return x.length() < p.minLength; });
    return s;
}

} // namespace wf::vec
