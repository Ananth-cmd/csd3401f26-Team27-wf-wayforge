#include "wf_vector/wf_vector.hpp"
#include <algorithm>
#include <unordered_map>
#include <map>
#include <set>

namespace wf::vec {
namespace {

// Intersection parameter of P=a+t(b-a) with Q=c+u(d-c); returns false if parallel.
bool lineParams(const Vec2& a, const Vec2& b, const Vec2& c, const Vec2& d, float& t, float& u) {
    const Vec2 r = b - a, s = d - c;
    const float den = cross(r, s);
    if (std::abs(den) < 1e-9f) return false;
    const Vec2 qp = c - a;
    t = cross(qp, s) / den;
    u = cross(qp, r) / den;
    return true;
}

} // namespace

PlanarGraph buildPlanarGraph(const std::vector<Segment>& segments, float snapDistance) {
    // 1. split every segment at its crossings and T-junctions
    const size_t n = segments.size();
    std::vector<std::vector<float>> cuts(n);
    for (size_t i = 0; i < n; ++i) { cuts[i].push_back(0.f); cuts[i].push_back(1.f); }
    for (size_t i = 0; i < n; ++i) {
        const Segment& A = segments[i];
        // tolerance in parameter space equivalent to snapDistance in world space
        const float epsA = snapDistance / std::max(A.length(), 1e-5f);
        for (size_t j = i + 1; j < n; ++j) {
            const Segment& B = segments[j];
            const float epsB = snapDistance / std::max(B.length(), 1e-5f);
            float t, u;
            if (lineParams(A.a, A.b, B.a, B.b, t, u)) {
                if (t > -epsA && t < 1 + epsA && u > -epsB && u < 1 + epsB) {
                    if (t > epsA && t < 1 - epsA) cuts[i].push_back(t);
                    if (u > epsB && u < 1 - epsB) cuts[j].push_back(u);
                }
            } else {
                const float eps = 1e-4f;
                // collinear overlap: cut each at the other's endpoints that fall inside it
                if (distancePointToLine(B.a, A.a, A.b) < snapDistance) {
                    const Vec2 dA = A.b - A.a; const float lA = lengthSq(dA);
                    const Vec2 dB = B.b - B.a; const float lB = lengthSq(dB);
                    if (lA > 0) {
                        const float ta = dot(B.a - A.a, dA) / lA, tb = dot(B.b - A.a, dA) / lA;
                        if (ta > eps && ta < 1 - eps) cuts[i].push_back(ta);
                        if (tb > eps && tb < 1 - eps) cuts[i].push_back(tb);
                    }
                    if (lB > 0) {
                        const float ua = dot(A.a - B.a, dB) / lB, ub = dot(A.b - B.a, dB) / lB;
                        if (ua > eps && ua < 1 - eps) cuts[j].push_back(ua);
                        if (ub > eps && ub < 1 - eps) cuts[j].push_back(ub);
                    }
                }
            }
        }
    }
    std::vector<Segment> pieces;
    for (size_t i = 0; i < n; ++i) {
        auto& c = cuts[i];
        std::sort(c.begin(), c.end());
        c.erase(std::unique(c.begin(), c.end(), [](float x, float y) { return std::abs(x - y) < 1e-5f; }), c.end());
        for (size_t k = 0; k + 1 < c.size(); ++k) {
            Segment s; s.a = lerp(segments[i].a, segments[i].b, c[k]); s.b = lerp(segments[i].a, segments[i].b, c[k + 1]);
            s.confidence = segments[i].confidence;
            if (s.length() > snapDistance * 0.5f) pieces.push_back(s);
        }
    }

    // 2. snap shared vertices
    pieces = snapEndpoints(pieces, snapDistance);

    PlanarGraph g;
    std::map<std::pair<long long, long long>, int> vertexIndex;
    const float cell = std::max(snapDistance * 0.5f, 1e-5f);
    auto vertexFor = [&](const Vec2& p) {
        const std::pair<long long, long long> key{ static_cast<long long>(std::llround(p.x / cell)), static_cast<long long>(std::llround(p.y / cell)) };
        auto it = vertexIndex.find(key);
        if (it != vertexIndex.end()) return it->second;
        const int idx = g.vertexCount();
        g.vertices.push_back({p, {}});
        vertexIndex.emplace(key, idx);
        return idx;
    };
    std::set<std::pair<int, int>> seen;
    for (const auto& s : pieces) {
        const int a = vertexFor(s.a), b = vertexFor(s.b);
        if (a == b) continue;
        const auto key = std::minmax(a, b);
        if (!seen.insert(key).second) continue;                // duplicate edge
        const int e = g.edgeCount();
        g.edges.push_back({a, b, s.confidence});
        g.vertices[static_cast<size_t>(a)].edges.push_back(e);
        g.vertices[static_cast<size_t>(b)].edges.push_back(e);
    }
    // 3. sort edges around each vertex by angle (counter-clockwise, ascending atan2)
    for (int v = 0; v < g.vertexCount(); ++v) {
        auto& vert = g.vertices[static_cast<size_t>(v)];
        std::sort(vert.edges.begin(), vert.edges.end(), [&](int e1, int e2) {
            const Vec2 d1 = g.vertices[static_cast<size_t>(g.otherEnd(e1, v))].pos - vert.pos;
            const Vec2 d2 = g.vertices[static_cast<size_t>(g.otherEnd(e2, v))].pos - vert.pos;
            return angleOf(d1) < angleOf(d2);
        });
    }
    return g;
}

PlanarGraph pruneDanglingEdges(const PlanarGraph& in, int passes) {
    std::vector<uint8_t> dead(in.edges.size(), 0);
    std::vector<int> degree(in.vertices.size());
    for (size_t v = 0; v < in.vertices.size(); ++v) degree[v] = static_cast<int>(in.vertices[v].edges.size());
    for (int p = 0; p < passes; ++p) {
        bool changed = false;
        for (size_t v = 0; v < in.vertices.size(); ++v) {
            if (degree[v] != 1) continue;
            for (int e : in.vertices[v].edges) {
                if (dead[static_cast<size_t>(e)]) continue;
                dead[static_cast<size_t>(e)] = 1;
                degree[v]--; degree[static_cast<size_t>(in.otherEnd(e, static_cast<int>(v)))]--;
                changed = true;
            }
        }
        if (!changed) break;
    }
    std::vector<Segment> keep;
    for (size_t e = 0; e < in.edges.size(); ++e) {
        if (dead[e]) continue;
        Segment s; s.a = in.vertices[static_cast<size_t>(in.edges[e].a)].pos; s.b = in.vertices[static_cast<size_t>(in.edges[e].b)].pos;
        s.confidence = in.edges[e].confidence;
        keep.push_back(s);
    }
    return buildPlanarGraph(keep, 1e-4f);
}

std::vector<Face> findFaces(const PlanarGraph& g) {
    std::vector<Face> faces;
    // visited[e][dir]: dir 0 = a->b, dir 1 = b->a
    std::vector<std::array<uint8_t, 2>> visited(g.edges.size(), {0, 0});
    for (int e0 = 0; e0 < g.edgeCount(); ++e0) {
        for (int dir0 = 0; dir0 < 2; ++dir0) {
            if (visited[static_cast<size_t>(e0)][static_cast<size_t>(dir0)]) continue;
            Face f;
            int e = e0, dir = dir0;
            int guard = 0;
            while (guard++ < g.edgeCount() * 2 + 2) {
                if (visited[static_cast<size_t>(e)][static_cast<size_t>(dir)]) break;
                visited[static_cast<size_t>(e)][static_cast<size_t>(dir)] = 1;
                const int from = dir == 0 ? g.edges[static_cast<size_t>(e)].a : g.edges[static_cast<size_t>(e)].b;
                const int to   = g.otherEnd(e, from);
                f.vertices.push_back(from);
                f.edges.push_back(e);
                // at `to`, take the next edge clockwise from the one we arrived on
                const auto& around = g.vertices[static_cast<size_t>(to)].edges;
                const auto it = std::find(around.begin(), around.end(), e);
                const size_t idx = static_cast<size_t>(it - around.begin());
                const int next = around[(idx + around.size() - 1) % around.size()];
                dir = g.edges[static_cast<size_t>(next)].a == to ? 0 : 1;
                e = next;
                if (e == e0 && dir == dir0) break;
            }
            if (f.vertices.size() < 3) continue;
            for (int v : f.vertices) f.points.push_back(g.vertices[static_cast<size_t>(v)].pos);
            double area = 0.0;
            for (size_t i = 0; i < f.points.size(); ++i) {
                const Vec2& p = f.points[i]; const Vec2& q = f.points[(i + 1) % f.points.size()];
                area += static_cast<double>(p.x) * q.y - static_cast<double>(q.x) * p.y;
            }
            f.area = static_cast<float>(area * 0.5);
            if (f.area > 1e-6f) faces.push_back(std::move(f));      // discard the outer face (negative) and degenerate ones
        }
    }
    return faces;
}

} // namespace wf::vec
