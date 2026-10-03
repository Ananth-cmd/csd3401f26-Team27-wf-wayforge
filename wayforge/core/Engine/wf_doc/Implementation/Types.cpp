// Types.cpp
// The find functions and the shape maths.
//AI declaration : Claude was used as a support tool for writing and debugging code and for the comments.


#include "wf_doc/Types.hpp"
#include <algorithm>
#include <cmath>
#include <span>

namespace wf {

    namespace {

        //helpers
        template <class C> auto* findById(C& c, std::string_view id) 
        {
            auto it = std::find_if(c.begin(), c.end(), [&](const auto& e) { return e.id == id; });
            return it == c.end() ? nullptr : &*it;
        }
    }

    const Wall* Level::findWall(std::string_view id) const noexcept { return findById(walls, id); }

    Wall* Level::findWall(std::string_view id) noexcept { return findById(walls, id); }
    const Room* Level::findRoom(std::string_view id) const noexcept { return findById(rooms, id); }
    Room* Level::findRoom(std::string_view id) noexcept { return findById(rooms, id); }
    const Node* Level::findNode(std::string_view id) const noexcept { return findById(nodes, id); }
    Node* Level::findNode(std::string_view id) noexcept { return findById(nodes, id); }
    Opening* Level::findOpening(std::string_view id) noexcept { return findById(openings, id); }
    const Level* Building::findLevel(std::string_view id) const noexcept { return findById(levels, id); }
    Level* Building::findLevel(std::string_view id) noexcept { return findById(levels, id); }

    //always +ve size of shape
    float polygonArea(std::span<const Vec2> p) noexcept 
    {
        float s = 0;
        for (size_t i = 0; i < p.size(); ++i) s += cross(p[i], p[(i + 1) % p.size()]);
        return std::fabs(s) * 0.5f;
    }

    //shape middle
    Vec2 polygonCentroid(std::span<const Vec2> p) noexcept 
    {
        float a = 0;
        Vec2 c;
        for (size_t i = 0; i < p.size(); ++i) 
        {
            Vec2 u = p[i], v = p[(i + 1) % p.size()];
            float w = cross(u, v);
            a += w;
            c.x += (u.x + v.x) * w;
            c.y += (u.y + v.y) * w;
        }

        if (std::fabs(a) < 1e-9f) 
        {
            Vec2 m;
            for (Vec2 q : p) m += q;
            return p.empty() ? m : m * (1.f / static_cast<float>(p.size()));
        }

        return c * (1.f / (3.f * a));
    }

    //simple point in polygon check
    bool pointInPolygon(const Vec2& pt, std::span<const Vec2> p) noexcept 
    {
        if (p.size() < 3) return false;
        bool in = false;
        for (size_t i = 0, j = p.size() - 1; i < p.size(); j = i++) 
        {
            if ((p[i].y > pt.y) != (p[j].y > pt.y) &&
                pt.x < (p[j].x - p[i].x) * (pt.y - p[i].y) / (p[j].y - p[i].y) + p[i].x)
                in = !in;
        }

        return in;
    }

    //accurate outline of shape
    Rect polygonBounds(std::span<const Vec2> p) noexcept 
    {
        Rect r;
        if (p.empty()) return r;
        r.min = r.max = p[0];
        for (Vec2 q : p) r.expand(q);
        return r;
    }

    //for door middle
    Vec2 openingPosition(const Wall& w, const Opening& o) noexcept 
    {
        return w.a + w.direction() * (o.offset + o.width * 0.5f);
    }

} // namespace wf