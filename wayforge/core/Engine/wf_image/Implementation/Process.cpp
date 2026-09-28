#include "wf_image/wf_image.hpp"
#include <algorithm>

namespace wf::img {

    uint64_t Integral::rectSum(int x0, int y0, int x1, int y1) const noexcept {
        x0 = std::clamp(x0, 0, width - 1);  y0 = std::clamp(y0, 0, height - 1);
        x1 = std::clamp(x1, 0, width - 1);  y1 = std::clamp(y1, 0, height - 1);
        // sums is indexed with a +1 border so that at(x,y) = sum of pixels [0,x) x [0,y)
        return at(x1 + 1, y1 + 1) - at(x0, y1 + 1) - at(x1 + 1, y0) + at(x0, y0);
    }

    Integral integralImage(const Image8& img) {
        Integral I; I.width = img.width; I.height = img.height;
        I.sums.assign(static_cast<size_t>(img.width + 1) * (img.height + 1), 0);
        const int W = img.width + 1;
        for (int y = 0; y < img.height; ++y) {
            uint64_t row = 0;
            for (int x = 0; x < img.width; ++x) {
                row += img.at(x, y);
                I.sums[static_cast<size_t>(y + 1) * W + (x + 1)] = I.sums[static_cast<size_t>(y) * W + (x + 1)] + row;
            }
        }
        return I;
    }

    Image8 adaptiveThreshold(const Image8& grey, const ThresholdParams& p) {
        Image8 out(grey.width, grey.height, 255);
        if (grey.empty()) return out;
        const Integral I = integralImage(grey);
        const int r = std::max(1, p.window / 2);
        for (int y = 0; y < grey.height; ++y) {
            for (int x = 0; x < grey.width; ++x) {
                const int x0 = std::max(0, x - r), y0 = std::max(0, y - r);
                const int x1 = std::min(grey.width - 1, x + r), y1 = std::min(grey.height - 1, y + r);
                const uint64_t count = static_cast<uint64_t>(x1 - x0 + 1) * (y1 - y0 + 1);
                const double mean = static_cast<double>(I.rectSum(x0, y0, x1, y1)) / static_cast<double>(count);
                out.at(x, y) = (grey.at(x, y) < mean - p.offset) ? 0 : 255;
            }
        }
        return out;
    }

    Image8 globalThreshold(const Image8& grey, uint8_t level) {
        Image8 out(grey.width, grey.height);
        for (size_t i = 0; i < grey.pixels.size(); ++i) out.pixels[i] = grey.pixels[i] < level ? 0 : 255;
        return out;
    }

    Image8 invert(const Image8& img) {
        Image8 out = img;
        for (auto& p : out.pixels) p = static_cast<uint8_t>(255 - p);
        return out;
    }

    Image8 boxBlur(const Image8& img, int radius) {
        if (radius <= 0) return img;
        const Integral I = integralImage(img);
        Image8 out(img.width, img.height);
        for (int y = 0; y < img.height; ++y)
            for (int x = 0; x < img.width; ++x) {
                const int x0 = std::max(0, x - radius), y0 = std::max(0, y - radius);
                const int x1 = std::min(img.width - 1, x + radius), y1 = std::min(img.height - 1, y + radius);
                const uint64_t n = static_cast<uint64_t>(x1 - x0 + 1) * (y1 - y0 + 1);
                out.at(x, y) = static_cast<uint8_t>(I.rectSum(x0, y0, x1, y1) / n);
            }
        return out;
    }

    static float bilinear(const Image8& img, float fx, float fy) noexcept {
        const int x0 = static_cast<int>(std::floor(fx)), y0 = static_cast<int>(std::floor(fy));
        const float tx = fx - x0, ty = fy - y0;
        const float a = img.sample(x0, y0), b = img.sample(x0 + 1, y0);
        const float c = img.sample(x0, y0 + 1), d = img.sample(x0 + 1, y0 + 1);
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }

    Image8 resize(const Image8& img, int nw, int nh) {
        Image8 out(nw, nh);
        if (img.empty() || nw <= 0 || nh <= 0) return out;
        const float sx = static_cast<float>(img.width) / nw, sy = static_cast<float>(img.height) / nh;
        for (int y = 0; y < nh; ++y)
            for (int x = 0; x < nw; ++x)
                out.at(x, y) = static_cast<uint8_t>(std::clamp(bilinear(img, (x + 0.5f) * sx - 0.5f, (y + 0.5f) * sy - 0.5f), 0.f, 255.f));
        return out;
    }

