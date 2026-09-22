#pragma once
#include <cmath>
#include <algorithm>
#include <numbers>

namespace wf {

    constexpr float kPi = std::numbers::pi_v<float>;
    constexpr float kEpsilon = 1e-6f;

    struct Vec2 {
        float x = 0.f;
        float y = 0.f;

        constexpr Vec2() = default;
        constexpr Vec2(float x_, float y_) : x(x_), y(y_) {}

        constexpr Vec2 operator+(const Vec2& o) const noexcept { return { x + o.x, y + o.y }; }
        constexpr Vec2 operator-(const Vec2& o) const noexcept { return { x - o.x, y - o.y }; }
        constexpr Vec2 operator*(float s)       const noexcept { return { x * s, y * s }; }
        constexpr Vec2 operator/(float s)       const noexcept { return { x / s, y / s }; }
        constexpr Vec2 operator-()              const noexcept { return { -x, -y }; }
        constexpr Vec2& operator+=(const Vec2& o) noexcept { x += o.x; y += o.y; return *this; }
        constexpr Vec2& operator-=(const Vec2& o) noexcept { x -= o.x; y -= o.y; return *this; }
        constexpr Vec2& operator*=(float s)       noexcept { x *= s; y *= s; return *this; }
        constexpr bool operator==(const Vec2& o) const noexcept { return x == o.x && y == o.y; }
        constexpr bool operator!=(const Vec2& o) const noexcept { return !(*this == o); }
    };

    constexpr Vec2 operator*(float s, const Vec2& v) noexcept { return v * s; }

    constexpr float dot(const Vec2& a, const Vec2& b) noexcept { return a.x * b.x + a.y * b.y; }
    constexpr float cross(const Vec2& a, const Vec2& b) noexcept { return a.x * b.y - a.y * b.x; }
    inline    float length(const Vec2& v)              noexcept { return std::sqrt(dot(v, v)); }
    constexpr float lengthSq(const Vec2& v)            noexcept { return dot(v, v); }
    inline    float distance(const Vec2& a, const Vec2& b) noexcept { return length(a - b); }
    constexpr float distanceSq(const Vec2& a, const Vec2& b) noexcept { return lengthSq(a - b); }
    constexpr Vec2  perp(const Vec2& v)                noexcept { return { -v.y, v.x }; }
    constexpr Vec2  lerp(const Vec2& a, const Vec2& b, float t) noexcept { return a + (b - a) * t; }

    inline Vec2 normalize(const Vec2& v) noexcept {
        const float len = length(v);
        return len > kEpsilon ? v / len : Vec2{ 0.f, 0.f };
    }

    // Angle of a vector in radians, in (-pi, pi].
    inline float angleOf(const Vec2& v) noexcept { return std::atan2(v.y, v.x); }

    constexpr float degToRad(float d) noexcept { return d * (kPi / 180.f); }
    constexpr float radToDeg(float r) noexcept { return r * (180.f / kPi); }

    // Smallest absolute difference between two angles (radians), in [0, pi].
    inline float angleDiff(float a, float b) noexcept {
        float d = std::fmod(a - b, 2.f * kPi);
        if (d < 0.f) d += 2.f * kPi;
        if (d > kPi) d = 2.f * kPi - d;
        return d;
    }

    // Difference between two undirected line angles (radians), in [0, pi/2].
    inline float lineAngleDiff(float a, float b) noexcept {
        float d = angleDiff(a, b);
        return d > kPi * 0.5f ? kPi - d : d;
    }

    // Distance from point p to the infinite line through a-b.
    inline float distancePointToLine(const Vec2& p, const Vec2& a, const Vec2& b) noexcept {
        const Vec2 ab = b - a;
        const float len = length(ab);
        if (len < kEpsilon) return distance(p, a);
        return std::abs(cross(ab, p - a)) / len;
    }

    // Closest point on segment a-b to p, and parameter t in [0,1].
    inline Vec2 closestPointOnSegment(const Vec2& p, const Vec2& a, const Vec2& b, float* tOut = nullptr) noexcept {
        const Vec2 ab = b - a;
        const float l2 = lengthSq(ab);
        float t = l2 < kEpsilon ? 0.f : std::clamp(dot(p - a, ab) / l2, 0.f, 1.f);
        if (tOut) *tOut = t;
        return a + ab * t;
    }

    inline float distancePointToSegment(const Vec2& p, const Vec2& a, const Vec2& b) noexcept {
        return distance(p, closestPointOnSegment(p, a, b));
    }

    // True if segments p1-p2 and q1-q2 properly intersect (or touch).
    inline bool segmentsIntersect(const Vec2& p1, const Vec2& p2, const Vec2& q1, const Vec2& q2) noexcept {
        const float d1 = cross(q2 - q1, p1 - q1);
        const float d2 = cross(q2 - q1, p2 - q1);
        const float d3 = cross(p2 - p1, q1 - p1);
        const float d4 = cross(p2 - p1, q2 - p1);
        if (((d1 > 0.f && d2 < 0.f) || (d1 < 0.f && d2 > 0.f)) &&
            ((d3 > 0.f && d4 < 0.f) || (d3 < 0.f && d4 > 0.f)))
            return true;
        auto onSeg = [](const Vec2& a, const Vec2& b, const Vec2& c) {
            return std::min(a.x, b.x) - kEpsilon <= c.x && c.x <= std::max(a.x, b.x) + kEpsilon &&
                std::min(a.y, b.y) - kEpsilon <= c.y && c.y <= std::max(a.y, b.y) + kEpsilon;
            };
        if (std::abs(d1) < kEpsilon && onSeg(q1, q2, p1)) return true;
        if (std::abs(d2) < kEpsilon && onSeg(q1, q2, p2)) return true;
        if (std::abs(d3) < kEpsilon && onSeg(p1, p2, q1)) return true;
        if (std::abs(d4) < kEpsilon && onSeg(p1, p2, q2)) return true;
        return false;
    }

    struct Rect {
        Vec2 min{ 1e30f,  1e30f };
        Vec2 max{ -1e30f, -1e30f };
        void  expand(const Vec2& p) noexcept {
            min.x = std::min(min.x, p.x); min.y = std::min(min.y, p.y);
            max.x = std::max(max.x, p.x); max.y = std::max(max.y, p.y);
        }
        Vec2  size()   const noexcept { return max - min; }
        Vec2  centre() const noexcept { return (min + max) * 0.5f; }
        bool  valid()  const noexcept { return min.x <= max.x && min.y <= max.y; }
        bool  contains(const Vec2& p) const noexcept { return p.x >= min.x && p.x <= max.x && p.y >= min.y && p.y <= max.y; }
    };

} // namespace wf