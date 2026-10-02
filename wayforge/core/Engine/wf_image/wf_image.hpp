/*!
 * \file wf_image.hpp
 * \brief Public header of wf_image: turning a floor plan picture into clean ink/paper
 *
 * This is step one of the Wayforge pipeline. A scan or photo of a floor plan
 * is loaded, turned grey, and split into ink (walls, lines) and paper
 * (background) with an adaptive threshold that copes with shadows. Photos
 * taken at an angle can be straightened with a homography (rectify).
 * The black-and-white result is handed to wf_vector, which turns the ink
 * into straight line segments.
 *
 * Links: wf_api::wf_convert_image -> img::load -> img::adaptiveThreshold -> wf_vector.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Image8 / Integral data types used by the whole image stage
 *   - Adaptive threshold and perspective rectification API
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-16
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// wf_image - public header.
// Turns a photo or scan into a clean binary plan: load, greyscale, integral
// image, adaptive threshold, perspective rectify. Also writes PNGs for --debug.

#pragma once
#include <vector>                 // Pixel storage.
#include <cstdint>                // uint8_t / uint64_t.
#include <filesystem>             // Paths for load() and savePng().
#include <array>                  // The 4 corners and the 3x3 homography.
#include "wf_core/wf_core.hpp"    // Vec2, Result/Status and file helpers from the core layer.

namespace wf::img {

    // 8-bit single channel image. 0 = black (ink), 255 = white (paper).
    struct Image8 {
        int width = 0;
        int height = 0;
        std::vector<uint8_t> pixels;   // Row by row: pixel (x, y) is at index y * width + x.

        Image8() = default;
        // Make a w x h image filled with one value (white by default).
        Image8(int w, int h, uint8_t fill = 255) : width(w), height(h), pixels(static_cast<size_t>(w)* h, fill) {}

        uint8_t  at(int x, int y) const noexcept { return pixels[static_cast<size_t>(y) * width + x]; }   // Read a pixel.
        uint8_t& at(int x, int y)       noexcept { return pixels[static_cast<size_t>(y) * width + x]; }   // Read or change a pixel.
        bool     inside(int x, int y) const noexcept { return x >= 0 && y >= 0 && x < width && y < height; }
        bool     empty() const noexcept { return pixels.empty(); }
        // Clamped, so callers can sample outside the border safely.
        uint8_t  sample(int x, int y) const noexcept {
            x = std::clamp(x, 0, width - 1); y = std::clamp(y, 0, height - 1); return at(x, y);
        }
    };

    // Sum table: each cell holds the sum of all pixels above and to the left.
    // Any rectangle sum is then four lookups - needed for adaptive threshold on 4000px scans.
    struct Integral {
        int width = 0, height = 0;
        std::vector<uint64_t> sums;                       // (width+1) * (height+1)
        uint64_t at(int x, int y) const noexcept { return sums[static_cast<size_t>(y) * (width + 1) + x]; }
        // Sum over inclusive pixel rectangle [x0,x1] x [y0,y1] (clamped).
        uint64_t rectSum(int x0, int y0, int x1, int y1) const noexcept;
    };

    // Settings for adaptiveThreshold. The defaults work for our test scans and photos.
    struct ThresholdParams {
        int   window = 15;       // neighbourhood size in pixels (odd)
        int   offset = 10;       // pixel is ink if it is more than `offset` below the local mean
    };

    // --- loading / saving --------------------------------------------------------------
    Result<Image8> load(const std::filesystem::path& path);              // PNG/JPG/BMP -> greyscale
    Result<Image8> loadFromMemory(const uint8_t* bytes, size_t size);    // Same, from bytes already in memory.
    Status         savePng(const Image8& img, const std::filesystem::path& path);   // Write a debug PNG.
    Image8         fromRgb(const uint8_t* rgb, int width, int height, int channels);   // luminance

    // --- processing ----------------------------------------------------------------------
    Integral  integralImage(const Image8& img);                                             // Build the sum table.
    Image8    adaptiveThreshold(const Image8& grey, const ThresholdParams& p = {});     // out: 0 ink / 255 paper
    Image8    globalThreshold(const Image8& grey, uint8_t level = 128);                     // One cut-off for the whole image.
    Image8    invert(const Image8& img);                                                     // Black <-> white.
    Image8    resize(const Image8& img, int newWidth, int newHeight);                 // bilinear
    Image8    boxBlur(const Image8& img, int radius);                                       // Average of each pixel's square neighbourhood.

    // --- perspective rectification -----------------------------------------------------
    // 3x3 homography, row-major.
    using Homography = std::array<double, 9>;

    // Solve the 8x8 system mapping the four `from` corners onto the four `to` corners
    // (Gaussian elimination, no linear algebra library). Corner order: TL, TR, BR, BL.
    Result<Homography> solveHomography(const std::array<Vec2, 4>& from, const std::array<Vec2, 4>& to);
    Result<Homography> invertHomography(const Homography& h);                 // The mapping that goes the other way.
    Vec2               applyHomography(const Homography& h, const Vec2& p) noexcept;   // Move one point through the mapping.

    // The user clicks the four corners of the drawing in the photo; the result is a
    // square image of outWidth x outHeight where those corners are the image corners.
    Result<Image8> rectify(const Image8& src, const std::array<Vec2, 4>& corners, int outWidth, int outHeight);

    // Count ink pixels (handy for tests and stats).
    size_t countInk(const Image8& binary) noexcept;

} // namespace wf::img
