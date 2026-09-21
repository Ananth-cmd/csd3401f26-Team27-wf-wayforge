// wf_doc console test. CTest runs this; return 0 = pass, non-zero = fail.
#include "wf_doc/wf_doc.hpp"
#include <iostream>

static int g_fail = 0;
#define CHECK(c) do { if (!(c)) { std::cerr << __FILE__ << ":" << __LINE__ << " CHECK failed: " #c "\n"; ++g_fail; } } while (0)

int main() {
    using namespace wf;

    // property tables
    CHECK(propertiesOf<Wall>().size() == 5);
    CHECK(propertiesOf<Room>().size() == 7);
    CHECK(propertiesOf<Opening>().size() == 8);
    CHECK(findProperty(propertiesOf<Wall>(), "thickness") != nullptr);
    CHECK(findProperty(propertiesOf<Wall>(), "nope") == nullptr);

    // get / set
    Wall w;
    w.thickness = 0.3f;
    auto t = getProperty(w, "thickness");
    CHECK(t && std::get<float>(*t) == 0.3f);
    CHECK(setProperty(w, "thickness", PropertyValue{ 0.5f }) && w.thickness == 0.5f);
    CHECK(!setProperty(w, "thickness", PropertyValue{ std::string("x") }));   // wrong type rejected
    CHECK(w.thickness == 0.5f);                                            // and untouched
    CHECK(!getProperty(w, "nope").has_value());
    CHECK(setProperty(w, "a", PropertyValue{ Vec2{1, 2} }) && w.a == Vec2{ 1, 2 });
    CHECK(setProperty(w, "id", "w7") && w.id == "w7");

    // enums by name
    Room r;
    CHECK(setProperty(r, "kind", "exit") && r.kind == RoomKind::Exit);
    CHECK(!setProperty(r, "kind", "banana") && r.kind == RoomKind::Exit);
    auto k = getProperty(r, "kind");
    CHECK(k && std::get<std::string>(*k) == "exit");

    // to-string
    const PropertyInfo* pi = findProperty(propertiesOf<Wall>(), "a");
    CHECK(pi && propertyValueToString(getPropertyRaw(&w, *pi), pi) == "1,2");
    CHECK(std::string(propertyTypeName(PropertyType::Vec2)) == "vec2");

    // geometry helpers
    std::vector<Vec2> sq{ {0, 0}, {4, 0}, {4, 3}, {0, 3} };
    CHECK(polygonArea(sq) == 12.f);
    CHECK(polygonCentroid(sq) == Vec2({ 2.f, 1.5f }));
    CHECK(pointInPolygon({ 1, 1 }, sq) && !pointInPolygon({ 5, 1 }, sq));
    CHECK(polygonBounds(sq).max == Vec2({ 4.f, 3.f }));

    Wall w2; w2.a = { 0, 0 }; w2.b = { 4, 0 };
    Opening o; o.offset = 1; o.width = 1;
    CHECK(openingPosition(w2, o) == Vec2({ 1.5f, 0.f }));

    // lookups
    Level lv; lv.walls.push_back(w); lv.rooms.push_back(r);
    CHECK(lv.findWall("w7") != nullptr && lv.findWall("zz") == nullptr);

    std::cout << (g_fail ? "wf_doc: FAILED\n" : "wf_doc: all checks passed\n");
    return g_fail ? 1 : 0;
}