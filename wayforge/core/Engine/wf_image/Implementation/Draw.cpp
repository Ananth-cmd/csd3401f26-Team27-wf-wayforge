/*!
 * \file Draw.cpp
 * \brief Line and polygon rasterisation on Image8
 *
 * Minimal drawing routines for the converter's debug images: thick lines
 * (a square brush stamped along the line) and even-odd scanline polygon fill.
 *
 * Links: used by wf_read::convertImage (Convert.cpp) for 5_lines.png and
 * 6_rooms.png; the images are written with savePng() (Load.cpp).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Thick line drawing and even-odd scanline polygon fill
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_image/wf_image.hpp"
#include <algorithm>
#include <cmath>

namespace wf::img {

void drawLine(Image8& img, Vec2 a, Vec2 b, uint8_t value, int width) {
    // One sample per pixel along the major axis, a (2r+1) x (2r+1) square at each sample.
    const int steps = static_cast<int>(std::ceil(std::max(std::abs(b.x - a.x), std::abs(b.y - a.y)))) + 1;
    const int r = std::max(0, width / 2);
    for (int i = 0; i <= steps; ++i) {
        const float t = static_cast<float>(i) / static_cast<float>(steps);
        const int cx = static_cast<int>(std::lround(a.x + (b.x - a.x) * t));
        const int cy = static_cast<int>(std::lround(a.y + (b.y - a.y) * t));
        for (int dy = -r; dy <= r; ++dy) for (int dx = -r; dx <= r; ++dx)
            if (img.inside(cx + dx, cy + dy)) img.at(cx + dx, cy + dy) = value;
    }
}

void fillPolygon(Image8& img, const std::vector<Vec2>& pts, uint8_t value) {
    if (pts.size() < 3) return;
    float minY = pts[0].y, maxY = pts[0].y;
    for (const auto& p : pts) { minY = std::min(minY, p.y); maxY = std::max(maxY, p.y); }
    const int y0 = std::max(0, static_cast<int>(std::floor(minY)));
    const int y1 = std::min(img.height - 1, static_cast<int>(std::ceil(maxY)));
    std::vector<float> xs;
    // Each row is sampled at its pixel centre; fill between successive pairs of edge crossings.
    for (int y = y0; y <= y1; ++y) {
        const float sy = static_cast<float>(y) + 0.5f;
        xs.clear();
        for (size_t i = 0, j = pts.size() - 1; i < pts.size(); j = i++) {
            const Vec2& p = pts[i]; const Vec2& q = pts[j];
            if ((p.y > sy) == (q.y > sy)) continue;
            xs.push_back(p.x + (sy - p.y) * (q.x - p.x) / (q.y - p.y));
        }
        std::sort(xs.begin(), xs.end());
        for (size_t k = 0; k + 1 < xs.size(); k += 2) {
            const int xa = std::max(0, static_cast<int>(std::ceil(xs[k] - 0.5f)));
            const int xb = std::min(img.width - 1, static_cast<int>(std::floor(xs[k + 1] - 0.5f)));
            for (int x = xa; x <= xb; ++x) img.at(x, y) = value;
        }
    }
}

} // namespace wf::img
