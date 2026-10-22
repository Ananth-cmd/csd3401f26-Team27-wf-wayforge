/*!
 * \file read.cpp
 * \brief the steps that turn lines into walls, doors, windows and rooms
 *
 * pairWalls      - pairs up lines side by side into thick walls
 * bridgeDoorGaps - joins 2 walls with a door sized gap + adds a door
 * findRooms      - every closed loop of walls becomes a room
 * interpret() runs all 3 in order.
 *
 * detectWindows() samples the ink across each wall every 5 cm. A sample is a
 * window sample if it crosses 3 or more separate ink lines (frame and glass
 * lines), or if the wall is drawn solid and the ink there is under 45% of the
 * wall's usual thickness. Outer walls use at least the thickness of the
 * floor's outer walls (75th percentile). Runs of window samples 0.5-5 m long
 * that do not overlap a door become Window openings. Door openings in a solid
 * wall whose gap is mostly crossed by thin lines are classed as windows; on
 * outer walls, those whose gap is almost entirely filled with ink as thick as
 * the wall are removed.
 *
 * addAssumedWindows() places evenly spaced windows on outside walls (a room
 * on one side only) without windows, with confidence 0.3.
 *
 * Both are called by convertImage (Convert.cpp) after the rooms are found;
 * wf_graph::lineOfSight ignores windows.
 *
 * \author Katie Lim
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Katie Lim 55%, Ananthan Elangovan 45%
 *   Katie Lim
 *   - all 3 steps and interpret()
 *   - confidence scores so unsure stuff can be checked by hand
 *   Ananthan Elangovan
 *   - Window detection from ink profiles across walls; door / window classification of wall gaps
 *   - Assumed windows on outside walls
 *
 * AI declaration: used Claude to help write and debug the code and comments (Katie Lim).
 * Claude Opus was used as a support tool for debugging and build infrastructure (Ananthan Elangovan).
 *
 * \date 2026-09-10, 2026-10-19
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_read/wf_read.hpp"
#include "wf_read/Convert.hpp"
#include <algorithm>
#include <cmath>

namespace wf::read {
namespace {

// where a line starts and ends along direction d (from origin).
// used to check how much 2 lines overlap
std::pair<float, float> project(const vec::Segment& s, const Vec2& origin, const Vec2& d) {
    const float t0 = dot(s.a - origin, d), t1 = dot(s.b - origin, d);
    return { std::min(t0, t1), std::max(t0, t1) };
}
// same thing for a wall
std::pair<float, float> project(const Wall& w, const Vec2& origin, const Vec2& d) {
    const float t0 = dot(w.a - origin, d), t1 = dot(w.b - origin, d);
    return { std::min(t0, t1), std::max(t0, t1) };
}

} // namespace

// 1. walls
// walls are usually drawn as 2 lines side by side. find the pairs and turn each
// into 1 wall down the middle, as thick as the gap
std::vector<Wall> pairWalls(const std::vector<vec::Segment>& segs, IdGenerator& ids, const ReadParams& p, ReadStats* stats) {
    const float angTol = degToRad(p.parallelDeg);
    std::vector<uint8_t> used(segs.size(), 0);   // 1 = already used in a wall
    std::vector<Wall> walls;
    int paired = 0, single = 0;

    for (size_t i = 0; i < segs.size(); ++i) {
        if (used[i]) continue;
        const vec::Segment& A = segs[i];
        const Vec2 d = A.direction(), n = perp(d);   // d = along the line, n = across
        // find the best partner for A
        int   bestJ = -1; float bestScore = -1.f, bestDist = 0.f; std::pair<float, float> bestOverlap{};
        for (size_t j = i + 1; j < segs.size(); ++j) {
            if (used[j]) continue;
            const vec::Segment& B = segs[j];
            if (lineAngleDiff(A.angle(), B.angle()) > angTol) continue;     // not parallel
            const float dist = std::abs(dot(B.centre() - A.a, n));       // how far apart they are
            if (dist < p.minThickness || dist > p.maxThickness) continue;  // too close / too far to be 1 wall
            const auto pa = project(A, A.a, d), pb = project(B, A.a, d);
            const float lo = std::max(pa.first, pb.first), hi = std::min(pa.second, pb.second);
            if (hi - lo < std::min(A.length(), B.length()) * 0.5f) continue;   // need to overlap at least half the shorter one
            const float score = (hi - lo) / std::max(A.length(), B.length());   // more overlap = better
            if (score > bestScore) { bestScore = score; bestJ = static_cast<int>(j); bestDist = dist; bestOverlap = { std::min(pa.first, pb.first), std::max(pa.second, pb.second) }; }
        }
        if (bestJ >= 0) {
            // found one, make a wall halfway between them
            const vec::Segment& B = segs[static_cast<size_t>(bestJ)];
            used[i] = used[static_cast<size_t>(bestJ)] = 1;
            const float side = dot(B.centre() - A.a, n) > 0 ? 1.f : -1.f;   // which side of A it is
            const Vec2 origin = A.a + n * (side * bestDist * 0.5f);           // point on the middle line
            Wall w; w.id = ids.next("w");
            w.a = origin + d * bestOverlap.first; w.b = origin + d * bestOverlap.second;
            w.thickness = bestDist;
            w.confidence = std::min(1.f, 0.7f + 0.3f * bestScore);
            walls.push_back(w);
            ++paired;
        }
    }
    // lines with no partner. if most of the plan is single lines then these are the walls.
    // if most came in pairs then a single line is prob furniture or a measurement line.
    // keep them anyway with a low score so the user can decide
    const bool doubleLinePlan = paired * 2 > static_cast<int>(segs.size()) / 2;
    for (size_t i = 0; i < segs.size(); ++i) {
        if (used[i]) continue;
        Wall w; w.id = ids.next("w"); w.a = segs[i].a; w.b = segs[i].b;
        w.thickness = p.defaultThickness;
        // really short lines (text, arrows etc) are almost never walls
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

// 2. doors
// 2 walls in a line with a door sized gap = 1 wall with a door
void bridgeDoorGaps(std::vector<Wall>& walls, std::vector<Opening>& openings, IdGenerator& ids, const ReadParams& p) {
    const float angTol = degToRad(p.parallelDeg);
    bool changed = true;
    int guard = 0;   // just in case it loops forever
    // join 1 pair each round and start again till nothing else joins
    while (changed && guard++ < 100) {
        changed = false;
        for (size_t i = 0; i < walls.size() && !changed; ++i) {
            for (size_t j = i + 1; j < walls.size(); ++j) {
                Wall& A = walls[i]; Wall& B = walls[j];
                if (lineAngleDiff(angleOf(A.b - A.a), angleOf(B.b - B.a)) > angTol) continue;   // not parallel
                const Vec2 d = A.direction();
                // gap between the end of 1 wall and start of the other
                const auto pa = project(A, A.a, d), pb = project(B, A.a, d);
                float gap, gapStart;
                if (pb.first >= pa.second) { gap = pb.first - pa.second; gapStart = pa.second; }
                else if (pa.first >= pb.second) { gap = pa.first - pb.second; gapStart = pb.second; }
                else continue;                                             // overlapping, no gap
                // the 2 ends facing each other across the gap have to be on the other wall's line
                // (far ends drift too much on long walls that are slightly off parallel)
                const auto nearest = [](const Wall& w, const Vec2& to) { return distance(w.a, to) < distance(w.b, to) ? w.a : w.b; };
                const Vec2 endA = nearest(A, (B.a + B.b) * 0.5f), endB = nearest(B, (A.a + A.b) * 0.5f);
                if (distancePointToLine(endB, A.a, A.b) > p.collinearTol || distancePointToLine(endA, B.a, B.b) > p.collinearTol) continue;
                if (gap < p.minDoorWidth || gap > p.maxDoorWidth) continue;   // too small / too big for a door
                // join into 1 wall from first end to last end
                const float lo = std::min(pa.first, pb.first), hi = std::max(pa.second, pb.second);
                Wall merged = A;
                merged.a = A.a + d * lo; merged.b = A.a + d * hi;
                merged.thickness = (A.thickness + B.thickness) * 0.5f;
                merged.confidence = std::min(A.confidence, B.confidence);
                // doors already on A or B move onto the joined wall
                for (auto& o : openings) {
                    if (o.wall == B.id) {
                        const float along = dot(B.a - A.a, d) + o.offset * (dot(B.direction(), d) > 0 ? 1.f : -1.f);
                        o.wall = merged.id; o.offset = along - lo;
                    } else if (o.wall == A.id) {
                        o.offset -= lo;                                    // wall starts lo earlier now
                    }
                }
                // new door goes in the gap
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
    // give 0 length walls a tiny length so nothing divides by 0 later
    for (auto& w : walls) if (w.length() < 1e-5f) w.b = w.a + Vec2{0.01f, 0.f};
}

// 3. rooms
// corridor check: long and thin, or big but only fills a bit of its box
RoomKind classifyFace(const std::vector<Vec2>& poly, float area, const ReadParams& p) {
    const Rect r = polygonBounds(poly);
    const Vec2 s = r.size();
    const float longSide = std::max(s.x, s.y), shortSide = std::max(std::min(s.x, s.y), 1e-4f);
    const float fill = area / std::max(s.x * s.y, 1e-4f);   // how much of the box it fills
    if (longSide / shortSide >= p.corridorAspect || (fill < 0.45f && longSide > 6.f)) return RoomKind::Corridor;
    return RoomKind::Unknown;
}

// every closed loop of walls = a room
std::vector<Room> findRooms(const std::vector<Wall>& walls, IdGenerator& ids, const ReadParams& p, ReadStats* stats) {
    // join walls where they meet, remove loose ends, then find closed shapes
    std::vector<vec::Segment> centrelines;
    centrelines.reserve(walls.size());
    for (const auto& w : walls) { vec::Segment s; s.a = w.a; s.b = w.b; s.confidence = w.confidence; centrelines.push_back(s); }
    vec::PlanarGraph g = vec::pruneDanglingEdges(vec::buildPlanarGraph(centrelines, p.snap));
    std::vector<vec::Face> faces = vec::findFaces(g);
    std::sort(faces.begin(), faces.end(), [](const vec::Face& x, const vec::Face& y) {
        const Vec2 cx = polygonCentroid(x.points), cy = polygonCentroid(y.points);
        return cy.y != cx.y ? cy.y < cx.y : cx.x < cy.x;                  // same order every time, top to bottom then left to right
    });

    std::vector<Room> rooms;
    int corridors = 0;
    for (const auto& f : faces) {
        if (f.area < p.minRoomArea) continue;   // too small
        Room r; r.id = ids.next("r");
        r.polygon = f.points;
        r.area = f.area;
        r.centroid = polygonCentroid(r.polygon);
        if (!pointInPolygon(r.centroid, r.polygon)) {
            // for L / U rooms the centre can end up outside the room.
            // so try a 9x9 grid and pick the point furthest from the walls
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
        // save which walls go around the room. room is only as sure as its least sure wall
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

// all together
// walls -> doors -> rooms on 1 level, and count what was found
Result<ReadStats> interpret(const std::vector<vec::Segment>& segments, Level& level, IdGenerator& ids, const ReadParams& p) {
    if (segments.empty()) return Result<ReadStats>::fail("no segments to interpret");
    ReadStats stats;
    stats.inputSegments = static_cast<int>(segments.size());
    level.walls    = pairWalls(segments, ids, p, &stats);
    level.openings.clear();
    bridgeDoorGaps(level.walls, level.openings, ids, p);
    stats.openings = static_cast<int>(level.openings.size());
    level.rooms    = findRooms(level.walls, ids, p, &stats);
    // count everything its unsure about
    for (auto& w : level.walls) if (w.confidence < 0.7f) ++stats.lowConfidence;
    for (auto& o : level.openings) if (o.confidence < 0.7f) ++stats.lowConfidence;
    for (auto& r : level.rooms) if (r.confidence < 0.7f) ++stats.lowConfidence;
    if (level.rooms.empty()) stats.notes.push_back("no closed rooms found: check the plan has closed wall loops, or lower --snap");
    return stats;
}

// --- windows ------------------------------------------------------------------------------

namespace {

    struct Profile { int runs = 0; float longest = 0.f; };

    // Ink lines crossed by the line through c along n, from -reach to +reach metres.
    Profile profileAt(const img::Image8& ink, float mpp, Vec2 c, Vec2 n, float reach) {
        Profile p;
        const float H = static_cast<float>(ink.height);
        const float step = mpp * 0.7f;
        bool inRun = false;
        float runStart = 0.f;
        for (float t = -reach; t <= reach + 1e-4f; t += step) {
            const Vec2 q = c + n * t;
            const int x = static_cast<int>(q.x / mpp), y = static_cast<int>(H - q.y / mpp);
            const bool on = ink.inside(x, y) && ink.at(x, y) < 128;
            if (on && !inRun) { inRun = true; runStart = t; }
            if ((!on || t + step > reach + 1e-4f) && inRun) {
                inRun = false; ++p.runs;
                p.longest = std::max(p.longest, t - runStart);
            }
        }
        return p;
    }

    bool overlapsOpening(const Level& level, const Wall& w, float s0, float s1, float margin) {
        for (const Opening& o : level.openings)
            if (o.wall == w.id && s0 < o.offset + o.width + margin && s1 > o.offset - margin) return true;
        return false;
    }

    bool hasWindow(const Level& level, const Wall& w, float s0, float s1) {
        for (const Opening& o : level.openings)
            if (o.wall == w.id && o.type == OpeningType::Window && s0 < o.offset + o.width && s1 > o.offset) return true;
        return false;
    }

    bool insideAnyRoom(const Level& level, Vec2 p) {
        for (const Room& r : level.rooms)
            if (r.polygon.size() >= 3 && pointInPolygon(p, r.polygon)) return true;
        return false;
    }

    const Room* roomAt(const Level& level, Vec2 p) {
        for (const Room& r : level.rooms)
            if (r.polygon.size() >= 3 && pointInPolygon(p, r.polygon)) return &r;
        return nullptr;
    }

    // True when the wall has a room on one side of its midpoint only, probed 0.3, 0.7 and 1.2 m
    // past each face.
    bool outerWall(const Level& level, const Wall& w) {
        const Vec2 d = w.direction(), n{ -d.y, d.x }, mid = (w.a + w.b) * 0.5f;
        auto roomOn = [&](float sign) {
            for (float t : { 0.3f, 0.7f, 1.2f })
                if (insideAnyRoom(level, mid + n * (sign * (w.thickness * 0.5f + t)))) return true;
            return false;
        };
        return roomOn(1.f) != roomOn(-1.f);
    }

    // Value at fraction q (0..1) of the sorted values; 0 when empty.
    float quantile(std::vector<float> v, float q) {
        if (v.empty()) return 0.f;
        const size_t k = std::min(v.size() - 1, static_cast<size_t>(q * static_cast<float>(v.size())));
        std::nth_element(v.begin(), v.begin() + k, v.end());
        return v[k];
    }

    Opening makeWindow(IdGenerator& ids, const Wall& w, float offset, float width, const WindowParams& p, float confidence) {
        Opening o;
        o.id = ids.next("o");
        o.wall = w.id;
        o.type = OpeningType::Window;
        o.offset = offset;
        o.width = width;
        o.sill = p.sill;
        o.height = p.height;
        o.confidence = confidence;
        return o;
    }

} // namespace

int detectWindows(Level& level, const img::Image8& ink, float mpp, IdGenerator& ids, const WindowParams& p) {
    const float step = 0.05f;
    auto reachOf = [](const Wall& w) { return std::max(0.35f, w.thickness + 0.15f); };

    // Usual ink thickness per wall (median of the longest run per sample) and of the floor's outer
    // walls (75th percentile over all their samples).
    std::vector<std::vector<Profile>> profiles(level.walls.size());
    std::vector<float> usualOf(level.walls.size(), 0.f);
    std::vector<bool> outer(level.walls.size(), false);
    std::vector<float> outerSamples;
    for (size_t k = 0; k < level.walls.size(); ++k) {
        const Wall& w = level.walls[k];
        const float len = w.length();
        if (len < 0.1f) continue;
        const Vec2 d = w.direction(), n{ -d.y, d.x };
        auto& prof = profiles[k];
        for (float s = 0.f; s <= len; s += step) prof.push_back(profileAt(ink, mpp, w.a + d * s, n, reachOf(w)));
        std::vector<float> longest;
        for (const auto& q : prof) if (q.runs > 0) longest.push_back(q.longest);
        usualOf[k] = quantile(longest, 0.5f);
        outer[k] = outerWall(level, w);
        if (outer[k]) outerSamples.insert(outerSamples.end(), longest.begin(), longest.end());
    }
    const float outerUsual = quantile(outerSamples, 0.75f);

    std::vector<Opening> found;
    int converted = 0;
    for (size_t k = 0; k < level.walls.size(); ++k) {
        const Wall& w = level.walls[k];
        const float len = w.length();
        if (len < p.minWidth || usualOf[k] <= 0.f) continue;
        const Vec2 d = w.direction(), n{ -d.y, d.x };
        const float reach = reachOf(w);
        const auto& prof = profiles[k];
        // Reference thickness: at least the floor's outer wall thickness for outer walls.
        const float usual = outer[k] ? std::max(usualOf[k], outerUsual) : usualOf[k];
        const bool solid = usual >= p.solidWall;

        auto isWindow = [&](const Profile& q) {
            if (q.runs >= 3) return true;
            return solid && q.runs >= 1 && q.longest < usual * 0.45f;
        };
        // Door openings in a solid wall: classed as windows when at least 60% of the samples are
        // thin; on outer walls, removed when at least 80% are filled to the wall thickness.
        std::vector<std::string> filled;
        if (solid)
            for (Opening& o : level.openings) {
                if (o.wall != w.id || o.type != OpeningType::Door) continue;
                int thin = 0, full = 0, total = 0;
                for (float s = o.offset; s <= o.offset + o.width; s += step, ++total) {
                    const Profile q = profileAt(ink, mpp, w.a + d * s, n, reach);
                    if (q.runs >= 2 || (q.runs >= 1 && q.longest < usual * 0.45f)) ++thin;
                    else if (q.runs >= 1 && q.longest >= usual * 0.8f) ++full;
                }
                if (total > 0 && thin >= total * 0.6f) {
                    o.type = OpeningType::Window; o.sill = p.sill; o.height = p.height;
                    ++converted;
                } else if (outer[k] && total > 0 && full >= total * 0.8f) {
                    filled.push_back(o.id);
                }
            }
        std::erase_if(level.openings, [&](const Opening& o) { return std::find(filled.begin(), filled.end(), o.id) != filled.end(); });
        // Runs of window samples, allowing single-sample breaks.
        size_t i = 0;
        while (i < prof.size()) {
            if (!isWindow(prof[i])) { ++i; continue; }
            size_t j = i;
            while (j + 1 < prof.size() && (isWindow(prof[j + 1]) || (j + 2 < prof.size() && isWindow(prof[j + 2])))) ++j;
            const float s0 = static_cast<float>(i) * step, s1 = static_cast<float>(j + 1) * step;
            if (s1 - s0 >= p.minWidth && s1 - s0 <= p.maxWidth && !overlapsOpening(level, w, s0, s1, 0.2f))
                found.push_back(makeWindow(ids, w, s0, std::min(s1, len) - s0, p, 0.8f));
            i = j + 1;
        }
    }
    level.openings.insert(level.openings.end(), found.begin(), found.end());
    return static_cast<int>(found.size()) + converted;
}

int addAssumedWindows(Level& level, IdGenerator& ids, const WindowParams& p) {
    const float step = 0.25f;
    std::vector<Opening> added;
    for (const Wall& w : level.walls) {
        const float len = w.length();
        if (len < p.assumedWidth + 1.f) continue;
        const Vec2 d = w.direction(), n{ -d.y, d.x };
        const float probe = w.thickness * 0.5f + 0.3f;
        // Stretches of the wall with a room on one side only (an outside wall).
        auto outside = [&](float s) {
            const Vec2 c = w.a + d * s;
            const Vec2 l = c + n * probe, r = c - n * probe;
            const bool inL = insideAnyRoom(level, l), inR = insideAnyRoom(level, r);
            if (inL == inR) return false;
            const Room* room = roomAt(level, inL ? l : r);
            return room && room->kind != RoomKind::Stair && room->kind != RoomKind::Lift;
        };
        float s = 0.f;
        while (s < len) {
            if (!outside(s)) { s += step; continue; }
            float e = s;
            while (e + step <= len && outside(e + step)) e += step;
            // Evenly spaced windows inside [s, e], away from the stretch ends.
            const float start = s + p.assumedMargin, end = e - p.assumedMargin;
            const float pitch = p.assumedWidth + p.assumedGap;
            const int count = end - start >= p.assumedWidth ? static_cast<int>((end - start + p.assumedGap) / pitch) : 0;
            if (count > 0 && !hasWindow(level, w, s, e)) {
                const float used = count * pitch - p.assumedGap;
                const float first = start + (end - start - used) * 0.5f;
                for (int k = 0; k < count; ++k) {
                    const float o = first + k * pitch;
                    if (!overlapsOpening(level, w, o, o + p.assumedWidth, 0.3f))
                        added.push_back(makeWindow(ids, w, o, p.assumedWidth, p, 0.3f));
                }
            }
            s = e + step;
        }
    }
    level.openings.insert(level.openings.end(), added.begin(), added.end());
    return static_cast<int>(added.size());
}

} // namespace wf::read
