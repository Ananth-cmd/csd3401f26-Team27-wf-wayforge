/*!
 * \file main.cpp (wf_cli)
 * \brief Headless command-line front end to the engine
 *
 * Used by the backend, CI (golden tests) and for manual testing:
 *
 *   wf_cli build    <out.wfb> <L1> <L2> ...   convert floors, stack them, add navigation
 *   wf_cli convert  <plan> <out.wfb>          one image / SVG to a one-level building
 *   wf_cli merge    <out.wfb> <floor.wfb> ... stack converted floors
 *   wf_cli tag      <in.wfb> <room> ...       set a room's kind / code / name
 *   wf_cli graph    <in.wfb>                  rebuild navigation
 *   wf_cli route    <in.wfb> <from> <to>      route as JSON (to = "exit" for egress)
 *   wf_cli info     <in.wfb>                  building summary as JSON
 *   wf_cli debug    <plan> <dir>              convert and write per-step debug images
 *
 * Options are listed by "wf_cli --help". Exit codes: 0 ok, 1 failed, 2 bad usage.
 *
 * Links: wf_read/Convert.hpp (conversion), wf_graph (navigation, routing),
 * wf_doc (load / save). Documented in docs/wf_cli.md.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - build / convert / merge / tag / graph / route / info / debug commands
 *     (replacing the original --version-only stub)
 *   - JSON output for routes and building summaries
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_core/wf_core.hpp"
#include "wf_doc/wf_doc.hpp"
#include "wf_read/Convert.hpp"
#include "wf_graph/wf_graph.hpp"
#include <nlohmann/json.hpp>
#include <algorithm>
#include <iostream>
#include <optional>
#include <string>
#include <vector>

using json = nlohmann::json;
namespace fs = std::filesystem;

namespace {

const char* kHelp = R"(wf_cli - Wayforge engine on the command line

  wf_cli build <out.wfb> <floor1> [floor2 ...]   convert every floor (bottom first), stack them,
                                                 add navigation. The one command for a whole building.
      --name NAME            building name                (default: output file name)
      --floor-height M       metres between floors        (default 3.5)
      --lat DEG --lon DEG --heading DEG   where the building is (for geolocation)
      plus every convert option below

  wf_cli convert <plan.png|jpg|svg> <out.wfb>    one floor
      --level L2             floor id                     (default L1)
      --level-name NAME      floor name shown to users    (default "Level 2")
      --elevation M          height above ground floor    (default 0)
      --ceiling M            floor-to-ceiling height      (default 3)
      --scale M              metres per pixel / SVG unit  (default 0.02, i.e. 1 px = 2 cm)
      --width M              real width of the drawing (sets the scale instead)
      --debug DIR            also save a picture of every step in DIR
      --keep-text --keep-arcs --no-stairs --no-lifts      turn clean-up steps off

  wf_cli merge <out.wfb> <floor.wfb> ...         stack converted floors (sorted by elevation)
      --name NAME  --floor-height M (re-space floors in the given order)

  wf_cli tag <in.wfb> <room> [--kind K] [--code C] [--name N] [-o out.wfb]
      room = room id, room code, or LEVEL:ROOMID.  K = unknown classroom lab office toilet
      corridor stair lift lobby food storage exit

  wf_cli graph <in.wfb> [-o out.wfb]            build paths, mark exits, link stairs / lifts

  wf_cli route <in.wfb> <from> <to> [--step-free]
      from / to = room code, room id, or node ref like L1:n100003.  to = "exit" for nearest exit.
      Prints JSON: points, directions, total cost.

  wf_cli info <in.wfb>                           floors, rooms, doors, links as JSON
  wf_cli debug <plan> <dir>                      convert with a picture of every step
  wf_cli --version | --help

Exit codes: 0 ok, 1 failed, 2 bad usage.
)";

// Positional arguments, "--key value" options and "--flag" switches (listed in kSwitches).
struct Args {
    std::vector<std::string> pos;
    std::vector<std::pair<std::string, std::string>> opts;
    std::vector<std::string> flags;

    Args(int argc, char** argv, const std::vector<std::string>& switches) {
        for (int i = 2; i < argc; ++i) {
            std::string a = argv[i];
            if (a.rfind("--", 0) == 0 || a == "-o") {
                if (std::find(switches.begin(), switches.end(), a) != switches.end()) { flags.push_back(a); continue; }
                if (i + 1 < argc) { opts.emplace_back(a, argv[++i]); continue; }
                flags.push_back(a);
            } else pos.push_back(a);
        }
    }
    std::optional<std::string> get(const std::string& k) const {
        for (auto& [n, v] : opts) if (n == k) return v;
        return std::nullopt;
    }
    float num(const std::string& k, float def) const { auto v = get(k); return v ? std::stof(*v) : def; }
    bool has(const std::string& k) const { return std::find(flags.begin(), flags.end(), k) != flags.end(); }
};

const std::vector<std::string> kSwitches = { "--keep-text", "--keep-arcs", "--no-stairs", "--no-lifts", "--step-free", "--json" };

int fail(const std::string& msg) { std::cerr << "error: " << msg << "\n"; return 1; }
int usage(const std::string& msg) { std::cerr << "usage: " << msg << "\n(run wf_cli --help)\n"; return 2; }

template <class E> std::string enumName(E e) { return wf::EnumNames<E>::names[static_cast<int>(e)]; }
template <class E> std::optional<E> enumFrom(const std::string& s) {
    for (int i = 0; wf::EnumNames<E>::names[i]; ++i) if (s == wf::EnumNames<E>::names[i]) return static_cast<E>(i);
    return std::nullopt;
}

wf::read::ConvertOptions convertOptions(const Args& a) {
    wf::read::ConvertOptions o;
    if (auto v = a.get("--level")) o.levelId = *v;
    if (auto v = a.get("--level-name")) o.levelName = *v;
    o.elevation = a.num("--elevation", 0.f);
    o.ceilingHeight = a.num("--ceiling", 3.f);
    o.metresPerPixel = a.num("--scale", 0.f);
    o.widthMetres = a.num("--width", 0.f);
    if (auto v = a.get("--debug")) o.debugDir = *v;
    o.removeText = !a.has("--keep-text");
    o.removeAnnotations = !a.has("--keep-text");
    o.removeArcs = !a.has("--keep-arcs");
    o.detectStairs = !a.has("--no-stairs");
    o.detectLifts = !a.has("--no-lifts");
    return o;
}

// One floor from a picture or SVG.
wf::Result<wf::Level> convertFloor(const fs::path& plan, wf::IdGenerator& ids, const wf::read::ConvertOptions& o, wf::read::ConvertReport& rep) {
    if (wf::io::lowerExtension(plan) == ".svg")
        return wf::read::convertSvg(plan, o.metresPerPixel > 0.f ? o.metresPerPixel : 1.f, ids, o, &rep);
    return wf::read::convertImage(plan, ids, o, &rep);
}

json reportJson(const wf::Level& l, const wf::read::ConvertReport& r) {
    int corridors = 0, stairs = 0, lifts = 0;
    for (auto& room : l.rooms) {
        corridors += room.kind == wf::RoomKind::Corridor;
        stairs += room.kind == wf::RoomKind::Stair;
        lifts += room.kind == wf::RoomKind::Lift;
    }
    return { {"level", l.id}, {"walls", l.walls.size()}, {"doors", l.openings.size()}, {"rooms", l.rooms.size()},
             {"corridors", corridors}, {"stairRooms", stairs}, {"liftRooms", lifts},
             {"removed", { {"annotations", r.annotationsRemoved}, {"blobs", r.blobsRemoved}, {"arcs", r.arcsRemoved},
                           {"diagonals", r.diagonalsRemoved}, {"doorLeaves", r.leavesRemoved} }},
             {"metresPerPixel", r.metresPerPixel}, {"debugFiles", r.debugFiles} };
}

void printReport(const wf::Level& l, const wf::read::ConvertReport& r) {
    std::cout << l.id << ": " << l.walls.size() << " walls, " << l.openings.size() << " doors, " << l.rooms.size() << " rooms"
              << " (stairs " << r.stairs << ", lifts " << r.lifts << ")"
              << "  | removed: " << r.annotationsRemoved << " annotations, " << r.blobsRemoved << " text/furniture, "
              << r.arcsRemoved << " door-arc pieces, " << r.leavesRemoved << " door leaves\n";
}

std::string stem(const fs::path& p) { return p.stem().string(); }

wf::Result<wf::Building> load(const std::string& path) { return wf::loadBuilding(path); }

int save(const wf::Building& b, const std::string& path) {
    auto s = wf::saveBuilding(b, path);
    if (!s) return fail(s.message);
    return 0;
}

// Room by id, code, or "LEVEL:ROOMID".
wf::Room* findRoom(wf::Building& b, const std::string& ref) {
    const size_t colon = ref.find(':');
    for (auto& l : b.levels) {
        if (colon != std::string::npos && l.id != ref.substr(0, colon)) continue;
        const std::string key = colon == std::string::npos ? ref : ref.substr(colon + 1);
        for (auto& r : l.rooms) if (r.id == key || r.code == key) return &r;
    }
    return nullptr;
}

// A route end: a node ref ("L1:n3") as given, a room on a level ("L1:r43"), otherwise the node
// of a room code / id.
std::optional<std::string> resolveNode(const wf::Building& b, const std::string& s) {
    const size_t colon = s.find(':');
    if (colon != std::string::npos) {
        const wf::Level* l = b.findLevel(s.substr(0, colon));
        const std::string id = s.substr(colon + 1);
        if (l && l->findNode(id)) return s;
        if (l)
            for (const wf::Node& n : l->nodes)
                if (n.room == id && n.kind != wf::NodeKind::Corridor) return l->id + ":" + n.id;
    }
    return wf::graph::nodeForRoom(b, s);
}

bool hasGraph(const wf::Building& b) {
    for (auto& l : b.levels) if (!l.nodes.empty()) return true;
    return false;
}

// ---- commands -------------------------------------------------------------------------

int cmdConvert(const Args& a) {
    if (a.pos.size() < 2) return usage("wf_cli convert <plan> <out.wfb> [options]");
    wf::IdGenerator ids;
    wf::read::ConvertReport rep;
    auto level = convertFloor(a.pos[0], ids, convertOptions(a), rep);
    if (!level) return fail(level.error());
    if (a.has("--json")) std::cout << reportJson(*level, rep).dump(2) << "\n"; else printReport(*level, rep);
    std::vector<wf::Level> floors{ std::move(*level) };
    wf::Building b = wf::read::assembleBuilding(std::move(floors), a.get("--name").value_or(stem(a.pos[0])));
    b.source.file = fs::path(a.pos[0]).filename().string();
    b.source.pixelsPerMetre = rep.metresPerPixel > 0.f ? 1.f / rep.metresPerPixel : 0.f;
    return save(b, a.pos[1]);
}

int cmdDebug(const Args& a) {
    if (a.pos.size() < 2) return usage("wf_cli debug <plan> <dir>");
    wf::read::ConvertOptions o = convertOptions(a);
    o.debugDir = a.pos[1];
    wf::IdGenerator ids;
    wf::read::ConvertReport rep;
    auto level = convertFloor(a.pos[0], ids, o, rep);
    if (!level) return fail(level.error());
    printReport(*level, rep);
    for (auto& f : rep.debugFiles) std::cout << "  " << f << "\n";
    std::vector<wf::Level> floors{ std::move(*level) };
    return save(wf::read::assembleBuilding(std::move(floors), stem(a.pos[0])), (fs::path(a.pos[1]) / "floor.wfb").string());
}

void applyLocation(wf::Building& b, const Args& a) {
    b.building.latitude = a.num("--lat", b.building.latitude);
    b.building.longitude = a.num("--lon", b.building.longitude);
    b.building.heading = a.num("--heading", b.building.heading);
}

int cmdBuild(const Args& a) {
    if (a.pos.size() < 2) return usage("wf_cli build <out.wfb> <floor1> [floor2 ...] [options]");
    const float floorHeight = a.num("--floor-height", 3.5f);
    std::vector<wf::Level> floors;
    json summary = json::array();
    wf::IdGenerator ids;
    for (size_t i = 1; i < a.pos.size(); ++i) {
        wf::read::ConvertOptions o = convertOptions(a);
        o.levelId = "L" + std::to_string(i);
        o.levelName.clear();
        o.elevation = floorHeight * static_cast<float>(i - 1);
        if (!o.debugDir.empty()) o.debugDir /= o.levelId;
        wf::read::ConvertReport rep;
        auto level = convertFloor(a.pos[i], ids, o, rep);
        if (!level) return fail(a.pos[i] + ": " + level.error());
        if (!a.has("--json")) printReport(*level, rep);
        summary.push_back(reportJson(*level, rep));
        floors.push_back(std::move(*level));
    }
    wf::Building b = wf::read::assembleBuilding(std::move(floors), a.get("--name").value_or(stem(a.pos[0])));
    applyLocation(b, a);
    const auto nav = wf::graph::prepareNavigation(b);
    if (a.has("--json"))
        std::cout << json{ {"floors", summary}, {"nodes", nav.graph.nodes}, {"edges", nav.graph.edges}, {"exits", nav.exits}, {"links", nav.links} }.dump(2) << "\n";
    else
        std::cout << "navigation: " << nav.graph.nodes << " points, " << nav.graph.edges << " paths, "
                  << nav.exits << " exits, " << nav.links << " stair/lift links between floors\n";
    return save(b, a.pos[0]);
}

int cmdMerge(const Args& a) {
    if (a.pos.size() < 2) return usage("wf_cli merge <out.wfb> <floor.wfb> ...");
    std::vector<wf::Level> floors;
    for (size_t i = 1; i < a.pos.size(); ++i) {
        auto b = load(a.pos[i]);
        if (!b) return fail(a.pos[i] + ": " + b.error());
        for (auto& l : b->levels) floors.push_back(std::move(l));
    }
    if (auto h = a.get("--floor-height")) {
        // Re-space floors in the order given, and give them L1, L2, ... ids.
        for (size_t i = 0; i < floors.size(); ++i) {
            floors[i].elevation = std::stof(*h) * static_cast<float>(i);
            floors[i].id = "L" + std::to_string(i + 1);
            floors[i].name = "Level " + std::to_string(i + 1);
        }
    }
    wf::Building b = wf::read::assembleBuilding(std::move(floors), a.get("--name").value_or(stem(a.pos[0])));
    applyLocation(b, a);
    std::cout << "merged " << b.levels.size() << " floors\n";
    return save(b, a.pos[0]);
}

int cmdTag(const Args& a) {
    if (a.pos.size() < 2) return usage("wf_cli tag <in.wfb> <room> [--kind K] [--code C] [--name N] [-o out.wfb]");
    auto b = load(a.pos[0]);
    if (!b) return fail(b.error());
    wf::Room* r = findRoom(*b, a.pos[1]);
    if (!r) return fail("no room '" + a.pos[1] + "'");
    if (auto k = a.get("--kind")) {
        auto kind = enumFrom<wf::RoomKind>(*k);
        if (!kind) return fail("unknown room kind '" + *k + "'");
        r->kind = *kind;
    }
    if (auto c = a.get("--code")) r->code = *c;
    if (auto n = a.get("--name")) r->name = *n;
    std::cout << r->id << ": code '" << r->code << "', name '" << r->name << "', kind " << enumName(r->kind) << "\n";
    return save(*b, a.get("-o").value_or(a.pos[0]));
}

int cmdGraph(const Args& a) {
    if (a.pos.empty()) return usage("wf_cli graph <in.wfb> [-o out.wfb]");
    auto b = load(a.pos[0]);
    if (!b) return fail(b.error());
    const auto nav = wf::graph::prepareNavigation(*b);
    std::cout << nav.graph.nodes << " points, " << nav.graph.edges << " paths, " << nav.graph.isolatedNodes << " unreachable, "
              << nav.exits << " exits, " << nav.links << " floor links\n";
    return save(*b, a.get("-o").value_or(a.pos[0]));
}

int cmdRoute(const Args& a) {
    if (a.pos.size() < 3) return usage("wf_cli route <in.wfb> <from> <to> [--step-free]");
    auto loaded = load(a.pos[0]);
    if (!loaded) return fail(loaded.error());
    wf::Building& b = *loaded;
    if (!hasGraph(b)) wf::graph::prepareNavigation(b);              // file saved without navigation
    auto out = [](const json& j, int code) { std::cout << j.dump(2) << "\n"; return code; };

    const auto from = resolveNode(b, a.pos[1]);
    if (!from) return out({ {"ok", false}, {"error", "unknown start '" + a.pos[1] + "'"} }, 1);
    wf::graph::RouteOptions opt; opt.stepFreeOnly = a.has("--step-free");
    wf::Result<wf::graph::Route> route = wf::Result<wf::graph::Route>::fail("");
    if (a.pos[2] == "exit") route = wf::graph::findEgress(b, *from, opt);
    else {
        const auto to = resolveNode(b, a.pos[2]);
        if (!to) return out({ {"ok", false}, {"error", "unknown destination '" + a.pos[2] + "'"} }, 1);
        route = wf::graph::findRoute(b, *from, *to, opt);
    }
    if (!route) return out({ {"ok", false}, {"error", route.error()} }, 1);

    json steps = json::array(), dirs = json::array();
    for (const auto& s : route->steps) {
        const wf::Level* l = b.findLevel(s.level);
        steps.push_back({ {"level", s.level}, {"node", s.node}, {"x", s.pos.x}, {"y", s.pos.y},
                          {"z", l ? l->elevation : 0.f}, {"kind", enumName(s.kind)} });
    }
    for (const auto& ins : wf::graph::instructions(b, *route))
        dirs.push_back({ {"text", ins.text}, {"level", ins.level}, {"x", ins.pos.x}, {"y", ins.pos.y}, {"distance", ins.distanceToNext} });
    return out({ {"ok", true}, {"from", *from}, {"to", route->steps.back().level + ":" + route->steps.back().node},
                 {"totalCost", route->totalCost}, {"stepFree", route->stepFree}, {"steps", steps}, {"directions", dirs} }, 0);
}

int cmdInfo(const Args& a) {
    if (a.pos.empty()) return usage("wf_cli info <in.wfb>");
    auto b = load(a.pos[0]);
    if (!b) return fail(b.error());
    json levels = json::array();
    for (const auto& l : b->levels) {
        json rooms = json::array();
        for (const auto& r : l.rooms)
            rooms.push_back({ {"id", r.id}, {"code", r.code}, {"name", r.name}, {"kind", enumName(r.kind)},
                              {"area", r.area}, {"x", r.centroid.x}, {"y", r.centroid.y} });
        levels.push_back({ {"id", l.id}, {"name", l.name}, {"elevation", l.elevation}, {"walls", l.walls.size()},
                           {"doors", l.openings.size()}, {"nodes", l.nodes.size()}, {"rooms", rooms} });
    }
    json links = json::array();
    for (const auto& k : b->links) links.push_back({ {"a", k.a}, {"b", k.b}, {"kind", enumName(k.kind)}, {"stepFree", k.stepFree} });
    std::cout << json{ {"name", b->building.name}, {"latitude", b->building.latitude}, {"longitude", b->building.longitude},
                       {"heading", b->building.heading}, {"levels", levels}, {"links", links} }.dump(2) << "\n";
    return 0;
}

} // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::cout << kHelp; return 2; }
    const std::string cmd = argv[1];
    if (cmd == "--version") { std::cout << "wf_cli " << wf::kVersionString << " (" << wf::platformName() << ")\n"; return 0; }
    if (cmd == "--help" || cmd == "-h" || cmd == "help") { std::cout << kHelp; return 0; }
    const Args a(argc, argv, kSwitches);
    try {
        if (cmd == "convert") return cmdConvert(a);
        if (cmd == "build")   return cmdBuild(a);
        if (cmd == "merge")   return cmdMerge(a);
        if (cmd == "tag")     return cmdTag(a);
        if (cmd == "graph")   return cmdGraph(a);
        if (cmd == "route")   return cmdRoute(a);
        if (cmd == "info")    return cmdInfo(a);
        if (cmd == "debug")   return cmdDebug(a);
    } catch (const std::exception& e) {
        return fail(e.what());                                        // std::stof on a bad number
    }
    std::cerr << "unknown command '" << cmd << "'\n" << kHelp;
    return 2;
}
