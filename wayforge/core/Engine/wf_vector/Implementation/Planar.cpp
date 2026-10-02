/*!
 * \file Planar.cpp
 * \brief Joining lines into a planar graph and finding the closed loops (rooms)
 *
 * Turns a list of wall lines into a "planar graph": every place two lines
 * cross or touch becomes a shared point (vertex), and the pieces between
 * those points become edges. Walking around that graph, always turning the
 * same way, traces each closed loop exactly once - those loops are the
 * room shapes. Dead-end lines (half a door frame, a stray mark) can be
 * pruned first because they can never be part of a loop.
 *
 * Links: wf_read::findRooms builds the graph from the wall centrelines,
 * prunes dead ends and calls findFaces; each face becomes a Room.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Splitting segments at crossings and T-junctions (incl. overlapping lines)
 *   - Vertex sharing via a snap grid, edges sorted by angle
 *   - Face tracing and dangling-edge pruning
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-28
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_vector/wf_vector.hpp"   // Segment, PlanarGraph, Face and the functions defined here.
#include <algorithm>                 // std::sort, std::unique, std::find.
#include <unordered_map>
#include <map>                       // Snap-grid cell -> vertex index.
#include <set>                       // Remembers which edges we already added.

namespace wf::vec {
    namespace {

        // Intersection parameter of P=a+t(b-a) with Q=c+u(d-c); returns false if parallel.
        // t and u say how far along each line the crossing is: 0 = at the start, 1 = at the end.
        bool lineParams(const Vec2& a, const Vec2& b, const Vec2& c, const Vec2& d, float& t, float& u) {
            const Vec2 r = b - a, s = d - c;
            const float den = cross(r, s);
            if (std::abs(den) < 1e-9f) return false;   // Parallel: they never cross.
            const Vec2 qp = c - a;
            t = cross(qp, s) / den;
            u = cross(qp, r) / den;
            return true;
        }

    } // namespace

    PlanarGraph buildPlanarGraph(const std::vector<Segment>& segments, float snapDistance) {
        // 1. split every segment at its crossings and T-junctions
        const size_t n = segments.size();
        // cuts[i] = the places (0..1 along segment i) where it must be cut. Always includes both ends.
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
                    // They cross (or nearly touch) within both segments: cut each one there,
                    // unless the crossing is right at an end already.
                    if (t > -epsA && t < 1 + epsA && u > -epsB && u < 1 + epsB) {
                        if (t > epsA && t < 1 - epsA) cuts[i].push_back(t);
                        if (u > epsB && u < 1 - epsB) cuts[j].push_back(u);
                    }
                }
                else {
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
        // Cut each segment into pieces between its sorted cut points.
        std::vector<Segment> pieces;
        for (size_t i = 0; i < n; ++i) {
            auto& c = cuts[i];
            std::sort(c.begin(), c.end());
            c.erase(std::unique(c.begin(), c.end(), [](float x, float y) { return std::abs(x - y) < 1e-5f; }), c.end());   // Drop cuts at (almost) the same place.
            for (size_t k = 0; k + 1 < c.size(); ++k) {
                Segment s; s.a = lerp(segments[i].a, segments[i].b, c[k]); s.b = lerp(segments[i].a, segments[i].b, c[k + 1]);
                s.confidence = segments[i].confidence;
                if (s.length() > snapDistance * 0.5f) pieces.push_back(s);   // Skip slivers shorter than half the snap distance.
            }
        }

        // 2. snap shared vertices
        pieces = snapEndpoints(pieces, snapDistance);   // From Clean.cpp: ends that are nearly the same become exactly the same.

        PlanarGraph g;
        // Points are matched by rounding them onto a fine grid, so tiny float differences still give the same vertex.
        std::map<std::pair<long long, long long>, int> vertexIndex;
        const float cell = std::max(snapDistance * 0.5f, 1e-5f);
        auto vertexFor = [&](const Vec2& p) {
            const std::pair<long long, long long> key{ static_cast<long long>(std::llround(p.x / cell)), static_cast<long long>(std::llround(p.y / cell)) };
            auto it = vertexIndex.find(key);
            if (it != vertexIndex.end()) return it->second;   // Already have a vertex here: reuse it.
            const int idx = g.vertexCount();
            g.vertices.push_back({ p, {} });                  // New vertex.
            vertexIndex.emplace(key, idx);
            return idx;
            };
        std::set<std::pair<int, int>> seen;
        for (const auto& s : pieces) {
            const int a = vertexFor(s.a), b = vertexFor(s.b);
            if (a == b) continue;                                  // Both ends on one vertex: not a real edge.
            const auto key = std::minmax(a, b);
            if (!seen.insert(key).second) continue;                // duplicate edge
            const int e = g.edgeCount();
            g.edges.push_back({ a, b, s.confidence });
            g.vertices[static_cast<size_t>(a)].edges.push_back(e);   // Each vertex remembers the edges touching it.
            g.vertices[static_cast<size_t>(b)].edges.push_back(e);
        }
        // 3. sort edges around each vertex by angle (counter-clockwise, ascending atan2)
        // This order is what lets findFaces "turn right" at every vertex.
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
        // A vertex with only one edge is a dead end. Remove that edge; this may create a new dead end,
        // so repeat until none are left (or we run out of passes).
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
                    degree[v]--; degree[static_cast<size_t>(in.otherEnd(e, static_cast<int>(v)))]--;   // Both ends lose an edge.
                    changed = true;
                }
            }
            if (!changed) break;
        }
        // Rebuild a clean graph from the edges that survived.
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
        // Every edge can be walked in two directions; each direction belongs to exactly one face.
        // visited[e][dir]: dir 0 = a->b, dir 1 = b->a
        std::vector<std::array<uint8_t, 2>> visited(g.edges.size(), { 0, 0 });
        for (int e0 = 0; e0 < g.edgeCount(); ++e0) {
            for (int dir0 = 0; dir0 < 2; ++dir0) {
                if (visited[static_cast<size_t>(e0)][static_cast<size_t>(dir0)]) continue;   // Already part of a face we traced.
                Face f;
                int e = e0, dir = dir0;
                int guard = 0;   // Safety limit so a broken graph can never loop forever.
                while (guard++ < g.edgeCount() * 2 + 2) {
                    if (visited[static_cast<size_t>(e)][static_cast<size_t>(dir)]) break;
                    visited[static_cast<size_t>(e)][static_cast<size_t>(dir)] = 1;
                    const int from = dir == 0 ? g.edges[static_cast<size_t>(e)].a : g.edges[static_cast<size_t>(e)].b;
                    const int to = g.otherEnd(e, from);
                    f.vertices.push_back(from);
                    f.edges.push_back(e);
                    // at `to`, take the next edge clockwise from the one we arrived on
                    const auto& around = g.vertices[static_cast<size_t>(to)].edges;
                    const auto it = std::find(around.begin(), around.end(), e);
                    const size_t idx = static_cast<size_t>(it - around.begin());
                    const int next = around[(idx + around.size() - 1) % around.size()];
                    dir = g.edges[static_cast<size_t>(next)].a == to ? 0 : 1;   // Walk the next edge away from `to`.
                    e = next;
                    if (e == e0 && dir == dir0) break;   // Back where we started: the loop is closed.
                }
                if (f.vertices.size() < 3) continue;   // Fewer than 3 corners can't be a room.
                for (int v : f.vertices) f.points.push_back(g.vertices[static_cast<size_t>(v)].pos);
                // Shoelace formula: positive area = counter-clockwise loop = an inside face.
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
