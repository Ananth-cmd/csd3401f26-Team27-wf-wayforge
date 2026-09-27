// wf_image - public header.
// Turns a photo or scan into a clean binary plan: load, greyscale, integral
// image, adaptive threshold, perspective rectify. Also writes PNGs for --debug.

#pragma once
#include <vector>
#include <cstdint>
#include <filesystem>
#include <array>
#include "wf_core/wf_core.hpp"

namespace wf::img {

    // 8-bit single channel image. 0 = black (ink), 255 = white (paper).
    struct Image8 {
        int width = 0;
        int height = 0;
        std::vector<uint8_t> pixels;

        Image8() = default;
        Image8(int w, int h, uint8_t fill = 255) : width(w), height(h), pixels(static_cast<size_t>(w)* h, fill) {}

        uint8_t  at(int x, int y) const noexcept { return pixels[static_cast<size_t>(y) * width + x]; }
        uint8_t& at(int x, int y)       noexcept { return pixels[static_cast<size_t>(y) * width + x]; }
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

    struct ThresholdParams {
        int   window = 15;       // neighbourhood size in pixels (odd)
        int   offset = 10;       // pixel is ink if it is more than `offset` below the local mean
    };

    // --- loading / saving --------------------------------------------------------------
    Result<Image8> load(const std::filesystem::path& path);              // PNG/JPG/BMP -> greyscale
    Result<Image8> loadFromMemory(const uint8_t* bytes, size_t size);
    Status         savePng(const Image8& img, const std::filesystem::path& path);
    Image8         fromRgb(const uint8_t* rgb, int width, int height, int channels);   // luminance

    // --- processing ----------------------------------------------------------------------
    Integral  integralImage(const Image8& img);
    Image8    adaptiveThreshold(const Image8& grey, const ThresholdParams& p = {});     // out: 0 ink / 255 paper
    Image8    globalThreshold(const Image8& grey, uint8_t level = 128);
    Image8    invert(const Image8& img);
    Image8    resize(const Image8& img, int newWidth, int newHeight);                 // bilinear
    Image8    boxBlur(const Image8& img, int radius);

    // --- perspective rectification -----------------------------------------------------
    // 3x3 homography, row-major.
    using Homography = std::array<double, 9>;

    // Solve the 8x8 system mapping the four `from` corners onto the four `to` corners
    // (Gaussian elimination, no linear algebra library). Corner order: TL, TR, BR, BL.
    Result<Homography> solveHomography(const std::array<Vec2, 4>& from, const std::array<Vec2, 4>& to);
    Result<Homography> invertHomography(const Homography& h);
    Vec2               applyHomography(const Homography& h, const Vec2& p) noexcept;

    // The user clicks the four corners of the drawing in the photo; the result is a
    // square image of outWidth x outHeight where those corners are the image corners.
    Result<Image8> rectify(const Image8& src, const std::array<Vec2, 4>& corners, int outWidth, int outHeight);

    // Count ink pixels (handy for tests and stats).
    size_t countInk(const Image8& binary) noexcept;

} // namespace wf::img
