#include "wf_doc/Types.hpp"
#include <algorithm>

namespace wf {

template <class V> static auto* findById(V& v, std::string_view id) noexcept {
    for (auto& e : v) if (e.id == id) return &e;
    return static_cast<decltype(&v[0])>(nullptr);
}

Wall*    Level::findWall(std::string_view id) noexcept    { return findById(walls, id); }
Room*    Level::findRoom(std::string_view id) noexcept    { return findById(rooms, id); }
Node*    Level::findNode(std::string_view id) noexcept    { return findById(nodes, id); }
Opening* Level::findOpening(std::string_view id) noexcept { return findById(openings, id); }
const Wall* Level::findWall(std::string_view id) const noexcept { return findById(walls, id); }
const Room* Level::findRoom(std::string_view id) const noexcept { return findById(rooms, id); }
const Node* Level::findNode(std::string_view id) const noexcept { return findById(nodes, id); }

Level*       Building::findLevel(std::string_view id) noexcept       { return findById(levels, id); }
const Level* Building::findLevel(std::string_view id) const noexcept { return findById(levels, id); }

float polygonArea(std::span<const Vec2> poly) noexcept {
    if (poly.size() < 3) return 0.f;
    double sum = 0.0;
    for (size_t i = 0, n = poly.size(); i < n; ++i) {
        const Vec2& p = poly[i];
        const Vec2& q = poly[(i + 1) % n];
        sum += static_cast<double>(p.x) * q.y - static_cast<double>(q.x) * p.y;
    }
    return static_cast<float>(sum * 0.5);
}

Vec2 polygonCentroid(std::span<const Vec2> poly) noexcept {
    const size_t n = poly.size();
    if (n == 0) return {};
    if (n < 3) { Vec2 s; for (auto& p : poly) s += p; return s / static_cast<float>(n); }
    double cx = 0, cy = 0, a = 0;
    for (size_t i = 0; i < n; ++i) {
        const Vec2& p = poly[i];
        const Vec2& q = poly[(i + 1) % n];
        const double f = static_cast<double>(p.x) * q.y - static_cast<double>(q.x) * p.y;
        cx += (p.x + q.x) * f; cy += (p.y + q.y) * f; a += f;
    }
    if (std::abs(a) < 1e-9) { Vec2 s; for (auto& p : poly) s += p; return s / static_cast<float>(n); }
    a *= 0.5;
    return { static_cast<float>(cx / (6.0 * a)), static_cast<float>(cy / (6.0 * a)) };
}

bool pointInPolygon(const Vec2& p, std::span<const Vec2> poly) noexcept {
    bool inside = false;
    for (size_t i = 0, j = poly.size() - 1; i < poly.size(); j = i++) {
        const Vec2& a = poly[i];
        const Vec2& b = poly[j];
        if ((a.y > p.y) != (b.y > p.y) &&
            p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
            inside = !inside;
    }
    return inside;
}

Rect polygonBounds(std::span<const Vec2> poly) noexcept {
    Rect r; for (auto& p : poly) r.expand(p); return r;
}

Vec2 openingPosition(const Wall& wall, const Opening& opening) noexcept {
    return wall.a + wall.direction() * (opening.offset + opening.width * 0.5f);
}

} // namespace wf
