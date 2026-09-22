// wf_doc console test. CTest runs this; return 0 = pass, non-zero = fail.
#include "wf_doc/wf_doc.hpp"
#include <filesystem>
#include <iostream>

static int g_fail = 0;
// Variadic so braced initialisers with commas (Vec2{1.f, 2.f}) work inside CHECK.
#define CHECK(...) do { if (!(__VA_ARGS__)) { std::cerr << __FILE__ << ":" << __LINE__ << " CHECK failed: " #__VA_ARGS__ "\n"; ++g_fail; } } while (0)

using namespace wf;

static bool contains(const std::string& s, const char* part) { return s.find(part) != std::string::npos; }

// 2 levels, one of every element type.
static Building makeBuilding() {
    Building b;
    b.building.name = "Test Block";
    b.building.id = "B1";
    b.source.file = "plan.svg";
    b.source.pixelsPerMetre = 50.f;
    b.source.rectified = true;

    Level l1;
    l1.id = "L1"; l1.name = "Ground"; l1.elevation = 0.f; l1.ceilingHeight = 2.8f;
    Wall w1; w1.id = "w1"; w1.a = Vec2{ 0.f, 0.f }; w1.b = Vec2{ 4.f, 0.f }; w1.thickness = 0.15f; w1.confidence = 0.9f;
    Wall w2; w2.id = "w2"; w2.a = Vec2{ 4.f, 0.f }; w2.b = Vec2{ 4.f, 3.f };
    l1.walls = { w1, w2 };
    Opening o1; o1.id = "o1"; o1.wall = "w1"; o1.offset = 1.f; o1.width = 0.9f; o1.type = OpeningType::Door;
    l1.openings = { o1 };
    Room r1; r1.id = "r1"; r1.code = "A101"; r1.name = "Lab"; r1.kind = RoomKind::Lab;
    r1.boundary = { "w1", "w2" };
    r1.polygon = { Vec2{0.f, 0.f}, Vec2{4.f, 0.f}, Vec2{4.f, 3.f}, Vec2{0.f, 3.f} };
    r1.centroid = polygonCentroid(r1.polygon);
    r1.area = polygonArea(r1.polygon);
    l1.rooms = { r1 };
    Node n1; n1.id = "n1"; n1.pos = Vec2{ 2.f, 1.5f }; n1.kind = NodeKind::Room; n1.room = "r1";
    Node n2; n2.id = "n2"; n2.pos = Vec2{ 1.5f, 0.f }; n2.kind = NodeKind::Door;
    l1.nodes = { n1, n2 };
    Edge e1; e1.a = "n1"; e1.b = "n2"; e1.cost = 1.9f; e1.stepFree = true;
    l1.edges = { e1 };
    Poi p1; p1.id = "p1"; p1.kind = "water"; p1.pos = Vec2{ 3.f, 1.f }; p1.label = "Fountain";
    l1.pois = { p1 };
    Anchor a1; a1.id = "a1"; a1.name = "Main entrance"; a1.pos = Vec2{ 0.5f, 0.f }; a1.heading = 1.5708f;
    l1.anchors = { a1 };

    Level l2;
    l2.id = "L2"; l2.name = "First"; l2.elevation = 4.2f;
    Node m1; m1.id = "n1"; m1.pos = Vec2{ 2.f, 1.5f }; m1.kind = NodeKind::Lift;
    l2.nodes = { m1 };

    b.levels = { l1, l2 };
    Link k; k.a = "L1:n1"; k.b = "L2:n1"; k.kind = LinkKind::Lift; k.stepFree = true; k.cost = 8.f;
    b.links = { k };
    return b;
}

static void testProperties() {
    CHECK(propertiesOf<Wall>().size() == 5);
    CHECK(propertiesOf<Room>().size() == 7);
    CHECK(propertiesOf<Opening>().size() == 8);
    CHECK(findProperty(propertiesOf<Wall>(), "thickness") != nullptr);
    CHECK(findProperty(propertiesOf<Wall>(), "nope") == nullptr);

    Wall w;
    w.thickness = 0.3f;
    auto t = getProperty(w, "thickness");
    CHECK(t && std::get<float>(*t) == 0.3f);
    CHECK(setProperty(w, "thickness", PropertyValue{ 0.5f }) && w.thickness == 0.5f);
    CHECK(!setProperty(w, "thickness", PropertyValue{ std::string("x") }));
    CHECK(w.thickness == 0.5f);
    CHECK(!getProperty(w, "nope").has_value());
    CHECK(setProperty(w, "a", PropertyValue{ Vec2{1.f, 2.f} }) && w.a == Vec2{ 1.f, 2.f });
    CHECK(setProperty(w, "id", "w7") && w.id == "w7");

    Room r;
    CHECK(setProperty(r, "kind", "exit") && r.kind == RoomKind::Exit);
    CHECK(!setProperty(r, "kind", "banana") && r.kind == RoomKind::Exit);
    auto k = getProperty(r, "kind");
    CHECK(k && std::get<std::string>(*k) == "exit");

    const PropertyInfo* pi = findProperty(propertiesOf<Wall>(), "a");
    CHECK(pi && propertyValueToString(getPropertyRaw(&w, *pi), pi) == "1,2");
    CHECK(std::string(propertyTypeName(PropertyType::Vec2)) == "vec2");
}

