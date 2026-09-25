#include "wf_doc/Types.hpp"
#include <algorithm>
#include <cmath>

namespace wf {

    Vec2  Wall::direction() const { return normalize(b - a); }
    float Wall::length()    const { return distance(a, b); }

    namespace {
        template <class C> auto* findById(C& c, std::string_view id) {
            auto it = std::find_if(c.begin(), c.end(), [&](const auto& e) { return e.id == id; });
            return it == c.end() ? nullptr : &*it;
        }
    }

    const Wall* Level::findWall(std::string_view id) const { return findById(walls, id); }
    Wall* Level::findWall(std::string_view id) { return findById(walls, id); }
    const Room* Level::findRoom(std::string_view id) const { return findById(rooms, id); }
    const Node* Level::findNode(std::string_view id) const { return findById(nodes, id); }
    const Level* Building::findLevel(std::string_view id) const { return findById(levels, id); }

    float polygonArea(const std::vector<Vec2>& p) {
        float s = 0;
        for (size_t i = 0; i < p.size(); ++i) s += cross(p[i], p[(i + 1) % p.size()]);
        return std::fabs(s) * 0.5f;
    }

    Vec2 polygonCentroid(const std::vector<Vec2>& p) {
        float a = 0;
        Vec2 c;
        for (size_t i = 0; i < p.size(); ++i) {
            Vec2 u = p[i], v = p[(i + 1) % p.size()];
            float w = cross(u, v);
            a += w;
            c.x += (u.x + v.x) * w;
            c.y += (u.y + v.y) * w;
        }
        if (std::fabs(a) < 1e-9f) {
            Vec2 m;
            for (Vec2 q : p) m += q;
            return p.empty() ? m : m * (1.f / static_cast<float>(p.size()));
        }
        return c * (1.f / (3.f * a));
    }

    bool pointInPolygon(Vec2 pt, const std::vector<Vec2>& p) {
        if (p.size() < 3) return false;
        bool in = false;
        for (size_t i = 0, j = p.size() - 1; i < p.size(); j = i++) {
            if ((p[i].y > pt.y) != (p[j].y > pt.y) &&
                pt.x < (p[j].x - p[i].x) * (pt.y - p[i].y) / (p[j].y - p[i].y) + p[i].x)
                in = !in;
        }
        return in;
    }

    Rect polygonBounds(const std::vector<Vec2>& p) {
        Rect r;
        if (p.empty()) return r;
        r.min = r.max = p[0];
        for (Vec2 q : p) r.expand(q);
        return r;
    }

    Vec2 openingPosition(const Wall& w, const Opening& o) {
        return w.a + w.direction() * (o.offset + o.width * 0.5f);
    }

} // namespace wf