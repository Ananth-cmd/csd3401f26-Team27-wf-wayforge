/*!
 * \file Load.cpp
 * \brief Loading floor plan pictures and saving debug PNGs
 *
 * Opens a PNG/JPG/BMP file and turns it into a grey Image8 (0 = black ink,
 * 255 = white paper), ready for the threshold step. Colour pictures are
 * converted using how bright each colour looks to the eye, and see-through
 * pixels are treated as paper. Decoding is done by stb_image (approved for
 * tools); this file is the only place that talks to it besides Stb.cpp.
 *
 * Links: wf_api::wf_convert_image calls img::load(), which uses
 * io::readBytes (wf_core) and stb_image, then hands the result to
 * adaptiveThreshold (Process.cpp).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Colour -> grey conversion with transparency handled as paper
 *   - Clear error messages for missing or broken images
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-27
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_image/wf_image.hpp"   // Image8 and the functions defined here.
#include <stb_image.h>             // stbi_load_from_memory: decodes PNG/JPG/BMP.
#include <stb_image_write.h>       // stbi_write_png: writes our debug PNGs.

namespace wf::img {

    Image8 fromRgb(const uint8_t* data, int width, int height, int channels) {
        Image8 out(width, height);
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                // Each pixel takes `channels` bytes in a row (1 = grey, 2 = grey+alpha, 3 = RGB, 4 = RGBA).
                const uint8_t* p = data + (static_cast<size_t>(y) * width + x) * channels;
                uint8_t g;
                // Green looks brightest to the eye and blue darkest, so they are weighted differently.
                if (channels >= 3) g = static_cast<uint8_t>((299 * p[0] + 587 * p[1] + 114 * p[2]) / 1000);   // Rec.601 luma
                else               g = p[0];   // Already grey.
                // Transparent pixels count as paper, otherwise scans with alpha go black.
                if (channels == 4 || channels == 2) {
                    const int a = p[channels - 1];                          // Alpha: 0 = see-through, 255 = solid.
                    g = static_cast<uint8_t>((g * a + 255 * (255 - a)) / 255);   // Blend the pixel over white paper.
                }
                out.at(x, y) = g;
            }
        }
        return out;
    }

    Result<Image8> load(const std::filesystem::path& path) {
        auto bytes = io::readBytes(path);   // Read the whole file (wf_core). Fails cleanly if it's missing.
        if (!bytes) return Result<Image8>::fail(bytes.error());
        auto r = loadFromMemory(bytes->data(), bytes->size());
        if (!r) return Result<Image8>::fail(path.string() + ": " + r.error());   // Add the file name so the user knows which picture failed.
        return r;
    }

    Result<Image8> loadFromMemory(const uint8_t* bytes, size_t size) {
        int w = 0, h = 0, c = 0;   // stb fills in width, height and channel count.
        // Last argument 0 = keep the picture's own channels; fromRgb converts them to grey.
        stbi_uc* data = stbi_load_from_memory(bytes, static_cast<int>(size), &w, &h, &c, 0);
        if (!data) return Result<Image8>::fail(std::string("image decode failed: ") + stbi_failure_reason());   // Not an image, or corrupt.
        Image8 out = fromRgb(data, w, h, c);
        stbi_image_free(data);   // stb allocated the pixels, so stb must free them.
        return out;
    }

    Status savePng(const Image8& img, const std::filesystem::path& path) {
        if (img.empty()) return Status::fail("savePng: empty image");
        if (path.has_parent_path()) if (auto s = io::ensureDirectory(path.parent_path()); !s) return s;   // Make the output folder if needed.
        // 1 channel (grey). The last value is the number of bytes per row.
        const int ok = stbi_write_png(path.string().c_str(), img.width, img.height, 1, img.pixels.data(), img.width);
        return ok ? Status::success() : Status::fail("could not write " + path.string());
    }

    size_t countInk(const Image8& b) noexcept {
        // Anything darker than mid-grey counts as ink. Used by tests to check a step did what we expect.
        size_t n = 0; for (uint8_t p : b.pixels) if (p < 128) ++n; return n;
    }

} // namespace wf::img
