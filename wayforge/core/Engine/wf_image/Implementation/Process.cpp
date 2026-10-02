/*!
 * \file Process.cpp
 * \brief Image processing: ink/paper threshold, blur, resize and perspective fix
 *
 * The main job here is adaptiveThreshold: for every pixel it compares the
 * pixel with the average brightness around it, so dark lines count as ink
 * even when one side of a photo is in shadow. To make that average fast on
 * big scans it uses an "integral image" (a running-sum table) so any
 * rectangle's total takes four lookups instead of adding every pixel.
 * The homography functions straighten a plan photographed at an angle,
 * using our own small equation solver (no maths library needed).
 *
 * Links: called by wf_api::wf_convert_image right after img::load();
 * the black-and-white result goes to wf_vector::thin (Raster.cpp).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Integral image and adaptive (local mean) threshold
 *   - Homography solver (Gaussian elimination) and rectify with bilinear sampling
 *   - Supporting tools: global threshold, invert, box blur, resize
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-27
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_image/wf_image.hpp"   // Image8, Integral, Homography and the functions defined here.
#include <algorithm>               // std::clamp, std::min, std::max.

namespace wf::img {

    // ---- integral image ---------------------------------------------------------------

    uint64_t Integral::rectSum(int x0, int y0, int x1, int y1) const noexcept {
        // Keep the rectangle inside the image so we never read outside the table.
        x0 = std::clamp(x0, 0, width - 1);  y0 = std::clamp(y0, 0, height - 1);
        x1 = std::clamp(x1, 0, width - 1);  y1 = std::clamp(y1, 0, height - 1);
        // sums is indexed with a +1 border so that at(x,y) = sum of pixels [0,x) x [0,y)
        // Big corner, minus the strip on the left, minus the strip above, plus the top-left corner we subtracted twice.
        return at(x1 + 1, y1 + 1) - at(x0, y1 + 1) - at(x1 + 1, y0) + at(x0, y0);
    }

    Integral integralImage(const Image8& img) {
        Integral I; I.width = img.width; I.height = img.height;
        // One extra row and column of zeros at the top/left, so rectSum never needs special cases at the edges.
        I.sums.assign(static_cast<size_t>(img.width + 1) * (img.height + 1), 0);
        const int W = img.width + 1;
        for (int y = 0; y < img.height; ++y) {
            uint64_t row = 0;   // Running total of this row so far.
            for (int x = 0; x < img.width; ++x) {
                row += img.at(x, y);
                // Cell = everything above it (previous row's cell) + this row up to here.
                I.sums[static_cast<size_t>(y + 1) * W + (x + 1)] = I.sums[static_cast<size_t>(y) * W + (x + 1)] + row;
            }
        }
        return I;
    }

    // ---- thresholds and simple filters ------------------------------------------------

    Image8 adaptiveThreshold(const Image8& grey, const ThresholdParams& p) {
        Image8 out(grey.width, grey.height, 255);   // Start all white (paper).
        if (grey.empty()) return out;
        const Integral I = integralImage(grey);     // Build once, then every average below is 4 lookups.
        const int r = std::max(1, p.window / 2);    // Window 15 -> look 7 pixels each way.
        for (int y = 0; y < grey.height; ++y) {
            for (int x = 0; x < grey.width; ++x) {
                // The square around this pixel, cut short at the image edges.
                const int x0 = std::max(0, x - r), y0 = std::max(0, y - r);
                const int x1 = std::min(grey.width - 1, x + r), y1 = std::min(grey.height - 1, y + r);
                const uint64_t count = static_cast<uint64_t>(x1 - x0 + 1) * (y1 - y0 + 1);
                const double mean = static_cast<double>(I.rectSum(x0, y0, x1, y1)) / static_cast<double>(count);   // Local average brightness.
                // Ink only if clearly darker than its surroundings; the offset stops paper texture becoming ink.
                out.at(x, y) = (grey.at(x, y) < mean - p.offset) ? 0 : 255;
            }
        }
        return out;
    }

    Image8 globalThreshold(const Image8& grey, uint8_t level) {
        // Simpler version: one cut-off for the whole picture. Fine for clean scans, poor for photos.
        Image8 out(grey.width, grey.height);
        for (size_t i = 0; i < grey.pixels.size(); ++i) out.pixels[i] = grey.pixels[i] < level ? 0 : 255;
        return out;
    }

    Image8 invert(const Image8& img) {
        Image8 out = img;
        for (auto& p : out.pixels) p = static_cast<uint8_t>(255 - p);   // Black becomes white and the other way round.
        return out;
    }

    Image8 boxBlur(const Image8& img, int radius) {
        if (radius <= 0) return img;   // Nothing to blur.
        const Integral I = integralImage(img);
        Image8 out(img.width, img.height);
        for (int y = 0; y < img.height; ++y)
            for (int x = 0; x < img.width; ++x) {
                // Each output pixel = the average of the square around it (same trick as the threshold).
                const int x0 = std::max(0, x - radius), y0 = std::max(0, y - radius);
                const int x1 = std::min(img.width - 1, x + radius), y1 = std::min(img.height - 1, y + radius);
                const uint64_t n = static_cast<uint64_t>(x1 - x0 + 1) * (y1 - y0 + 1);
                out.at(x, y) = static_cast<uint8_t>(I.rectSum(x0, y0, x1, y1) / n);
            }
        return out;
    }

    // Reads the image "between" pixels by mixing the 4 nearest ones, for smooth resizing and rectifying.
    static float bilinear(const Image8& img, float fx, float fy) noexcept {
        const int x0 = static_cast<int>(std::floor(fx)), y0 = static_cast<int>(std::floor(fy));   // Top-left of the 4 pixels.
        const float tx = fx - x0, ty = fy - y0;                                                       // How far across (0..1).
        const float a = img.sample(x0, y0), b = img.sample(x0 + 1, y0);
        const float c = img.sample(x0, y0 + 1), d = img.sample(x0 + 1, y0 + 1);
        // Blend left/right on both rows, then blend the two rows top/bottom.
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }

    Image8 resize(const Image8& img, int nw, int nh) {
        Image8 out(nw, nh);
        if (img.empty() || nw <= 0 || nh <= 0) return out;
        const float sx = static_cast<float>(img.width) / nw, sy = static_cast<float>(img.height) / nh;   // Source pixels per output pixel.
        for (int y = 0; y < nh; ++y)
            for (int x = 0; x < nw; ++x)
                // +0.5 / -0.5 lines up pixel centres so the picture doesn't shift by half a pixel.
                out.at(x, y) = static_cast<uint8_t>(std::clamp(bilinear(img, (x + 0.5f) * sx - 0.5f, (y + 0.5f) * sy - 0.5f), 0.f, 255.f));
        return out;
    }

    // ---- homography ---------------------------------------------------------------------
    // Solves A x = b for the 8 unknowns of H (h33 = 1) with partial-pivot Gaussian elimination.
    static bool solve8x8(double A[8][9]) {
        for (int col = 0; col < 8; ++col) {
            // Pick the row with the biggest value in this column to divide by (keeps the maths stable).
            int pivot = col;
            for (int r = col + 1; r < 8; ++r) if (std::abs(A[r][col]) > std::abs(A[pivot][col])) pivot = r;
            if (std::abs(A[pivot][col]) < 1e-12) return false;   // No usable value: the corners don't form a proper shape.
            if (pivot != col) for (int c = 0; c < 9; ++c) std::swap(A[pivot][c], A[col][c]);
            // Clear this column in every other row, so each row ends up with one unknown.
            for (int r = 0; r < 8; ++r) {
                if (r == col) continue;
                const double f = A[r][col] / A[col][col];
                for (int c = col; c < 9; ++c) A[r][c] -= f * A[col][c];
            }
        }
        for (int r = 0; r < 8; ++r) A[r][8] /= A[r][r];   // Divide out what's left: column 8 now holds the 8 answers.
        return true;
    }

    Result<Homography> solveHomography(const std::array<Vec2, 4>& from, const std::array<Vec2, 4>& to) {
        double A[8][9] = {};
        // Each corner pair (x, y) -> (u, v) gives two equations, so 4 corners give the 8 we need.
        for (int i = 0; i < 4; ++i) {
            const double x = from[i].x, y = from[i].y, u = to[i].x, v = to[i].y;
            double* r0 = A[2 * i]; double* r1 = A[2 * i + 1];
            r0[0] = x; r0[1] = y; r0[2] = 1; r0[3] = 0; r0[4] = 0; r0[5] = 0; r0[6] = -u * x; r0[7] = -u * y; r0[8] = u;
            r1[0] = 0; r1[1] = 0; r1[2] = 0; r1[3] = x; r1[4] = y; r1[5] = 1; r1[6] = -v * x; r1[7] = -v * y; r1[8] = v;
        }
        if (!solve8x8(A)) return Result<Homography>::fail("homography: the four corners are degenerate (collinear or repeated)");
        Homography h{};
        for (int i = 0; i < 8; ++i) h[static_cast<size_t>(i)] = A[i][8];   // Copy the 8 answers into the 3x3 matrix...
        h[8] = 1.0;                                                         // ...and the 9th value is fixed at 1.
        return h;
    }

    Result<Homography> invertHomography(const Homography& m) {
        // Standard 3x3 inverse: determinant first; if it's ~0 the mapping can't be undone.
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
        // Multiply (x, y, 1) by the matrix, then divide by w: that division is what makes far things look smaller.
        const double w = h[6] * p.x + h[7] * p.y + h[8];
        const double iw = std::abs(w) < 1e-12 ? 0.0 : 1.0 / w;   // Avoid dividing by zero.
        return { static_cast<float>((h[0] * p.x + h[1] * p.y + h[2]) * iw),
                 static_cast<float>((h[3] * p.x + h[4] * p.y + h[5]) * iw) };
    }

    Result<Image8> rectify(const Image8& src, const std::array<Vec2, 4>& corners, int outW, int outH) {
        if (src.empty()) return Result<Image8>::fail("rectify: empty source image");
        if (outW <= 0 || outH <= 0) return Result<Image8>::fail("rectify: output size must be positive");
        // The four corners of the output image, in the same order as the clicked corners (TL, TR, BR, BL).
        const std::array<Vec2, 4> target = { Vec2{0, 0}, Vec2{static_cast<float>(outW), 0},
                                             Vec2{static_cast<float>(outW), static_cast<float>(outH)}, Vec2{0, static_cast<float>(outH)} };
        // Map output -> input directly so every output pixel samples the input bilinearly.
        auto h = solveHomography(target, corners);
        if (!h) return Result<Image8>::fail(h.error());
        Image8 out(outW, outH);
        for (int y = 0; y < outH; ++y)
            for (int x = 0; x < outW; ++x) {
                const Vec2 s = applyHomography(*h, { x + 0.5f, y + 0.5f });   // Where this output pixel's centre lands in the photo.
                const float v = bilinear(src, s.x - 0.5f, s.y - 0.5f);         // Read the photo there, smoothly.
                out.at(x, y) = static_cast<uint8_t>(std::clamp(v, 0.f, 255.f));
            }
        return out;
    }

} // namespace wf::img