    // ---- homography ---------------------------------------------------------------------
    // Solves A x = b for the 8 unknowns of H (h33 = 1) with partial-pivot Gaussian elimination.
    static bool solve8x8(double A[8][9]) {
        for (int col = 0; col < 8; ++col) {
            int pivot = col;
            for (int r = col + 1; r < 8; ++r) if (std::abs(A[r][col]) > std::abs(A[pivot][col])) pivot = r;
            if (std::abs(A[pivot][col]) < 1e-12) return false;
            if (pivot != col) for (int c = 0; c < 9; ++c) std::swap(A[pivot][c], A[col][c]);
            for (int r = 0; r < 8; ++r) {
                if (r == col) continue;
                const double f = A[r][col] / A[col][col];
                for (int c = col; c < 9; ++c) A[r][c] -= f * A[col][c];
            }
        }
        for (int r = 0; r < 8; ++r) A[r][8] /= A[r][r];
        return true;
    }

    Result<Homography> solveHomography(const std::array<Vec2, 4>& from, const std::array<Vec2, 4>& to) {
        double A[8][9] = {};
        for (int i = 0; i < 4; ++i) {
            const double x = from[i].x, y = from[i].y, u = to[i].x, v = to[i].y;
            double* r0 = A[2 * i]; double* r1 = A[2 * i + 1];
            r0[0] = x; r0[1] = y; r0[2] = 1; r0[3] = 0; r0[4] = 0; r0[5] = 0; r0[6] = -u * x; r0[7] = -u * y; r0[8] = u;
            r1[0] = 0; r1[1] = 0; r1[2] = 0; r1[3] = x; r1[4] = y; r1[5] = 1; r1[6] = -v * x; r1[7] = -v * y; r1[8] = v;
        }
        if (!solve8x8(A)) return Result<Homography>::fail("homography: the four corners are degenerate (collinear or repeated)");
        Homography h{};
        for (int i = 0; i < 8; ++i) h[static_cast<size_t>(i)] = A[i][8];
        h[8] = 1.0;
        return h;
    }

    Result<Homography> invertHomography(const Homography& m) {
        const double det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
        if (std::abs(det) < 1e-14) return Result<Homography>::fail("homography is singular");
        const double id = 1.0 / det;
        Homography r;
        r[0] = (m[4] * m[8] - m[5] * m[7]) * id; r[1] = -(m[1] * m[8] - m[2] * m[7]) * id; r[2] = (m[1] * m[5] - m[2] * m[4]) * id;
        r[3] = -(m[3] * m[8] - m[5] * m[6]) * id; r[4] = (m[0] * m[8] - m[2] * m[6]) * id; r[5] = -(m[0] * m[5] - m[2] * m[3]) * id;
        r[6] = (m[3] * m[7] - m[4] * m[6]) * id; r[7] = -(m[0] * m[7] - m[1] * m[6]) * id; r[8] = (m[0] * m[4] - m[1] * m[3]) * id;
        return r;
    }

    Vec2 applyHomography(const Homography& h, const Vec2& p) noexcept {
        const double w = h[6] * p.x + h[7] * p.y + h[8];
        const double iw = std::abs(w) < 1e-12 ? 0.0 : 1.0 / w;
        return { static_cast<float>((h[0] * p.x + h[1] * p.y + h[2]) * iw),
                 static_cast<float>((h[3] * p.x + h[4] * p.y + h[5]) * iw) };
    }

    Result<Image8> rectify(const Image8& src, const std::array<Vec2, 4>& corners, int outW, int outH) {
        if (src.empty()) return Result<Image8>::fail("rectify: empty source image");
        if (outW <= 0 || outH <= 0) return Result<Image8>::fail("rectify: output size must be positive");
        const std::array<Vec2, 4> target = { Vec2{0, 0}, Vec2{static_cast<float>(outW), 0},
                                             Vec2{static_cast<float>(outW), static_cast<float>(outH)}, Vec2{0, static_cast<float>(outH)} };
        // Map output -> input directly so every output pixel samples the input bilinearly.
        auto h = solveHomography(target, corners);
        if (!h) return Result<Image8>::fail(h.error());
        Image8 out(outW, outH);
        for (int y = 0; y < outH; ++y)
            for (int x = 0; x < outW; ++x) {
                const Vec2 s = applyHomography(*h, { x + 0.5f, y + 0.5f });
                const float v = bilinear(src, s.x - 0.5f, s.y - 0.5f);
                out.at(x, y) = static_cast<uint8_t>(std::clamp(v, 0.f, 255.f));
            }
        return out;
    }

} // namespace wf::img
