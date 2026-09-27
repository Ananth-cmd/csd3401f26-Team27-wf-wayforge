// wf_cli - Wayforge headless converter.
//
//   wf_cli --version
//   wf_cli convert plan.svg --scale 1px=0.02m --out building.wfb
//   wf_cli convert plan.png --corners 10,10 900,12 905,700 8,695 --width-metres 24 --out building.wfb --debug out/
//   wf_cli info building.wfb
//   wf_cli graph building.wfb --rebuild
//   wf_cli tag building.wfb r3 E2-05-12 "Lecture Theatre 3" --kind classroom
//   wf_cli route building.wfb --from E2-05-01 --to E2-05-12 [--step-free] [--svg route.svg]
//   wf_cli egress building.wfb --from L1:n4
//   wf_cli svg building.wfb --out debug.svg
//
// Every error names the file, the element and what was expected. "Parse error" is not an error message.
#include "Args.hpp"
#include "DebugSvg.hpp"
#include "wf_core/wf_core.hpp"
#include "wf_doc/wf_doc.hpp"
#include "wf_image/wf_image.hpp"
#include "wf_vector/wf_vector.hpp"
#include "wf_read/wf_read.hpp"
#include "wf_graph/wf_graph.hpp"
#include <iostream>
#include <array>

using namespace wf;
using wf::cli::Args;

