/*!
 * \file Svg.cpp
 * \brief Reading SVG floor plans straight into line segments
 *
 * The "vector shortcut": an SVG drawing already contains lines, so there is
 * no need to threshold and trace pixels. This file reads the SVG with
 * pugixml and turns <line>, <polyline>, <polygon>, <rect> and <path> into
 * Segments, applying any translate/scale/rotate/matrix transforms and the
 * viewBox. Curves are replaced by straight chords (with a warning), and
 * text/circles/images are skipped. The result goes through the same
 * clean-up (Clean.cpp) as the picture path.
 *
 * Links: wf_api::wf_convert_svg / wf_open_plan(".svg") -> importSvg ->
 *        vec::scale -> vec::clean -> wf_read.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu), Kervin Ong
 *
 * Contribution: Ananthan Elangovan 50%, Kervin Ong 50%
 *   - SVG element walking with nested <g> transforms
 *   - Path parser for M/L/H/V/Z (absolute and relative) with curves as chords
 *   - viewBox handling and clear parse errors
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-28
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_vector/wf_vector.hpp"   // SvgImportResult, Segment and importSvg.
#include <pugixml.hpp>               // pugixml: reads the SVG's XML (approved library).
#include <sstream>
#include <cctype>                    // isdigit / isalpha / isspace for the path parser.
#include <cstring>                   // strcmp for element names.
#include <cmath>                     // cos / sin for rotate().

namespace wf::vec {
    namespace {   // Helpers only used in this file.

        // A 2D transform as 6 numbers. Every SVG transform (move, scale, rotate, matrix) fits this form.
        struct Xform {                        // affine: x' = a*x + c*y + e ; y' = b*x + d*y + f
            double a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;   // Starts as "do nothing".
            Vec2 apply(double x, double y) const noexcept {
                return { static_cast<float>(a * x + c * y + e), static_cast<float>(b * x + d * y + f) };
            }
            Xform then(const Xform& o) const noexcept {          // this applied first, then o we need o . this
                Xform r;
                r.a = o.a * a + o.c * b;  r.b = o.b * a + o.d * b;
                r.c = o.a * c + o.c * d;  r.d = o.b * c + o.d * d;
                r.e = o.a * e + o.c * f + o.e;  r.f = o.b * e + o.d * f + o.f;
                return r;
            }
        };

        // Pull every number out of text like "10,20 30-40" -> {10, 20, 30, -40}.
        std::vector<double> numbers(std::string_view s) {
            std::vector<double> out;
            std::string cur;   // The number being read right now.
            auto flush = [&] { if (!cur.empty()) { out.push_back(std::atof(cur.c_str())); cur.clear(); } };
            for (size_t i = 0; i < s.size(); ++i) {
                const char ch = s[i];
                if (std::isdigit(static_cast<unsigned char>(ch)) || ch == '.' || ch == 'e' || ch == 'E') cur += ch;
                else if (ch == '-' || ch == '+') {
                    // A minus after "e" is part of the number (1e-5); otherwise it starts a new number ("30-40").
                    if (!cur.empty() && (cur.back() == 'e' || cur.back() == 'E')) cur += ch;
                    else { flush(); cur += ch; }
                }
                else flush();   // Space, comma or anything else ends the number.
            }
            flush();
            return out;
        }

        // Read a transform="..." attribute and combine it with the parent's transform.
        Xform parseTransform(const char* text, const Xform& parent) {
            Xform result;                                              // identity, composed left to right
            if (!text || !*text) return result.then(parent);           // No transform: just inherit the parent's.
            std::string s(text);
            size_t pos = 0;
            // Read each "name(numbers)" in turn, e.g. "translate(10,20) scale(2)".
            while (pos < s.size()) {
                size_t open = s.find('(', pos);
                if (open == std::string::npos) break;
                size_t close = s.find(')', open);
                if (close == std::string::npos) break;
                std::string name = s.substr(pos, open - pos);
                name.erase(std::remove_if(name.begin(), name.end(), [](unsigned char c) { return std::isspace(c) || c == ','; }), name.end());
                auto v = numbers(s.substr(open + 1, close - open - 1));
                Xform t;
                if (name == "translate") { t.e = v.size() > 0 ? v[0] : 0; t.f = v.size() > 1 ? v[1] : 0; }
                else if (name == "scale") { t.a = v.size() > 0 ? v[0] : 1; t.d = v.size() > 1 ? v[1] : t.a; }   // scale(2) = scale(2, 2).
                else if (name == "matrix" && v.size() == 6) { t.a = v[0]; t.b = v[1]; t.c = v[2]; t.d = v[3]; t.e = v[4]; t.f = v[5]; }
                else if (name == "rotate" && !v.empty()) {
                    const double r = v[0] * 3.14159265358979323846 / 180.0;   // Degrees -> radians.
                    t.a = std::cos(r); t.b = std::sin(r); t.c = -std::sin(r); t.d = std::cos(r);
                    if (v.size() == 3) {              // rotate about a point: T(cx,cy) R T(-cx,-cy)
                        Xform pre; pre.e = -v[1]; pre.f = -v[2];
                        Xform post; post.e = v[1]; post.f = v[2];
                        t = pre.then(t).then(post);
                    }
                }
                // SVG applies transforms right-to-left: "translate scale" means scale first, then translate.
                result = t.then(result);
                pos = close + 1;
            }
            return result.then(parent);   // Our own transform first, then whatever the parent <g> does.
        }

        // Small helper holding the result we are filling in.
        struct Ctx {
            SvgImportResult& out;
            // Add one line, transformed into page coordinates. Zero-length lines are skipped.
            void add(const Xform& x, double x1, double y1, double x2, double y2) {
                Segment s; s.a = x.apply(x1, y1); s.b = x.apply(x2, y2);
                if (s.length() > 1e-6f) out.segments.push_back(s);
            }
            // Add a chain of lines from a flat list x0 y0 x1 y1 ...; close=true joins the last point back to the first.
            void addPoly(const Xform& x, const std::vector<double>& v, bool close) {
                for (size_t i = 0; i + 3 < v.size(); i += 2) add(x, v[i], v[i + 1], v[i + 2], v[i + 3]);
                if (close && v.size() >= 6) add(x, v[v.size() - 2], v[v.size() - 1], v[0], v[1]);
            }
        };

        // Read a <path d="M 0 0 L 10 0 ..."> and add its straight parts as segments.
        void parsePath(Ctx& ctx, const Xform& x, const char* d) {
            // Tokenise: commands are letters, everything else numbers.
            std::string s(d ? d : "");
            double cx = 0, cy = 0, sx = 0, sy = 0;   // Current pen position, and where this sub-path started (for Z).
            char cmd = 0;
            size_t i = 0;
            auto skipWs = [&] { while (i < s.size() && (std::isspace(static_cast<unsigned char>(s[i])) || s[i] == ',')) ++i; };
            auto readNum = [&](double& v) -> bool {
                skipWs();
                if (i >= s.size()) return false;
                const char* start = s.c_str() + i;
                char* end = nullptr;
                v = std::strtod(start, &end);   // Read one number and see how many characters it used.
                if (end == start) return false;
                i += static_cast<size_t>(end - start);
                return true;
                };
            bool curveWarned = false;
            while (true) {
                skipWs();
                if (i >= s.size()) break;
                if (std::isalpha(static_cast<unsigned char>(s[i]))) { cmd = s[i++]; }   // A new command letter; otherwise repeat the last one.
                if (!cmd) break;
                const bool rel = std::islower(static_cast<unsigned char>(cmd));   // Lower case = relative to the current position.
                const char C = static_cast<char>(std::toupper(static_cast<unsigned char>(cmd)));
                double a = 0, b = 0;
                switch (C) {
                case 'M': {   // Move the pen without drawing.
                    if (!readNum(a) || !readNum(b)) { i = s.size(); break; }
                    if (rel) { a += cx; b += cy; }
                    cx = sx = a; cy = sy = b;
                    cmd = rel ? 'l' : 'L';                   // subsequent pairs are implicit lineto
                    break;
                }
                case 'L': {   // Draw a line to (a, b).
                    if (!readNum(a) || !readNum(b)) { i = s.size(); break; }
                    if (rel) { a += cx; b += cy; }
                    ctx.add(x, cx, cy, a, b); cx = a; cy = b;
                    break;
                }
                case 'H': { if (!readNum(a)) { i = s.size(); break; } if (rel) a += cx; ctx.add(x, cx, cy, a, cy); cx = a; break; }   // Horizontal line.
                case 'V': { if (!readNum(a)) { i = s.size(); break; } if (rel) a += cy; ctx.add(x, cx, cy, cx, a); cy = a; break; }   // Vertical line.
                case 'Z': { ctx.add(x, cx, cy, sx, sy); cx = sx; cy = sy; cmd = 0; break; }                                         // Close back to the start.
                case 'C': case 'S': case 'Q': case 'T': case 'A': {
                    // Curves: consume the right number of values and replace with a chord.
                    const int count = C == 'C' ? 6 : C == 'S' ? 4 : C == 'Q' ? 4 : C == 'T' ? 2 : 7;
                    std::vector<double> v(static_cast<size_t>(count));
                    bool ok = true;
                    for (int k = 0; k < count && ok; ++k) ok = readNum(v[static_cast<size_t>(k)]);
                    if (!ok) { i = s.size(); break; }
                    double ex = v[static_cast<size_t>(count - 2)], ey = v[static_cast<size_t>(count - 1)];   // The last two numbers are always the end point.
                    if (rel) { ex += cx; ey += cy; }
                    ctx.add(x, cx, cy, ex, ey); cx = ex; cy = ey;
                    if (!curveWarned) { ctx.out.warnings.push_back("path curve commands replaced by straight chords"); curveWarned = true; }
                    ++ctx.out.ignoredElements;
                    break;
                }
                default: i = s.size(); break;   // Unknown command: stop reading this path.
                }
            }
        }

        // Go through every child element, turning the ones we understand into segments.
        void walk(Ctx& ctx, const pugi::xml_node& node, const Xform& parent) {
            for (pugi::xml_node child : node.children()) {
                const char* name = child.name();
                const Xform x = parseTransform(child.attribute("transform").as_string(nullptr), parent);
                if (std::strcmp(name, "g") == 0 || std::strcmp(name, "svg") == 0 || std::strcmp(name, "a") == 0) {
                    walk(ctx, child, x);   // A group: look inside it, passing its transform down.
                }
                else if (std::strcmp(name, "line") == 0) {
                    ctx.add(x, child.attribute("x1").as_double(), child.attribute("y1").as_double(),
                        child.attribute("x2").as_double(), child.attribute("y2").as_double());
                }
                else if (std::strcmp(name, "polyline") == 0) {
                    ctx.addPoly(x, numbers(child.attribute("points").as_string()), false);   // Open chain.
                }
                else if (std::strcmp(name, "polygon") == 0) {
                    ctx.addPoly(x, numbers(child.attribute("points").as_string()), true);    // Closed shape.
                }
                else if (std::strcmp(name, "rect") == 0) {
                    // A rectangle = 4 lines round its corners.
                    const double rx = child.attribute("x").as_double(), ry = child.attribute("y").as_double();
                    const double w = child.attribute("width").as_double(), h = child.attribute("height").as_double();
                    ctx.addPoly(x, { rx, ry, rx + w, ry, rx + w, ry + h, rx, ry + h }, true);
                }
                else if (std::strcmp(name, "path") == 0) {
                    parsePath(ctx, x, child.attribute("d").as_string());
                }
                else if (std::strcmp(name, "defs") == 0 || std::strcmp(name, "metadata") == 0 || std::strcmp(name, "title") == 0 || std::strcmp(name, "desc") == 0 || std::strcmp(name, "style") == 0) {
                    // ignore silently
                }
                else if (child.type() == pugi::node_element) {
                    // Anything else is counted as ignored. Text, circles and images are expected in plans,
                    // so only truly unknown elements get a warning.
                    ++ctx.out.ignoredElements;
                    if (std::strcmp(name, "text") != 0 && std::strcmp(name, "circle") != 0 && std::strcmp(name, "ellipse") != 0 && std::strcmp(name, "image") != 0)
                        ctx.out.warnings.push_back(std::string("unsupported element <") + name + "> ignored");
                }
            }
        }

        double lengthValue(const char* s) {            // "800px" / "210mm" -> number (units ignored)
            return s ? std::atof(s) : 0.0;
        }

    } // namespace

    Result<SvgImportResult> importSvgText(std::string_view svg) {
        pugi::xml_document doc;
        pugi::xml_parse_result pr = doc.load_buffer(svg.data(), svg.size());   // pugixml parses the XML text.
        if (!pr) return Result<SvgImportResult>::fail(std::string("SVG parse error at offset ") + std::to_string(pr.offset) + ": " + pr.description());
        pugi::xml_node root = doc.child("svg");
        if (!root) return Result<SvgImportResult>::fail("not an SVG: no <svg> root element");

        SvgImportResult out;
        out.width = static_cast<float>(lengthValue(root.attribute("width").as_string(nullptr)));
        out.height = static_cast<float>(lengthValue(root.attribute("height").as_string(nullptr)));
        Xform rootXform;
        // viewBox="minx miny w h" says which part of the drawing fills the page; map it onto width x height.
        if (const char* vb = root.attribute("viewBox").as_string(nullptr)) {
            auto v = numbers(vb);
            if (v.size() == 4 && v[2] > 0 && v[3] > 0) {
                if (out.width <= 0.f)  out.width = static_cast<float>(v[2]);    // No width given: use the viewBox size.
                if (out.height <= 0.f) out.height = static_cast<float>(v[3]);
                // viewBox -> user units: translate(-minx,-miny) then scale(w/vw)
                Xform t; t.e = -v[0]; t.f = -v[1];
                Xform sc; sc.a = out.width / v[2]; sc.d = out.height / v[3];
                rootXform = t.then(sc);
            }
        }
        Ctx ctx{ out };
        walk(ctx, root, parseTransform(root.attribute("transform").as_string(nullptr), rootXform));   // Read the whole drawing.
        if (out.segments.empty()) return Result<SvgImportResult>::fail("SVG contains no line geometry (only curves, text or images?)");
        return out;
    }

    Result<SvgImportResult> importSvg(const std::filesystem::path& path) {
        auto text = io::readText(path);   // Read the file (wf_core), then parse the text.
        if (!text) return Result<SvgImportResult>::fail(text.error());
        auto r = importSvgText(*text);
        if (!r) return Result<SvgImportResult>::fail(path.string() + ": " + r.error());   // Add the file name to the error.
        return r;
    }

} // namespace wf::vec
