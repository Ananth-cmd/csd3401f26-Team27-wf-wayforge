// wf_api console test: exercises the C API the way Unity's NativeBridge will.
#include "wf_api/wf_api.h"
#include <iostream>
#include <vector>
#include <string>
#include <fstream>
#include <filesystem>

static int g_failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "  (" << wf_last_error() << ")\n"; ++g_failures; } } while (0)

int main() {
    CHECK(wf_ping() == 42);
    std::cout << "wayforge " << wf_version() << " on " << wf_platform() << "\n";

    // write a small plan to convert (same 2 rooms + corridor as the other tests)
    auto tmp = std::filesystem::temp_directory_path() / "wf_api_test.svg";
    {
        std::ofstream f(tmp);
        f << "<svg xmlns='http://www.w3.org/2000/svg' width='10' height='8'>"
             "<rect x='0' y='0' width='10' height='8'/>"
             "<line x1='5' y1='0' x2='5' y2='6'/>"
             "<line x1='0' y1='6' x2='2' y2='6'/><line x1='2.9' y1='6' x2='7' y2='6'/><line x1='7.9' y1='6' x2='10' y2='6'/>"
             "</svg>";
    }
    wf_doc d = wf_open_plan(tmp.string().c_str());
    CHECK(d != nullptr);
    if (!d) { std::cerr << wf_last_error() << "\n"; return 1; }

    CHECK(wf_level_count(d) == 1);
    char buf[64];
    CHECK(wf_get_level_id(d, 0, buf, sizeof buf) > 0 && std::string(buf) == "L1");
    const int walls = wf_wall_count(d, 0);
    CHECK(walls >= 5);
    std::vector<float> wbuf(static_cast<size_t>(walls) * 5);
    CHECK(wf_get_walls(d, 0, wbuf.data(), static_cast<int>(wbuf.size())) == walls * 5);
    CHECK(wf_opening_count(d, 0) == 2);
    const int rooms = wf_room_count(d, 0);
    CHECK(rooms == 3);

    // tag rooms, read them back, undo
    float centroid[2], conf;
    CHECK(wf_get_room(d, 0, 0, buf, sizeof buf, centroid, &conf) == 0);
    CHECK(wf_set_room_code(d, 0, 0, "E2-05-12", "Lecture Theatre 3") == 0);
    CHECK(wf_get_room(d, 0, 0, buf, sizeof buf, centroid, &conf) == 0 && std::string(buf) == "E2-05-12");
    CHECK(wf_can_undo(d) == 1);
    CHECK(wf_undo(d) == 0);
    CHECK(wf_get_room(d, 0, 0, buf, sizeof buf, centroid, &conf) == 0 && std::string(buf).empty());
    CHECK(wf_redo(d) == 0);
    CHECK(wf_get_room(d, 0, 0, buf, sizeof buf, centroid, &conf) == 0 && std::string(buf) == "E2-05-12");

    // generic properties, driven by reflection
    CHECK(wf_property_count(0) == 5);
    char pname[32], ptype[16];
    CHECK(wf_property_name(0, 3, pname, sizeof pname, ptype, sizeof ptype) == 0 && std::string(pname) == "thickness" && std::string(ptype) == "float");
    CHECK(wf_get_wall_id(d, 0, 0, buf, sizeof buf) > 0);
    std::string wid = buf;
    CHECK(wf_set_property(d, 0, 0, wid.c_str(), "thickness", "0.42") == 0);
    CHECK(wf_get_property(d, 0, 0, wid.c_str(), "thickness", buf, sizeof buf) > 0 && std::string(buf) == "0.42");
    CHECK(wf_set_property(d, 0, 0, wid.c_str(), "thickness", "thick") != 0);   // bad value, error explains
    CHECK(std::string(wf_last_error()).find("thick") != std::string::npos);

    // add/move/delete a wall
    CHECK(wf_add_wall(d, 0, 20, 20, 25, 20, 0.2f, buf, sizeof buf) == 0);
    std::string nw = buf;
    CHECK(wf_wall_count(d, 0) == walls + 1);
    CHECK(wf_move_wall(d, 0, nw.c_str(), 20, 21, 25, 21) == 0);
    CHECK(wf_delete_wall(d, 0, nw.c_str()) == 0);
    CHECK(wf_delete_wall(d, 0, "w999") != 0);
    CHECK(wf_wall_count(d, 0) == walls);

    // graph + route + egress
    CHECK(wf_build_graph(d) == 0);
    CHECK(wf_node_count(d, 0) > 4 && wf_edge_count(d, 0) > 4);
    char from[32], to[32];
    CHECK(wf_node_for_room(d, "E2-05-12", from, sizeof from) > 0);
    CHECK(wf_get_room_id(d, 0, 1, buf, sizeof buf) > 0);
    std::string otherRoom = buf;
    // make sure "other" is not the corridor
    if (wf_get_room_kind(d, 0, 1) == 5 /*corridor*/) { wf_get_room_id(d, 0, 2, buf, sizeof buf); otherRoom = buf; }
    CHECK(wf_node_for_room(d, otherRoom.c_str(), to, sizeof to) > 0);
    std::vector<float> route(300); float cost = 0;
    const int n = wf_route(d, from, to, 0, route.data(), static_cast<int>(route.size()), &cost);
    CHECK(n >= 9 && n % 3 == 0 && cost > 0);
    CHECK(wf_route(d, from, "L1:nope", 0, route.data(), 300, &cost) < 0);
    CHECK(wf_egress(d, from, 0, route.data(), 300, &cost) < 0);              // no exits tagged yet
    CHECK(wf_set_room_kind(d, 0, wf_get_room_kind(d, 0, 1) == 5 ? 2 : 1, "exit") == 0);
    CHECK(wf_build_graph(d) == 0);
    CHECK(wf_node_for_room(d, "E2-05-12", from, sizeof from) > 0);
    CHECK(wf_egress(d, from, 0, route.data(), 300, &cost) >= 6);
    CHECK(wf_nearest_node(d, "L1", 1, 1, buf, sizeof buf) > 0);

    // app helpers
    char big[2048];
    CHECK(wf_instructions(d, big, sizeof big) >= 2);
    std::cout << "instructions:\n" << big;
    CHECK(wf_search_rooms(d, "e2", big, sizeof big) == 1);
    CHECK(std::string(big).find("E2-05-12") != std::string::npos);
    CHECK(wf_search_rooms(d, "", big, sizeof big) == 2);            // corridor excluded
    char rc[32], rn[64]; int rk; float cen[2];
    CHECK(wf_room_info(d, "E2-05-12", rc, sizeof rc, rn, sizeof rn, &rk, cen) == 0 && std::string(rn) == "Lecture Theatre 3");
    CHECK(wf_add_poi(d, 0, "aed", "Defibrillator", 1, 1) == 0);
    CHECK(wf_pois(d, 0, big, sizeof big) == 1);
    float elev, hgt;
    CHECK(wf_level_info(d, 0, rn, sizeof rn, &elev, &hgt) == 0);
    CHECK(wf_building_name(d, rn, sizeof rn) > 0);

    // save, reopen as .wfb
    auto out = std::filesystem::temp_directory_path() / "wf_api_test.wfb";
    CHECK(wf_save(d, out.string().c_str()) == 0);
    CHECK(wf_is_dirty(d) == 0);
    wf_close(d);
    wf_doc d2 = wf_open_plan(out.string().c_str());
    CHECK(d2 != nullptr);
    if (d2) { CHECK(wf_room_count(d2, 0) == 3); wf_close(d2); }
    CHECK(wf_open_plan("/nope/missing.wfb") == nullptr);
    CHECK(std::string(wf_last_error()).find("missing.wfb") != std::string::npos);
    wf_close(nullptr);                                                            // must be safe

    // raster plan -> building (the Studio "Import image" path)
#ifdef WF_TEST_DATA_DIR
    {
        const std::string scan = std::string(WF_TEST_DATA_DIR) + "/plans/simple_scan.png";
        wf_doc di = wf_convert_image(scan.c_str(), 0.f);           // default scale: 1 px = 2 cm
        CHECK(di != nullptr);
        if (di) {
            CHECK(wf_wall_count(di, 0) >= 10);
            CHECK(wf_opening_count(di, 0) >= 5);
            CHECK(wf_room_count(di, 0) >= 6);
            CHECK(wf_node_count(di, 0) > 0);          // graph is built on import
            std::cout << "image: " << wf_wall_count(di, 0) << " walls, " << wf_opening_count(di, 0) << " openings, "
                      << wf_room_count(di, 0) << " rooms\n";
            wf_close(di);
        }
        wf_doc dj = wf_open_plan(scan.c_str());                   // open_plan accepts images too
        CHECK(dj != nullptr);
        wf_close(dj);
        CHECK(wf_convert_image("/nope/missing.png", 10.f) == nullptr);
    }
#endif

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_api: all checks passed\n";
    return 0;
}
