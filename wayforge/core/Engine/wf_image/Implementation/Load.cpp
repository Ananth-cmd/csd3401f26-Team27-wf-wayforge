#include "wf_image/wf_image.hpp"
#include <stb_image.h>
#include <stb_image_write.h>

namespace wf::img {

    Image8 fromRgb(const uint8_t* data, int width, int height, int channels) {
        Image8 out(width, height);
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                const uint8_t* p = data + (static_cast<size_t>(y) * width + x) * channels;
                uint8_t g;
                if (channels >= 3) g = static_cast<uint8_t>((299 * p[0] + 587 * p[1] + 114 * p[2]) / 1000);   // Rec.601 luma
                else               g = p[0];
                // Transparent pixels count as paper, otherwise scans with alpha go black.
                if (channels == 4 || channels == 2) {
                    const int a = p[channels - 1];
                    g = static_cast<uint8_t>((g * a + 255 * (255 - a)) / 255);
                }
                out.at(x, y) = g;
            }
        }
        return out;
    }

    Result<Image8> load(const std::filesystem::path& path) {
        auto bytes = io::readBytes(path);
        if (!bytes) return Result<Image8>::fail(bytes.error());
        auto r = loadFromMemory(bytes->data(), bytes->size());
        if (!r) return Result<Image8>::fail(path.string() + ": " + r.error());
        return r;
    }

    Result<Image8> loadFromMemory(const uint8_t* bytes, size_t size) {
        int w = 0, h = 0, c = 0;
        stbi_uc* data = stbi_load_from_memory(bytes, static_cast<int>(size), &w, &h, &c, 0);
        if (!data) return Result<Image8>::fail(std::string("image decode failed: ") + stbi_failure_reason());
        Image8 out = fromRgb(data, w, h, c);
        stbi_image_free(data);
        return out;
    }

    Status savePng(const Image8& img, const std::filesystem::path& path) {
        if (img.empty()) return Status::fail("savePng: empty image");
        if (path.has_parent_path()) if (auto s = io::ensureDirectory(path.parent_path()); !s) return s;
        const int ok = stbi_write_png(path.string().c_str(), img.width, img.height, 1, img.pixels.data(), img.width);
        return ok ? Status::success() : Status::fail("could not write " + path.string());
    }

    size_t countInk(const Image8& b) noexcept {
        size_t n = 0; for (uint8_t p : b.pixels) if (p < 128) ++n; return n;
    }

} // namespace wf::img
