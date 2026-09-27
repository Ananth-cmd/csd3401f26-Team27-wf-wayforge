#include "DebugSvg.hpp"
#include <sstream>
#include <iomanip>

namespace wf::cli {

std::string levelToSvg(const Level& level, const graph::Route* route, bool showGraph) {
    Rect bb;
    for (auto& w : level.walls) { bb.expand(w.a); bb.expand(w.b); }
    for (auto& r : level.rooms) for (auto& p : r.polygon) bb.expand(p);
    if (!bb.valid()) bb = Rect{{0, 0}, {10, 10}};
    const float pad = 1.f;
    const float scale = 40.f;                                                   // px per metre
    const Vec2 size = bb.size() + Vec2{pad * 2, pad * 2};
    auto X = [&](float x) { return (x - bb.min.x + pad) * scale; };
    auto Y = [&](float y) { return (bb.max.y - y + pad) * scale; };            // flip: world y up, svg y down
    auto confColour = [](float c) { return c >= 0.7f ? "#1f6f3f" : (c >= 0.4f ? "#d08a00" : "#c0392b"); };

    std::ostringstream s;
    s << std::fixed << std::setprecision(2);
    s << "<svg xmlns='http://www.w3.org/2000/svg' width='" << size.x * scale << "' height='" << size.y * scale
      << "' viewBox='0 0 " << size.x * scale << " " << size.y * scale << "' font-family='sans-serif' font-size='10'>\n";
    s << "<rect width='100%' height='100%' fill='white'/>\n";
    // rooms
    for (auto& r : level.rooms) {
        s << "<polygon points='";
        for (auto& p : r.polygon) s << X(p.x) << "," << Y(p.y) << " ";
        s << "' fill='" << (r.kind == RoomKind::Corridor ? "#e8f0fe" : r.kind == RoomKind::Exit ? "#fde8e8" : "#f3f7f0") << "' stroke='none'/>\n";
        s << "<text x='" << X(r.centroid.x) << "' y='" << Y(r.centroid.y) << "' text-anchor='middle' fill='#555'>"
          << (r.code.empty() ? r.id : r.code) << "</text>\n";
    }
    // walls
    for (auto& w : level.walls)
        s << "<line x1='" << X(w.a.x) << "' y1='" << Y(w.a.y) << "' x2='" << X(w.b.x) << "' y2='" << Y(w.b.y)
          << "' stroke='" << confColour(w.confidence) << "' stroke-width='" << std::max(2.f, w.thickness * scale) << "' stroke-linecap='square'/>\n";
    // openings
    for (auto& o : level.openings) {
        const Wall* w = level.findWall(o.wall); if (!w) continue;
        const Vec2 d = w->direction(); const Vec2 a = w->a + d * o.offset; const Vec2 b = a + d * o.width;
        s << "<line x1='" << X(a.x) << "' y1='" << Y(a.y) << "' x2='" << X(b.x) << "' y2='" << Y(b.y)
          << "' stroke='" << (o.type == OpeningType::Window ? "#3498db" : "white") << "' stroke-width='" << std::max(3.f, w->thickness * scale + 2) << "'/>\n";
        if (o.type != OpeningType::Window) {
            const Vec2 m = openingPosition(*w, o);
            s << "<circle cx='" << X(m.x) << "' cy='" << Y(m.y) << "' r='4' fill='none' stroke='" << confColour(o.confidence) << "' stroke-width='1.5'/>\n";
        }
    }
    // graph
    if (showGraph) {
        for (auto& e : level.edges) {
            const Node* a = level.findNode(e.a); const Node* b = level.findNode(e.b); if (!a || !b) continue;
            s << "<line x1='" << X(a->pos.x) << "' y1='" << Y(a->pos.y) << "' x2='" << X(b->pos.x) << "' y2='" << Y(b->pos.y)
              << "' stroke='#9fb8d6' stroke-width='1' stroke-dasharray='3,3'/>\n";
        }
        for (auto& n : level.nodes) {
            const char* c = n.kind == NodeKind::Room ? "#2c6fbb" : n.kind == NodeKind::Door ? "#e67e22" : n.kind == NodeKind::Exit ? "#c0392b" : "#7f8c8d";
            s << "<circle cx='" << X(n.pos.x) << "' cy='" << Y(n.pos.y) << "' r='3' fill='" << c << "'/>\n";
        }
    }
    // route
    if (route && !route->empty()) {
        s << "<polyline points='";
        for (auto& st : route->steps) if (st.level == level.id) s << X(st.pos.x) << "," << Y(st.pos.y) << " ";
        s << "' fill='none' stroke='#e74c3c' stroke-width='3' stroke-linejoin='round'/>\n";
    }
    s << "</svg>\n";
    return s.str();
}

} // namespace wf::cli
