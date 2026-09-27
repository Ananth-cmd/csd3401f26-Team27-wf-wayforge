// wf_doc console test: property system, undo/redo with coalescing, JSON round trip.
#include "wf_doc/wf_doc.hpp"
#include <iostream>
#include <thread>

static int g_failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << "  " #cond "\n"; ++g_failures; } } while (0)

int main() {
    using namespace wf;

    // --- property system: print every field of a Wall without a Wall-specific printer
    Wall w; w.id = "w1"; w.a = {0, 0}; w.b = {12.4f, 0}; w.thickness = 0.2f;
    std::cout << describe(w) << "\n";
    CHECK(propertiesOf<Wall>().size() == 5);
    CHECK(std::get<float>(getProperty(w, "thickness")) == 0.2f);
    CHECK(setProperty(w, "thickness", 0.3f) && w.thickness == 0.3f);
    CHECK(!setProperty(w, "thickness", std::string("nope")));     // wrong type rejected
    CHECK(!setProperty(w, "doesNotExist", 1.f));
    Opening o; o.type = OpeningType::Window;
    CHECK(std::get<int>(getProperty(o, "type")) == 1);
    CHECK(setProperty(o, "type", std::string("door")) && o.type == OpeningType::Door);
    CHECK(propertyValueToString(getProperty(o, "type"), findProperty(propertiesOf<Opening>(), "type")) == "door");

    // --- undo: create a wall, drag it, change thickness, undo three times -> back to start
    Document doc;
    Level lvl; lvl.id = "L1"; lvl.name = "Level 1";
    doc.addLevel(lvl);
    CHECK(doc.level(0)->walls.empty());

    std::string id = doc.addWall(0, {0, 0}, {5, 0}, 0.2f);
    CHECK(doc.level(0)->walls.size() == 1);
    doc.commands().breakCoalescing();
    // a "drag": 10 tiny moves that should coalesce into one undo step
    for (int i = 1; i <= 10; ++i) doc.moveWall(0, id, {0, 0.1f * i}, {5, 0.1f * i});
    doc.commands().breakCoalescing();
    doc.setProperty(0, ElementKind::Wall, id, "thickness", 0.35f);
    CHECK(doc.commands().undoDepth() == 3);
    CHECK(std::abs(doc.level(0)->walls[0].a.y - 1.f) < 1e-5f);
    CHECK(doc.level(0)->walls[0].thickness == 0.35f);

    CHECK(doc.undo()); CHECK(doc.level(0)->walls[0].thickness == 0.2f);
    CHECK(doc.undo()); CHECK(doc.level(0)->walls[0].a.y == 0.f);         // whole drag undone in one step
    CHECK(doc.undo()); CHECK(doc.level(0)->walls.empty());
    CHECK(!doc.undo());
    CHECK(doc.redo()); CHECK(doc.level(0)->walls.size() == 1);
    CHECK(doc.redo()); CHECK(std::abs(doc.level(0)->walls[0].a.y - 1.f) < 1e-5f);

    // failed property set must not leave a no-op on the stack
    size_t depth = doc.commands().undoDepth();
    CHECK(!doc.setProperty(0, ElementKind::Wall, id, "nonsense", 1.f));
    CHECK(doc.commands().undoDepth() == depth);

    // delete wall removes its openings, undo restores both
    std::string oid = doc.addOpening(0, id, OpeningType::Door, 1.f, 0.9f);
    CHECK(!oid.empty() && doc.level(0)->openings.size() == 1);
    CHECK(doc.deleteWall(0, id));
    CHECK(doc.level(0)->walls.empty() && doc.level(0)->openings.empty());
    CHECK(doc.undo());
    CHECK(doc.level(0)->walls.size() == 1 && doc.level(0)->openings.size() == 1);

    // --- serialization round trip: save -> load -> save, byte-compare
    Room r; r.id = "r1"; r.code = "E2-05-12"; r.name = "LT3"; r.kind = RoomKind::Classroom;
    r.polygon = {{0,0},{5,0},{5,4},{0,4}}; r.area = polygonArea(r.polygon); r.centroid = polygonCentroid(r.polygon);
    doc.mutableLevel(0)->rooms.push_back(r);
    Node n1; n1.id = "n1"; n1.pos = r.centroid; n1.room = "r1"; n1.kind = NodeKind::Room;
    Node n2; n2.id = "n2"; n2.pos = {2.5f, 6}; n2.kind = NodeKind::Corridor;
    doc.mutableLevel(0)->nodes = {n1, n2};
    Edge e; e.a = "n1"; e.b = "n2"; e.cost = 4.f; e.stepFree = true; e.via = oid;
    doc.mutableLevel(0)->edges = {e};
    Link link; link.a = "L1:n2"; link.b = "L2:n9"; link.kind = LinkKind::Lift; link.stepFree = true; link.cost = 25.f;
    doc.mutableBuilding().links = {link};

    std::string json1 = doc.toJson();
    auto loaded = Document::fromJson(json1);
    CHECK(loaded.ok());
    if (loaded) {
        std::string json2 = loaded->toJson();
        CHECK(json1 == json2);                                          // byte-identical round trip
        CHECK(compareBuildings(doc.building(), loaded->building()).empty());
        CHECK(loaded->level(0)->rooms[0].kind == RoomKind::Classroom);
        CHECK(loaded->level(0)->rooms[0].polygon.size() == 4);
        CHECK(loaded->building().links[0].kind == LinkKind::Lift);
        // id generator continues after the highest existing id
        CHECK(idNumber(loaded->nextId("w")) > 1);
    }

    // --- good error messages
    auto bad = Document::fromJson("{ \"version\": 1, \"levels\": [ { \"id\": \"L1\", \"walls\": [ { \"id\": \"w1\", \"thickness\": \"thick\" } ] } ] }");
    CHECK(!bad.ok());
    std::cout << "expected error: " << bad.error() << "\n";
    CHECK(bad.error().find("thickness") != std::string::npos);
    auto bad2 = Document::fromJson("{ \"version\": 1, \"levels\": [ { \"id\": \"L1\", \"openings\": [ { \"id\": \"o1\", \"wall\": \"w9\" } ] } ] }");
    CHECK(!bad2.ok() && bad2.error().find("w9") != std::string::npos);
    auto bad3 = Document::fromJson("not json");
    CHECK(!bad3.ok());

    // geometry helpers
    std::vector<Vec2> sq = {{0,0},{2,0},{2,2},{0,2}};
    CHECK(std::abs(polygonArea(sq) - 4.f) < 1e-5f);
    CHECK(pointInPolygon({1,1}, sq) && !pointInPolygon({3,1}, sq));
    CHECK(std::abs(polygonCentroid(sq).x - 1.f) < 1e-5f);

    if (g_failures) { std::cerr << g_failures << " failure(s)\n"; return 1; }
    std::cout << "wf_doc: all checks passed\n";
    return 0;
}
