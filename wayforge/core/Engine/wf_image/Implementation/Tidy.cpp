/*!
 * \file Tidy.cpp
 * \brief Connected-component filtering of a thresholded plan
 *
 * removeSmallBlobs() erases 8-connected ink components whose bounding box is
 * at most maxSizePx in both directions (text, sanitary fixtures, furniture,
 * columns). keepMainDrawing() keeps the component with the largest bounding
 * box and every component overlapping that box, and erases the rest
 * (dimension lines, title blocks, notes outside the building).
 *
 * Both assume the walls of a floor form one connected component.
 *
 * Links: called by wf_read::convertImage (Convert.cpp) after
 * adaptiveThreshold() and before wf_vector::thin().
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Connected-component labelling with an explicit stack
 *   - Small-component removal and main-drawing filter
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_image/wf_image.hpp"
#include <algorithm>

namespace wf::img {
namespace {

    // 8-connected ink component: inclusive bounding box and pixel indices (y * width + x).
    struct Blob {
        int x0, y0, x1, y1;
        std::vector<int> pixels;
        int width()  const noexcept { return x1 - x0 + 1; }
        int height() const noexcept { return y1 - y0 + 1; }
    };

    // Flood fill with an explicit stack; the wall component can hold millions of pixels,
    // which is too deep for recursion.
    std::vector<Blob> findBlobs(const Image8& img) {
        std::vector<Blob> blobs;
        std::vector<uint8_t> seen(img.pixels.size(), 0);
        std::vector<int> stack;
        for (int start = 0; start < static_cast<int>(img.pixels.size()); ++start) {
            if (seen[start] || img.pixels[start] >= 128) continue;
            Blob b{ img.width, img.height, -1, -1, {} };
            stack.push_back(start); seen[start] = 1;
            while (!stack.empty()) {
                const int i = stack.back(); stack.pop_back();
                const int x = i % img.width, y = i / img.width;
                b.pixels.push_back(i);
                b.x0 = std::min(b.x0, x); b.x1 = std::max(b.x1, x);
                b.y0 = std::min(b.y0, y); b.y1 = std::max(b.y1, y);
                for (int dy = -1; dy <= 1; ++dy) for (int dx = -1; dx <= 1; ++dx) {
                    const int nx = x + dx, ny = y + dy;
                    if (!img.inside(nx, ny)) continue;
                    const int n = ny * img.width + nx;
                    if (seen[n] || img.pixels[n] >= 128) continue;
                    seen[n] = 1; stack.push_back(n);
                }
            }
            blobs.push_back(std::move(b));
        }
        return blobs;
    }

} // namespace

Image8 removeSmallBlobs(const Image8& binary, int maxSizePx, int* removed) {
    Image8 out = binary;
    int count = 0;
    for (const Blob& b : findBlobs(binary)) {
        if (b.width() > maxSizePx || b.height() > maxSizePx) continue;   // too big in one direction: keep
        for (int i : b.pixels) out.pixels[static_cast<size_t>(i)] = 255;
        ++count;
    }
    if (removed) *removed = count;
    return out;
}

Image8 keepMainDrawing(const Image8& binary, int* removed) {
    Image8 out = binary;
    auto blobs = findBlobs(binary);
    if (blobs.empty()) { if (removed) *removed = 0; return out; }
    // Main drawing: the component with the largest bounding-box area.
    const Blob* main = &blobs[0];
    for (const Blob& b : blobs)
        if (static_cast<long long>(b.width()) * b.height() > static_cast<long long>(main->width()) * main->height()) main = &b;
    int count = 0;
    for (const Blob& b : blobs) {
        // Room contents overlap the main box and are left for removeSmallBlobs().
        const bool overlaps = b.x1 >= main->x0 && b.x0 <= main->x1 && b.y1 >= main->y0 && b.y0 <= main->y1;
        if (overlaps) continue;
        for (int i : b.pixels) out.pixels[static_cast<size_t>(i)] = 255;
        ++count;
    }
    if (removed) *removed = count;
    return out;
}

} // namespace wf::img
