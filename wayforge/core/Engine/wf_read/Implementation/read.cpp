#include "wf_read/wf_read.hpp"
#include <algorithm>

namespace wf::read {
namespace {

// Projection interval of segment S onto the line through `origin` with unit direction d.
std::pair<float, float> project(const vec::Segment& s, const Vec2& origin, const Vec2& d) {
    const float t0 = dot(s.a - origin, d), t1 = dot(s.b - origin, d);
    return { std::min(t0, t1), std::max(t0, t1) };
}
std::pair<float, float> project(const Wall& w, const Vec2& origin, const Vec2& d) {
    const float t0 = dot(w.a - origin, d), t1 = dot(w.b - origin, d);
    return { std::min(t0, t1), std::max(t0, t1) };
}

} // namespace

// ---- 1. walls ------------------------------------------------------------------------
std::vector<Wall> pairWalls(const std::vector<vec::Segment>& segs, IdGenerator& ids, const ReadParams& p, ReadStats* stats) {
    const float angTol = degToRad(p.parallelDeg);
    std::vector<uint8_t> used(segs.size(), 0);
    std::vector<Wall> walls;
    int paired = 0, single = 0;

    for (size_t i = 0; i < segs.size(); ++i) {
        if (used[i]) continue;
        const vec::Segment& A = segs[i];
        const Vec2 d = A.direction(), n = perp(d);
        int   bestJ = -1; float bestScore = -1.f, bestDist = 0.f; std::pair<float, float> bestOverlap{};
        for (size_t j = i + 1; j < segs.size(); ++j) {
            if (used[j]) continue;
            const vec::Segment& B = segs[j];
            if (lineAngleDiff(A.angle(), B.angle()) > angTol) continue;
            const float dist = std::abs(dot(B.centre() - A.a, n));       // perpendicular distance between the lines
            if (dist < p.minThickness || dist > p.maxThickness) continue;
            const auto pa = project(A, A.a, d), pb = project(B, A.a, d);
            const float lo = std::max(pa.first, pb.first), hi = std::min(pa.second, pb.second);
            if (hi - lo < std::min(A.length(), B.length()) * 0.5f) continue;   // must overlap for at least half the shorter one
            const float score = (hi - lo) / std::max(A.length(), B.length());
            if (score > bestScore) { bestScore = score; bestJ = static_cast<int>(j); bestDist = dist; bestOverlap = { std::min(pa.first, pb.first), std::max(pa.second, pb.second) }; }
        }
        if (bestJ >= 0) {
            const vec::Segment& B = segs[static_cast<size_t>(bestJ)];
            used[i] = used[static_cast<size_t>(bestJ)] = 1;
            const float side = dot(B.centre() - A.a, n) > 0 ? 1.f : -1.f;
            const Vec2 origin = A.a + n * (side * bestDist * 0.5f);           // centreline between the two lines
            Wall w; w.id = ids.next("w");
            w.a = origin + d * bestOverlap.first; w.b = origin + d * bestOverlap.second;
            w.thickness = bestDist;
            w.confidence = std::min(1.f, 0.7f + 0.3f * bestScore);
            walls.push_back(w);
            ++paired;
        }
    }
    // Unpaired segments: on a single-line drawing they are the walls; on a double-line
    // drawing they are probably furniture or dimension lines. Keep them, at lower confidence,
    // so the user can promote or delete them.
    const bool doubleLinePlan = paired * 2 > static_cast<int>(segs.size()) / 2;
    for (size_t i = 0; i < segs.size(); ++i) {
        if (used[i]) continue;
        Wall w; w.id = ids.next("w"); w.a = segs[i].a; w.b = segs[i].b;
        w.thickness = p.defaultThickness;
        // very short strays (text, arrows, dimension ticks) are almost never walls
        const float lengthFactor = segs[i].length() < 0.6f ? 0.4f : 1.f;
        w.confidence = (doubleLinePlan ? 0.35f : 0.75f * segs[i].confidence) * lengthFactor;
        walls.push_back(w);
        ++single;
    }
    if (stats) {
        stats->pairedWalls = paired; stats->singleWalls = single;
        stats->notes.push_back(doubleLinePlan ? "double-line plan: unpaired lines kept at low confidence"
                                              : "single-line plan: lines taken as wall centrelines");
    }
    return walls;
}

// ---- 2. doors ------------------------------------------------------------------------
// Two collinear walls with a door-sized gap between them become one wall with an opening.
void bridgeDoorGaps(std::vector<Wall>& walls, std::vector<Opening>& openings, IdGenerator& ids, const ReadParams& p) {
    const float angTol = degToRad(p.parallelDeg);
    bool changed = true;
    int guard = 0;
    while (changed && guard++ < 100) {
        changed = false;
        for (size_t i = 0; i < walls.size() && !changed; ++i) {
            for (size_t j = i + 1; j < walls.size(); ++j) {
                Wall& A = walls[i]; Wall& B = walls[j];
                if (lineAngleDiff(angleOf(A.b - A.a), angleOf(B.b - B.a)) > angTol) continue;
                const Vec2 d = A.direction();
                if (distancePointToLine(B.a, A.a, A.b) > p.collinearTol || distancePointToLine(B.b, A.a, A.b) > p.collinearTol) continue;
                const auto pa = project(A, A.a, d), pb = project(B, A.a, d);
                float gap, gapStart;
                if (pb.first >= pa.second) { gap = pb.first - pa.second; gapStart = pa.second; }
                else if (pa.first >= pb.second) { gap = pa.first - pb.second; gapStart = pb.second; }
                else continue;                                             // they overlap: not a gap
                if (gap < p.minDoorWidth || gap > p.maxDoorWidth) continue;
                // merge into one wall from the minimum to the maximum projection
                const float lo = std::min(pa.first, pb.first), hi = std::max(pa.second, pb.second);
                Wall merged = A;
                merged.a = A.a + d * lo; merged.b = A.a + d * hi;
                merged.thickness = (A.thickness + B.thickness) * 0.5f;
                merged.confidence = std::min(A.confidence, B.confidence);
                // openings already on B need re-basing onto the merged wall
                for (auto& o : openings) {
                    if (o.wall == B.id) {
                        const float along = dot(B.a - A.a, d) + o.offset * (dot(B.direction(), d) > 0 ? 1.f : -1.f);
                        o.wall = merged.id; o.offset = along - lo;
                    } else if (o.wall == A.id) {
                        o.offset -= lo;                                    // merged.a moved back by `lo`
                    }
                }
                Opening door; door.id = ids.next("o"); door.wall = merged.id; door.type = OpeningType::Door;
                door.offset = gapStart - lo; door.width = gap; door.confidence = 0.7f;
                openings.push_back(door);
                walls[i] = merged;
                walls.erase(walls.begin() + static_cast<std::ptrdiff_t>(j));
                changed = true;
                break;
            }
        }
    }
    // A wall whose `a` is not at projection 0 would break the offset convention; normalise.
    for (auto& w : walls) if (w.length() < 1e-5f) w.b = w.a + Vec2{0.01f, 0.f};
}

// ---- 3. rooms ------------------------------------------------------------------------
RoomKind classifyFace(const std::vector<Vec2>& poly, float area, const ReadParams& p) {
    const Rect r = polygonBounds(poly);
    const Vec2 s = r.size();
    const float longSide = std::max(s.x, s.y), shortSide = std::max(std::min(s.x, s.y), 1e-4f);
    // thin faces: either the bounding box is long and thin, or the face fills little of its box
    const float fill = area / std::max(s.x * s.y, 1e-4f);
    if (longSide / shortSide >= p.corridorAspect || (fill < 0.45f && longSide > 6.f)) return RoomKind::Corridor;
    return RoomKind::Unknown;
}

std::vector<Room> findRooms(const std::vector<Wall>& walls, IdGenerator& ids, const ReadParams& p, ReadStats* stats) {
    std::vector<vec::Segment> centrelines;
    centrelines.reserve(walls.size());
    for (const auto& w : walls) { vec::Segment s; s.a = w.a; s.b = w.b; s.confidence = w.confidence; centrelines.push_back(s); }
    vec::PlanarGraph g = vec::pruneDanglingEdges(vec::buildPlanarGraph(centrelines, p.snap));
    std::vector<vec::Face> faces = vec::findFaces(g);
    std::sort(faces.begin(), faces.end(), [](const vec::Face& x, const vec::Face& y) {
        const Vec2 cx = polygonCentroid(x.points), cy = polygonCentroid(y.points);
        return cy.y != cx.y ? cy.y < cx.y : cx.x < cy.x;                  // stable order: top-to-bottom, left-to-right
    });

    std::vector<Room> rooms;
    int corridors = 0;
    for (const auto& f : faces) {
        if (f.area < p.minRoomArea) continue;
        Room r; r.id = ids.next("r");
        r.polygon = f.points;
        r.area = f.area;
        r.centroid = polygonCentroid(r.polygon);
        if (!pointInPolygon(r.centroid, r.polygon)) {
            // concave room: fall back to the vertex-average point nearest the interior (cheap pole of inaccessibility)
            Vec2 best = r.centroid; float bestD = -1.f;
            const Rect bb = polygonBounds(r.polygon);
            for (int gy = 1; gy < 10; ++gy) for (int gx = 1; gx < 10; ++gx) {
                const Vec2 c{ bb.min.x + bb.size().x * gx / 10.f, bb.min.y + bb.size().y * gy / 10.f };
                if (!pointInPolygon(c, r.polygon)) continue;
                float d = 1e9f;
                for (size_t i = 0; i < r.polygon.size(); ++i) d = std::min(d, distancePointToSegment(c, r.polygon[i], r.polygon[(i + 1) % r.polygon.size()]));
                if (d > bestD) { bestD = d; best = c; }
            }
            r.centroid = best;
        }
        r.kind = classifyFace(r.polygon, r.area, p);
        if (r.kind == RoomKind::Corridor) ++corridors;
        // boundary walls: any wall whose centreline runs along a face edge
        float conf = 1.f;
        for (size_t i = 0; i < r.polygon.size(); ++i) {
            const Vec2 a = r.polygon[i], b = r.polygon[(i + 1) % r.polygon.size()];
            const Vec2 mid = (a + b) * 0.5f;
            for (const auto& w : walls) {
                if (distancePointToSegment(mid, w.a, w.b) > p.snap && distancePointToSegment(a, w.a, w.b) + distancePointToSegment(b, w.a, w.b) > p.snap * 2) continue;
                if (lineAngleDiff(angleOf(b - a), angleOf(w.b - w.a)) > degToRad(p.parallelDeg)) continue;
                if (std::find(r.boundary.begin(), r.boundary.end(), w.id) == r.boundary.end()) r.boundary.push_back(w.id);
                conf = std::min(conf, w.confidence);
                break;
            }
        }
        r.confidence = conf;
        rooms.push_back(std::move(r));
    }
    if (stats) { stats->rooms = static_cast<int>(rooms.size()); stats->corridors = corridors; }
    return rooms;
}

// ---- all together --------------------------------------------------------------------
Result<ReadStats> interpret(const std::vector<vec::Segment>& segments, Level& level, IdGenerator& ids, const ReadParams& p) {
    if (segments.empty()) return Result<ReadStats>::fail("no segments to interpret");
    ReadStats stats;
    stats.inputSegments = static_cast<int>(segments.size());
    level.walls    = pairWalls(segments, ids, p, &stats);
    level.openings.clear();
    bridgeDoorGaps(level.walls, level.openings, ids, p);
    stats.openings = static_cast<int>(level.openings.size());
    level.rooms    = findRooms(level.walls, ids, p, &stats);
    for (auto& w : level.walls) if (w.confidence < 0.7f) ++stats.lowConfidence;
    for (auto& o : level.openings) if (o.confidence < 0.7f) ++stats.lowConfidence;
    for (auto& r : level.rooms) if (r.confidence < 0.7f) ++stats.lowConfidence;
    if (level.rooms.empty()) stats.notes.push_back("no closed rooms found: check the plan has closed wall loops, or lower --snap");
    return stats;
}

} // namespace wf::read