static void testGeometry() {
    std::vector<Vec2> sq{ Vec2{0.f, 0.f}, Vec2{4.f, 0.f}, Vec2{4.f, 3.f}, Vec2{0.f, 3.f} };
    CHECK(polygonArea(sq) == 12.f);
    CHECK(polygonCentroid(sq) == Vec2{ 2.f, 1.5f });
    CHECK(pointInPolygon(Vec2{ 1.f, 1.f }, sq) && !pointInPolygon(Vec2{ 5.f, 1.f }, sq));
    CHECK(polygonBounds(sq).max == Vec2{ 4.f, 3.f });

    Wall w; w.a = Vec2{ 0.f, 0.f }; w.b = Vec2{ 4.f, 0.f };
    Opening o; o.offset = 1.f; o.width = 1.f;
    CHECK(openingPosition(w, o) == Vec2{ 1.5f, 0.f });

    Level lv; w.id = "w7"; lv.walls.push_back(w);
    CHECK(lv.findWall("w7") != nullptr && lv.findWall("zz") == nullptr);
}

static void testSerialize() {
    const Building a = makeBuilding();
    const auto dir = std::filesystem::temp_directory_path();
    const auto f1 = dir / "wf_doc_test_1.wfb";
    const auto f2 = dir / "wf_doc_test_2.wfb";

    // save -> load -> compare empty
    CHECK(saveBuilding(a, f1).ok);
    Result<Building> b = loadBuilding(f1);
    CHECK(static_cast<bool>(b));
    if (b) {
        auto diffs = compareBuildings(a, *b);
        for (const auto& d : diffs) std::cerr << "diff: " << d << "\n";
        CHECK(diffs.empty());

        // ... and the second save is byte-identical
        CHECK(saveBuilding(*b, f2).ok);
        Result<std::string> t1 = io::readText(f1), t2 = io::readText(f2);
        CHECK(t1 && t2 && *t1 == *t2);
    }

    // compare actually detects a change
    Building c = a;
    c.levels[0].walls[0].thickness = 0.3f;
    CHECK(compareBuildings(a, c).size() == 1);
    c.levels[1].nodes.clear();
    CHECK(compareBuildings(a, c).size() == 2);

    // errors
    json j = buildingToJson(a);
    j["levels"][0]["walls"][0]["a"] = "oops";
    Result<Building> bad = buildingFromJson(j, "plan.wfb");
    CHECK(!bad);
    if (!bad) {
        std::cerr << "expected error text: " << bad.error() << "\n";
        CHECK(contains(bad.error(), "plan.wfb"));
        CHECK(contains(bad.error(), "walls[0]"));
        CHECK(contains(bad.error(), "\"a\""));
    }

    j = buildingToJson(a);
    j["levels"][0]["rooms"][0]["kind"] = "banana";
    bad = buildingFromJson(j, "plan.wfb");
    CHECK(!bad && contains(bad.error(), "rooms[0]") && contains(bad.error(), "\"kind\""));

    j = buildingToJson(a);
    j["version"] = 99;
    bad = buildingFromJson(j, "plan.wfb");
    CHECK(!bad && contains(bad.error(), "99") && contains(bad.error(), "1"));

    // unknown keys ignored
    j = buildingToJson(a);
    j["futureThing"] = 1;
    j["levels"][0]["walls"][0]["colour"] = "red";
    CHECK(static_cast<bool>(buildingFromJson(j, "plan.wfb")));

    // missing / broken file
    Result<Building> missing = loadBuilding(dir / "wf_doc_no_such_file.wfb");
    CHECK(!missing && contains(missing.error(), "wf_doc_no_such_file"));

    std::error_code ec;
    std::filesystem::remove(f1, ec);
    std::filesystem::remove(f2, ec);
}

int main() {
    testProperties();
    testGeometry();
    testSerialize();
    std::cout << (g_fail ? "wf_doc: FAILED\n" : "wf_doc: all checks passed\n");
    return g_fail ? 1 : 0;
}