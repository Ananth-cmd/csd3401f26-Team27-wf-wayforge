/*!
 * \file Tidy.cpp
 * \brief Connected-component filtering of a thresholded plan
 *
 * removeSmallBlobs() erases 8-connected ink components whose bounding box is
 * at most maxSizePx in both directions (text, sanitary fixtures, furniture,
 * columns), except thin line-like ones (dashes of dashed walls).
 * keepMainDrawing() first erases a sheet border (a component spanning at
 * least 80% of the image both ways whose box edges are at least 90% inked,
 * together with any title block joined to it) when another large component
 * lies inside it. The main components are the large, heavily drawn ones
 * (stroke at least half as thick as the thickest). Heavy components
 * overlapping the union of their boxes and thin components centred inside
 * one main box are kept; the rest is erased (dimension lines, site lines,
 * title blocks, notes outside the building).
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
 *   - Small-component removal and main-drawing filter (stroke weight, sheet border)
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

    // Fraction of each side of the blob's box that has blob ink within `band` pixels of it;
    // returns the smallest of the four.
    double edgeCoverage(const Blob& b, int imageWidth, int band) {
        std::vector<uint8_t> top(b.width(), 0), bottom(b.width(), 0), left(b.height(), 0), right(b.height(), 0);
        for (int i : b.pixels) {
            const int x = i % imageWidth, y = i / imageWidth;
            if (y - b.y0 < band) top[x - b.x0] = 1;
            if (b.y1 - y < band) bottom[x - b.x0] = 1;
            if (x - b.x0 < band) left[y - b.y0] = 1;
            if (b.x1 - x < band) right[y - b.y0] = 1;
        }
        auto frac = [](const std::vector<uint8_t>& v) {
            return v.empty() ? 0.0 : static_cast<double>(std::count(v.begin(), v.end(), 1)) / static_cast<double>(v.size());
        };
        return std::min({ frac(top), frac(bottom), frac(left), frac(right) });
    }

} // namespace

Image8 removeSmallBlobs(const Image8& binary, int maxSizePx, int* removed, int minLinePx) {
    Image8 out = binary;
    int count = 0;
    for (const Blob& b : findBlobs(binary)) {
        if (b.width() > maxSizePx || b.height() > maxSizePx) continue;   // too big in one direction: keep
        const int lo = std::min(b.width(), b.height()), hi = std::max(b.width(), b.height());
        if (minLinePx > 0 && hi >= minLinePx && hi >= 4 * lo) continue;  // dash of a dashed wall: keep
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
    auto diag = [](const Blob& b) { return std::hypot(static_cast<double>(b.width()), static_cast<double>(b.height())); };
    int count = 0;

    // Sheet border with its title block: a component spanning 80% of the image both ways with its
    // box edges inked, erased when a component of at least 30% of its diagonal lies inside it.
    const int band = std::max(3, std::min(binary.width, binary.height) / 100);
    for (size_t k = 0; k < blobs.size(); ++k) {
        const Blob& f = blobs[k];
        if (f.width() < binary.width * 0.8 || f.height() < binary.height * 0.8) continue;
        if (edgeCoverage(f, binary.width, band) < 0.9) continue;
        bool drawingInside = false;
        for (size_t j = 0; j < blobs.size() && !drawingInside; ++j)
            drawingInside = j != k && diag(blobs[j]) >= 0.3 * diag(f) &&
                            blobs[j].x0 > f.x0 && blobs[j].x1 < f.x1 && blobs[j].y0 > f.y0 && blobs[j].y1 < f.y1;
        if (!drawingInside) continue;
        for (int i : f.pixels) out.pixels[static_cast<size_t>(i)] = 255;
        ++count;
        blobs.erase(blobs.begin() + static_cast<std::ptrdiff_t>(k));
        break;
    }

    // Stroke half-width of each component: largest city-block distance from one of its pixels
    // to paper (two-pass distance transform).
    const int W = binary.width, H = binary.height;
    std::vector<int> dist(static_cast<size_t>(W) * H, 0);
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x) {
            const size_t i = static_cast<size_t>(y) * W + x;
            if (out.pixels[i] >= 128) continue;
            int d = 1 << 20;
            if (x > 0) d = std::min(d, dist[i - 1] + 1); else d = 1;
            if (y > 0) d = std::min(d, dist[i - W] + 1); else d = 1;
            dist[i] = d;
        }
    for (int y = H - 1; y >= 0; --y)
        for (int x = W - 1; x >= 0; --x) {
            const size_t i = static_cast<size_t>(y) * W + x;
            if (dist[i] == 0) continue;
            if (x + 1 < W) dist[i] = std::min(dist[i], dist[i + 1] + 1); else dist[i] = 1;
            if (y + 1 < H) dist[i] = std::min(dist[i], dist[i + W] + 1); else dist[i] = 1;
        }
    std::vector<int> stroke(blobs.size(), 0);
    int thickest = 0;
    for (size_t k = 0; k < blobs.size(); ++k) {
        for (int i : blobs[k].pixels) stroke[k] = std::max(stroke[k], dist[static_cast<size_t>(i)]);
        thickest = std::max(thickest, stroke[k]);
    }

    // Main drawing: the large components (diagonal at least 30% of the largest) with a stroke at
    // least half as thick as the thickest. Kept: heavy components overlapping the union of the
    // main boxes, and thin components (room contents, dashed walls) centred inside one main box.
    auto heavy = [&](size_t k) { return 2 * stroke[k] >= thickest; };
    double largest = 0.0;
    for (size_t k = 0; k < blobs.size(); ++k) if (heavy(k)) largest = std::max(largest, diag(blobs[k]));
    std::vector<size_t> main;
    int mx0 = binary.width, my0 = binary.height, mx1 = -1, my1 = -1;
    for (size_t k = 0; k < blobs.size(); ++k) {
        const Blob& b = blobs[k];
        if (!heavy(k) || diag(b) < 0.3 * largest) continue;
        main.push_back(k);
        mx0 = std::min(mx0, b.x0); my0 = std::min(my0, b.y0); mx1 = std::max(mx1, b.x1); my1 = std::max(my1, b.y1);
    }
    auto overlap = [](const Blob& b, int x0, int y0, int x1, int y1) { return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1; };
    for (size_t k = 0; k < blobs.size(); ++k) {
        const Blob& b = blobs[k];
        bool keep = false;
        if (heavy(k)) keep = overlap(b, mx0, my0, mx1, my1);
        else {
            const int cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
            for (size_t m : main)
                if (cx >= blobs[m].x0 && cx <= blobs[m].x1 && cy >= blobs[m].y0 && cy <= blobs[m].y1) { keep = true; break; }
        }
        if (keep) continue;
        for (int i : b.pixels) out.pixels[static_cast<size_t>(i)] = 255;
        ++count;
    }
    if (removed) *removed = count;
    return out;
}

} // namespace wf::img
