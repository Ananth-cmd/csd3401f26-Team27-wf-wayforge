/*!
 * \file Convert.cpp
 * \brief Plan image / SVG to Level, and Levels to Building
 *
 * Implementation of Convert.hpp. The numbered steps in convertImage() match
 * the debug image names (1_grey.png ... 6_rooms.png).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Pipeline order for architectural plans (component filtering before thinning,
 *     symbol detection before clean-up, door leaves before interpret)
 *   - Per-step debug images, multi-floor assembly and id renumbering
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_read/Convert.hpp"
#include <algorithm>
#include <cmath>
#include <map>

namespace wf::read {
namespace {

    // Plan metres (y up) to image pixels (y down), for the debug images.
    struct ToPixel {
        float mpp, height;
        Vec2 operator()(const Vec2& p) const noexcept { return { p.x / mpp, height - p.y / mpp }; }
    };

    void saveDebug(const ConvertOptions& opt, ConvertReport* rep, const char* name, const img::Image8& image) {
        if (opt.debugDir.empty()) return;
        const auto path = opt.debugDir / name;
        if (img::savePng(image, path) && rep) rep->debugFiles.push_back(path.string());
    }

    void drawSegments(img::Image8& canvas, const std::vector<vec::Segment>& segs, const ToPixel& px, uint8_t value, int width) {
        for (const auto& s : segs) img::drawLine(canvas, px(s.a), px(s.b), value, width);
    }

    // 6_rooms.png: rooms filled by kind, walls black, openings drawn over in white.
    img::Image8 drawFloor(const Level& level, int w, int h, const ToPixel& px) {
        img::Image8 canvas(w, h, 255);
        for (const Room& r : level.rooms) {
            std::vector<Vec2> poly;
            for (const auto& p : r.polygon) poly.push_back(px(p));
            uint8_t shade = 225;
            if (r.kind == RoomKind::Corridor) shade = 200;
            if (r.kind == RoomKind::Stair)    shade = 150;
            if (r.kind == RoomKind::Lift)     shade = 110;
            img::fillPolygon(canvas, poly, shade);
        }
        for (const Wall& wall : level.walls) img::drawLine(canvas, px(wall.a), px(wall.b), 0, 5);
        for (const Opening& o : level.openings) {
            const Wall* wall = level.findWall(o.wall);
            if (!wall) continue;
            const Vec2 d = wall->direction();
            img::drawLine(canvas, px(wall->a + d * o.offset), px(wall->a + d * (o.offset + o.width)), 255, 7);
        }
        return canvas;
    }

    // Detect and remove lift crosses and stair treads. Images call this before clean(), which
    // would otherwise merge the outer treads into adjacent walls; SVGs call it after.
    void findSymbols(std::vector<vec::Segment>& segs, const ConvertOptions& opt,
                     std::vector<vec::SymbolRegion>& stairs, std::vector<vec::SymbolRegion>& lifts) {
        if (opt.detectLifts)  { auto l = vec::detectLifts(segs);  lifts.insert(lifts.end(), l.begin(), l.end()); }
        if (opt.detectStairs) { auto s = vec::detectStairs(segs); stairs.insert(stairs.end(), s.begin(), s.end()); }
    }

    // Common tail for images and SVGs (segments cleaned, in metres): remove remaining arc pieces
    // and door leaves, interpret walls / openings / rooms, tag stair and lift rooms.
    Result<Level> finishFloor(std::vector<vec::Segment> segs, std::vector<vec::SymbolRegion> stairs, std::vector<vec::SymbolRegion> lifts,
                              IdGenerator& ids, const ConvertOptions& opt, ConvertReport* rep) {
        int diag = 0, leaves = 0;
        // clean() snaps anything within 8 degrees of the grid, so a short segment still 5+ degrees
        // off cannot be an axis-aligned wall.
        if (opt.removeArcs)  segs = vec::removeShortDiagonals(segs, 1.0f, 5.f, &diag);
        if (opt.removeArcs)  segs = vec::removeDoorLeaves(segs, opt.read.minDoorWidth, opt.read.maxDoorWidth, &leaves);
        if (segs.empty()) return Result<Level>::fail("no walls left after removing symbols");

        Level level;
        level.id = opt.levelId;
        std::string number;                                       // digits of the id: "L2" -> "Level 2"
        for (char c : opt.levelId) if (c >= '0' && c <= '9') number += c;
        level.name = !opt.levelName.empty() ? opt.levelName : "Level " + (number.empty() ? opt.levelId : number);
        level.elevation = opt.elevation;
        level.ceilingHeight = opt.ceilingHeight;
        auto stats = interpret(segs, level, ids, opt.read);
        if (!stats) return Result<Level>::fail(stats.error());
        tagSymbolRooms(level, stairs, lifts);

        if (rep) {
            rep->diagonalsRemoved = diag; rep->leavesRemoved = leaves;
            rep->segments = static_cast<int>(segs.size());
            rep->stairs = static_cast<int>(stairs.size()); rep->lifts = static_cast<int>(lifts.size());
            rep->read = *stats;
        }
        return level;
    }

} // namespace

Result<Level> convertImage(const std::filesystem::path& path, IdGenerator& ids, const ConvertOptions& opt, ConvertReport* rep) {
    ConvertReport local;
    ConvertReport* r = rep ? rep : &local;
    if (!opt.debugDir.empty()) if (auto s = io::ensureDirectory(opt.debugDir); !s) return Result<Level>::fail(s.message);

    // 1. load, downscale if larger than maxImageSize
    auto loaded = img::load(path);
    if (!loaded) return Result<Level>::fail(loaded.error());
    img::Image8 grey = std::move(*loaded);
    float shrink = 1.f;
    if (std::max(grey.width, grey.height) > opt.maxImageSize) {
        shrink = static_cast<float>(opt.maxImageSize) / static_cast<float>(std::max(grey.width, grey.height));
        grey = img::resize(grey, std::max(1, static_cast<int>(grey.width * shrink)), std::max(1, static_cast<int>(grey.height * shrink)));
    }
    r->imageWidth = grey.width; r->imageHeight = grey.height;
    // Metres per pixel of the (possibly downscaled) image. widthMetres is refined after fitting.
    float mpp = opt.metresPerPixel > 0.f ? opt.metresPerPixel / shrink
              : opt.widthMetres > 0.f   ? opt.widthMetres / static_cast<float>(grey.width)
              : 0.02f / shrink;
    saveDebug(opt, r, "1_grey.png", grey);

    // 2. threshold; window converted from metres to an odd pixel count
    img::ThresholdParams tp;
    tp.window = std::max(15, static_cast<int>(std::lround(opt.inkWindowMetres / mpp)) | 1);
    img::Image8 ink = img::adaptiveThreshold(grey, tp);
    saveDebug(opt, r, "2_ink.png", ink);

    // 3. remove annotations outside the building, then small components inside it
    if (opt.removeAnnotations) ink = img::keepMainDrawing(ink, &r->annotationsRemoved);
    if (opt.removeText) ink = img::removeSmallBlobs(ink, static_cast<int>(std::lround(opt.maxBlobMetres / mpp)), &r->blobsRemoved);
    saveDebug(opt, r, "3_tidy.png", ink);

    // 4. skeleton and runs. Arcs are not removed at run level: the tracer often joins an arc to
    // the wall stub at its jamb, and dropping the whole run would drop the stub too.
    img::Image8 skel = vec::thin(ink);
    saveDebug(opt, r, "4_skeleton.png", skel);
    const auto runs = vec::traceSkeleton(skel);

    // 5. fit segments, convert to metres (y up), symbols, clean-up
    auto segs = vec::fitPolylines(runs, 1.5f, 3.f);
    if (segs.empty()) return Result<Level>::fail("no lines found in the image");
    if (opt.metresPerPixel <= 0.f && opt.widthMetres > 0.f) {
        const float w = vec::bounds(segs).size().x;                // drawing width, excluding the margin
        if (w > 0.f) mpp = opt.widthMetres / w;
    }
    r->metresPerPixel = mpp;
    segs = vec::scale(segs, mpp, {}, true, static_cast<float>(grey.height));
    std::vector<vec::SymbolRegion> stairs, lifts;
    findSymbols(segs, opt, stairs, lifts);
    // Arcs arrive as many short slanted pieces (split at every junction). Removing them before
    // clean() stops closeCorners() from snapping wall ends onto them.
    if (opt.removeArcs) { int pieces = 0; segs = vec::removeShortDiagonals(segs, 0.6f, 12.f, &pieces); r->arcsRemoved += pieces; }
    segs = vec::clean(segs);
    const ToPixel px{ mpp, static_cast<float>(grey.height) };
    if (!opt.debugDir.empty()) {
        img::Image8 lines(grey.width, grey.height, 255);
        drawSegments(lines, segs, px, 0, 3);
        saveDebug(opt, r, "5_lines.png", lines);
    }

    // 6. door leaves, walls / openings / rooms
    auto level = finishFloor(std::move(segs), std::move(stairs), std::move(lifts), ids, opt, r);
    if (!level) return level;
    if (!opt.debugDir.empty()) saveDebug(opt, r, "6_rooms.png", drawFloor(*level, grey.width, grey.height, px));
    return level;
}

Result<Level> convertSvg(const std::filesystem::path& path, float metresPerUnit, IdGenerator& ids, const ConvertOptions& opt, ConvertReport* rep) {
    ConvertReport local;
    ConvertReport* r = rep ? rep : &local;
    auto svg = vec::importSvg(path);
    if (!svg) return Result<Level>::fail(svg.error());
    const float mpu = metresPerUnit > 0.f ? metresPerUnit : 1.f;
    r->metresPerPixel = mpu;
    auto segs = vec::clean(vec::scale(svg->segments, mpu, {}, true, svg->height));
    std::vector<vec::SymbolRegion> stairs, lifts;
    findSymbols(segs, opt, stairs, lifts);
    return finishFloor(std::move(segs), std::move(stairs), std::move(lifts), ids, opt, r);
}

void tagSymbolRooms(Level& level, const std::vector<vec::SymbolRegion>& stairs, const std::vector<vec::SymbolRegion>& lifts) {
    auto tag = [&](const vec::SymbolRegion& s, RoomKind kind) {
        for (Room& room : level.rooms) {
            if (room.polygon.size() < 3 || !pointInPolygon(s.centre, room.polygon)) continue;
            // A symbol inside a corridor or a large hall does not define the room.
            if (room.kind == RoomKind::Corridor || room.area > 80.f) return;
            room.kind = kind;
            return;
        }
    };
    for (const auto& s : stairs) tag(s, RoomKind::Stair);
    for (const auto& l : lifts)  tag(l, RoomKind::Lift);
}

void renumberLevel(Level& level, IdGenerator& ids) {
    std::map<std::string, std::string> wallIds;
    for (Wall& w : level.walls)       { std::string n = ids.next("w"); wallIds[w.id] = n; w.id = n; }
    for (Opening& o : level.openings) { o.id = ids.next("o"); auto it = wallIds.find(o.wall); if (it != wallIds.end()) o.wall = it->second; }
    for (Room& r : level.rooms) {
        r.id = ids.next("r");
        for (auto& b : r.boundary) { auto it = wallIds.find(b); if (it != wallIds.end()) b = it->second; }
    }
    // Nodes refer to the old room ids; the graph is rebuilt by wf_graph after assembly.
    level.nodes.clear();
    level.edges.clear();
}

Building assembleBuilding(std::vector<Level> floors, const std::string& name) {
    std::stable_sort(floors.begin(), floors.end(), [](const Level& a, const Level& b) { return a.elevation < b.elevation; });
    Building b;
    b.building.name = name;
    IdGenerator ids;
    for (Level& l : floors) { renumberLevel(l, ids); b.levels.push_back(std::move(l)); }
    return b;
}

} // namespace wf::read