namespace {

int usage() {
    std::cout <<
        "Wayforge CLI " << kVersionString << " (" << platformName() << ")\n"
        "usage:\n"
        "  wf_cli --version\n"
        "  wf_cli convert <plan.svg|png|jpg> --out <building.wfb> [options]\n"
        "      --scale 1px=0.02m        metres per input unit (or --metres-per-unit 0.02)\n"
        "      --width-metres 24        alternative: real width of the drawing, scale is derived\n"
        "      --corners x,y x,y x,y x,y   raster only: TL TR BR BL of the drawing, in pixels\n"
        "      --name <building>  --level <id>  --elevation <m>\n"
        "      --threshold-window 15  --threshold-offset 10  --dp-tol 1.5  --snap 0.1  --corner-gap 0.3\n"
        "      --no-straighten  --min-room-area 1.5  --max-door 1.6\n"
        "      --debug <dir>            write every intermediate image / svg\n"
        "  wf_cli info <building.wfb>\n"
        "  wf_cli graph <building.wfb> [--rebuild] [--out <file>]\n"
        "  wf_cli tag <building.wfb> <roomId> <code> [name] [--kind classroom|lab|stair|lift|exit|...]\n"
        "  wf_cli link <building.wfb> <L1:n3> <L2:n7> --kind stair|lift [--step-free] [--cost 12]\n"
        "  wf_cli route <building.wfb> --from <ref|roomCode> --to <ref|roomCode> [--step-free] [--svg out.svg]\n"
        "  wf_cli egress <building.wfb> --from <ref|roomCode> [--step-free] [--svg out.svg]\n"
        "  wf_cli svg <building.wfb> --out <debug.svg> [--level L1]\n";
    return 2;
}

int fail(const std::string& msg) { std::cerr << "error: " << msg << "\n"; return 1; }

Result<Document> openDoc(const std::string& path) {
    if (path.empty()) return Result<Document>::fail("no .wfb file given");
    return Document::load(path);
}

Status writeDebug(const std::string& dir, const std::string& name, const img::Image8& im) {
    if (dir.empty()) return Status::success();
    auto s = img::savePng(im, std::filesystem::path(dir) / name);
    if (s) std::cout << "  debug: " << (std::filesystem::path(dir) / name).string() << "\n";
    return s;
}

std::optional<std::string> resolveNode(const Building& b, const std::string& ref) {
    if (ref.find(':') != std::string::npos) return ref;
    return graph::nodeForRoom(b, ref);
}

// "1px=0.02m" -> 0.02
float parseScale(const std::string& s) {
    const size_t eq = s.find('=');
    if (eq == std::string::npos) return std::strtof(s.c_str(), nullptr);
    const float lhs = std::strtof(s.substr(0, eq).c_str(), nullptr);
    const float rhs = std::strtof(s.substr(eq + 1).c_str(), nullptr);
    return lhs > 0 ? rhs / lhs : 0.f;
}

// ---- convert -------------------------------------------------------------------------
int cmdConvert(const Args& a) {
    const std::string in = a.pos(1);
    const std::string out = a.get("--out");
    if (in.empty()) return fail("convert: missing input file");
    if (out.empty()) return fail("convert: --out <building.wfb> is required");
    if (!io::exists(in)) return fail("convert: input file not found: " + in);
    const std::string debugDir = a.get("--debug");
    const std::string ext = io::lowerExtension(in);

    std::vector<vec::Segment> segs;
    float unitsH = 0.f;                               // input height in input units (for the y flip)
    float pixelsPerMetre = 0.f;
    bool rectified = false;
    int  lineWidthPx = 1;

    if (ext == ".svg") {
        auto svg = vec::importSvg(in);
        if (!svg) return fail(svg.error());
        for (auto& w : svg->warnings) std::cout << "  warning: " << w << "\n";
        std::cout << "  svg: " << svg->segments.size() << " segments, " << svg->ignoredElements << " ignored elements, size "
                  << svg->width << " x " << svg->height << " units\n";
        segs = svg->segments; unitsH = svg->height;
        if (unitsH <= 0.f) unitsH = vec::bounds(segs).max.y;
    } else if (ext == ".png" || ext == ".jpg" || ext == ".jpeg" || ext == ".bmp") {
        auto im = img::load(in);
        if (!im) return fail(im.error());
        std::cout << "  image: " << im->width << " x " << im->height << " px\n";
        img::Image8 grey = std::move(*im);
        if (a.has("--corners")) {
            // --corners takes four "x,y" tokens: the first lands in options, the other three are positional
            std::vector<std::string> toks = { a.get("--corners") };
            for (size_t i = 2; i < a.positional.size(); ++i) toks.push_back(a.positional[i]);
            if (toks.size() < 4) return fail("convert: --corners needs four x,y pairs (TL TR BR BL), got " + std::to_string(toks.size()));
            std::array<Vec2, 4> c;
            for (int i = 0; i < 4; ++i) {
                const size_t comma = toks[static_cast<size_t>(i)].find(',');
                if (comma == std::string::npos) return fail("convert: corner '" + toks[static_cast<size_t>(i)] + "' is not x,y");
                c[static_cast<size_t>(i)] = { std::strtof(toks[static_cast<size_t>(i)].c_str(), nullptr), std::strtof(toks[static_cast<size_t>(i)].c_str() + comma + 1, nullptr) };
            }
            const int w = static_cast<int>(std::round((distance(c[0], c[1]) + distance(c[3], c[2])) * 0.5f));
            const int h = static_cast<int>(std::round((distance(c[0], c[3]) + distance(c[1], c[2])) * 0.5f));
            auto r = img::rectify(grey, c, std::max(w, 8), std::max(h, 8));
            if (!r) return fail(r.error());
            grey = std::move(*r); rectified = true;
            std::cout << "  rectified to " << grey.width << " x " << grey.height << " px\n";
            if (auto s = writeDebug(debugDir, "1_rectified.png", grey); !s) return fail(s.message);
        }
        img::ThresholdParams tp; tp.window = a.getInt("--threshold-window", 15); tp.offset = a.getInt("--threshold-offset", 10);
        img::Image8 bin = img::adaptiveThreshold(grey, tp);
        std::cout << "  threshold: " << img::countInk(bin) << " ink pixels\n";
        if (auto s = writeDebug(debugDir, "2_threshold.png", bin); !s) return fail(s.message);
        img::Image8 sk = vec::thin(bin);
        std::cout << "  skeleton: " << img::countInk(sk) << " pixels\n";
        if (auto s = writeDebug(debugDir, "3_skeleton.png", sk); !s) return fail(s.message);
        auto runs = vec::traceSkeleton(sk);
        segs = vec::fitPolylines(runs, a.getFloat("--dp-tol", 1.5f), 3.f);
        std::cout << "  traced " << runs.size() << " runs -> " << segs.size() << " segments\n";
        // estimate stroke width from ink / skeleton ratio, used for corner closing
        lineWidthPx = std::max(1, static_cast<int>(img::countInk(bin) / std::max<size_t>(1, img::countInk(sk))));
        unitsH = static_cast<float>(grey.height);
    } else {
        return fail("convert: unsupported input type '" + ext + "' (svg, png, jpg, bmp)");
    }
    if (segs.empty()) return fail("convert: no line geometry found in " + in);

    // scale to metres
    float metresPerUnit = 0.f;
    if (a.has("--scale")) metresPerUnit = parseScale(a.get("--scale"));
    else if (a.has("--metres-per-unit")) metresPerUnit = a.getFloat("--metres-per-unit", 0.f);
    else if (a.has("--width-metres")) {
        const Rect bb = vec::bounds(segs);
        metresPerUnit = bb.size().x > 0 ? a.getFloat("--width-metres", 0.f) / bb.size().x : 0.f;
    } else {
        metresPerUnit = ext == ".svg" ? 1.f : 0.02f;
        std::cout << "  warning: no --scale given, assuming " << metresPerUnit << " m per unit\n";
    }
    if (metresPerUnit <= 0.f) return fail("convert: scale must be positive, e.g. --scale 1px=0.02m");
    pixelsPerMetre = 1.f / metresPerUnit;
    segs = vec::scale(segs, metresPerUnit, {}, true, unitsH);        // flip: image y down -> world y up

    vec::CleanParams cp;
    cp.snapDistance = a.getFloat("--snap", 0.1f);
    cp.cornerGap    = a.getFloat("--corner-gap", std::max(0.3f, lineWidthPx * 3.f * metresPerUnit));
    cp.mergeGap     = cp.snapDistance * 1.5f;
    cp.straighten   = !a.has("--no-straighten");
    cp.minLength    = cp.snapDistance * 0.5f;
    segs = vec::clean(segs, cp);
    std::cout << "  clean: " << segs.size() << " segments after merge/snap/straighten\n";

    Building b;
    b.building.name = a.get("--name", std::filesystem::path(in).stem().string());
    b.source.file = std::filesystem::path(in).filename().string();
    b.source.pixelsPerMetre = pixelsPerMetre;
    b.source.rectified = rectified;
    Level level; level.id = a.get("--level", "L1"); level.name = a.get("--level-name", "Level 1"); level.elevation = a.getFloat("--elevation", 0.f);
    IdGenerator ids;
    read::ReadParams rp;
    rp.snap = cp.snapDistance; rp.minRoomArea = a.getFloat("--min-room-area", 1.5f); rp.maxDoorWidth = a.getFloat("--max-door", 1.6f);
    auto st = read::interpret(segs, level, ids, rp);
    if (!st) return fail(st.error());
    b.levels.push_back(std::move(level));
    graph::GraphStats gs = graph::buildGraph(b, ids, {});

    Document doc(std::move(b));
    if (auto s = doc.save(out); !s) return fail(s.message);
    const Level& L = *doc.level(0);
    std::cout << "wrote " << out << "\n"
              << "  walls " << L.walls.size() << " (" << st->pairedWalls << " paired, " << st->singleWalls << " single)"
              << ", openings " << L.openings.size() << ", rooms " << L.rooms.size() << " (" << st->corridors << " corridors)"
              << ", graph " << gs.nodes << " nodes / " << gs.edges << " edges, low confidence " << st->lowConfidence << "\n";
    for (auto& n : st->notes) std::cout << "  note: " << n << "\n";
    if (!debugDir.empty()) {
        auto p = std::filesystem::path(debugDir) / "4_result.svg";
        if (auto s = io::writeText(p, cli::levelToSvg(L)); s) std::cout << "  debug: " << p.string() << "\n";
    }
    return 0;
}

// ---- info ----------------------------------------------------------------------------------
int cmdInfo(const Args& a) {
    auto doc = openDoc(a.pos(1)); if (!doc) return fail(doc.error());
    const Building& b = doc->building();
    std::cout << "building: " << b.building.name << " (version " << b.version << ")\n"
              << "source:   " << (b.source.file.empty() ? "-" : b.source.file) << ", " << b.source.pixelsPerMetre << " px/m"
              << (b.source.rectified ? ", rectified" : "") << "\n"
              << "levels:   " << b.levels.size() << ", links: " << b.links.size() << "\n";
    for (const Level& l : b.levels) {
        int low = 0; for (auto& w : l.walls) if (w.confidence < 0.7f) ++low;
        int tagged = 0; for (auto& r : l.rooms) if (!r.code.empty()) ++tagged;
        std::cout << "  " << l.id << " \"" << l.name << "\" elev " << l.elevation << "m: "
                  << l.walls.size() << " walls (" << low << " low confidence), " << l.openings.size() << " openings, "
                  << l.rooms.size() << " rooms (" << tagged << " tagged), " << l.nodes.size() << " nodes, " << l.edges.size() << " edges\n";
        for (const Room& r : l.rooms)
            std::cout << "     " << r.id << "  " << (r.code.empty() ? "(untagged)" : r.code) << "  " << EnumNames<RoomKind>::names[static_cast<int>(r.kind)]
                      << "  " << r.area << " m2  conf " << r.confidence << "\n";
    }
    return 0;
}

// ---- graph ---------------------------------------------------------------------------------
int cmdGraph(const Args& a) {
    auto doc = openDoc(a.pos(1)); if (!doc) return fail(doc.error());
    IdGenerator ids; ids.bump(100000);
    graph::GraphStats gs = graph::buildGraph(doc->mutableBuilding(), ids, {});
    std::cout << "graph: " << gs.nodes << " nodes, " << gs.edges << " edges, " << gs.isolatedNodes << " isolated\n";
    if (gs.isolatedNodes) std::cout << "  warning: isolated nodes mean a room has no door reaching a corridor\n";
    const std::string out = a.get("--out", a.pos(1));
    if (auto s = doc->save(out); !s) return fail(s.message);
    std::cout << "wrote " << out << "\n";
    return 0;
}

// ---- tag ------------------------------------------------------------------------------------
int cmdTag(const Args& a) {
    auto doc = openDoc(a.pos(1)); if (!doc) return fail(doc.error());
    const std::string roomId = a.pos(2), code = a.pos(3), name = a.pos(4);
    if (roomId.empty() || code.empty()) return fail("tag: usage: tag <file> <roomId> <code> [name] [--kind kind]");
    int levelIdx = -1;
    for (int i = 0; i < doc->levelCount(); ++i) if (doc->level(i)->findRoom(roomId)) levelIdx = i;
    if (levelIdx < 0) return fail("tag: no room '" + roomId + "' in " + a.pos(1) + " (run `info` to list room ids)");
    doc->setRoomCode(levelIdx, roomId, code, name);
    if (a.has("--kind") && !doc->setProperty(levelIdx, ElementKind::Room, roomId, "kind", a.get("--kind")))
        return fail("tag: unknown room kind '" + a.get("--kind") + "'");
    if (auto s = doc->save(a.pos(1)); !s) return fail(s.message);
    std::cout << "tagged " << roomId << " as " << code << (a.has("--kind") ? " (" + a.get("--kind") + ")" : "") << "\n";
    return 0;
}

// ---- link ------------------------------------------------------------------------------------
int cmdLink(const Args& a) {
    auto doc = openDoc(a.pos(1)); if (!doc) return fail(doc.error());
    Link l; l.a = a.pos(2); l.b = a.pos(3);
    if (l.a.empty() || l.b.empty()) return fail("link: usage: link <file> <L1:n3> <L2:n7> --kind stair|lift|ramp");
    if (!setProperty(l, "kind", a.get("--kind", "stair"))) return fail("link: unknown kind '" + a.get("--kind") + "'");
    l.stepFree = a.has("--step-free") || l.kind != LinkKind::Stair;
    l.cost = a.getFloat("--cost", l.kind == LinkKind::Lift ? 25.f : 12.f);
    doc->mutableBuilding().links.push_back(l);
    if (auto s = doc->save(a.pos(1)); !s) return fail(s.message);
    std::cout << "linked " << l.a << " <-> " << l.b << "\n";
    return 0;
}

// ---- route / egress ---------------------------------------------------------------------------
int printRoute(const Document& doc, const Result<graph::Route>& r, const Args& a) {
    if (!r) return fail(r.error());
    std::cout << "route: " << r->steps.size() << " steps, cost " << r->totalCost << (r->stepFree ? ", step-free" : ", uses stairs") << "\n";
    for (auto& s : r->steps)
        std::cout << "  " << s.level << ":" << s.node << "  (" << s.pos.x << ", " << s.pos.y << ")  " << EnumNames<NodeKind>::names[static_cast<int>(s.kind)] << "  " << s.cumulativeCost << "\n";
    if (a.has("--svg")) {
        const Level* l = doc.building().findLevel(r->steps.front().level);
        if (l) { if (auto s = io::writeText(a.get("--svg"), cli::levelToSvg(*l, &r.value())); s) std::cout << "wrote " << a.get("--svg") << "\n"; }
    }
    return 0;
}
int cmdRoute(const Args& a) {
    auto doc = openDoc(a.pos(1)); if (!doc) return fail(doc.error());
    auto from = resolveNode(doc->building(), a.get("--from")); auto to = resolveNode(doc->building(), a.get("--to"));
    if (!from) return fail("route: cannot resolve --from '" + a.get("--from") + "' (use L1:n3 or a room code; run `graph` first)");
    if (!to)   return fail("route: cannot resolve --to '" + a.get("--to") + "'");
    return printRoute(*doc, graph::findRoute(doc->building(), *from, *to, {a.has("--step-free")}), a);
}
int cmdEgress(const Args& a) {
    auto doc = openDoc(a.pos(1)); if (!doc) return fail(doc.error());
    auto from = resolveNode(doc->building(), a.get("--from"));
    if (!from) return fail("egress: cannot resolve --from '" + a.get("--from") + "'");
    return printRoute(*doc, graph::findEgress(doc->building(), *from, {a.has("--step-free")}), a);
}

// ---- svg ----------------------------------------------------------------------------------------
int cmdSvg(const Args& a) {
    auto doc = openDoc(a.pos(1)); if (!doc) return fail(doc.error());
    const Level* l = a.has("--level") ? doc->building().findLevel(a.get("--level")) : doc->level(0);
    if (!l) return fail("svg: no such level");
    const std::string out = a.get("--out", std::filesystem::path(a.pos(1)).replace_extension(".svg").string());
    if (auto s = io::writeText(out, cli::levelToSvg(*l, nullptr, !a.has("--no-graph"))); !s) return fail(s.message);
    std::cout << "wrote " << out << "\n";
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    const Args a = Args::parse(argc, argv, {"--version", "--help", "--rebuild", "--step-free", "--no-straighten", "--no-graph", "--verbose"});
    if (a.has("--verbose")) log::setLevel(log::Level::Debug);
    if (a.has("--version")) { std::cout << "wf_cli " << kVersionString << " (" << platformName() << ")\n"; return 0; }
    if (a.has("--help") || a.positional.empty()) return usage();
    const std::string cmd = a.pos(0);
    try {
        if (cmd == "convert") return cmdConvert(a);
        if (cmd == "info")    return cmdInfo(a);
        if (cmd == "graph")   return cmdGraph(a);
        if (cmd == "tag")     return cmdTag(a);
        if (cmd == "link")    return cmdLink(a);
        if (cmd == "route")   return cmdRoute(a);
        if (cmd == "egress")  return cmdEgress(a);
        if (cmd == "svg")     return cmdSvg(a);
    } catch (const std::exception& e) {
        return fail(std::string("unexpected: ") + e.what());
    }
    std::cerr << "unknown command '" << cmd << "'\n";
    return usage();
}
