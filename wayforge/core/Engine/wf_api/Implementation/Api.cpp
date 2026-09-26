#define WF_API_BUILDING 1
#include "wf_api/wf_api.h"
#include "wf_doc/wf_doc.hpp"
#include "wf_vector/wf_vector.hpp"
#include "wf_read/wf_read.hpp"
#include "wf_graph/wf_graph.hpp"
#include <cstring>
#include <string>
#include <algorithm>

struct wf_doc_t {
    wf::Document doc;
    wf::graph::Route lastRoute;                // kept so wf_instructions can describe it
};

// helpers 
namespace {

    thread_local std::string g_lastError;

    void setError(std::string msg) { g_lastError = std::move(msg); }

    int copyOut(const std::string& s, char* out, int cap) {
        if (!out || cap <= 0) return -1;
        const int n = static_cast<int>(std::min<size_t>(s.size(), static_cast<size_t>(cap - 1)));
        std::memcpy(out, s.data(), static_cast<size_t>(n));
        out[n] = '\0';
        return n;
    }

    const wf::Level* levelOf(wf_doc d, int level) {
        if (!d) { setError("null document"); return nullptr; }
        const wf::Level* l = d->doc.level(level);
        if (!l) setError("level index " + std::to_string(level) + " out of range (document has " + std::to_string(d->doc.levelCount()) + ")");
        return l;
    }

    wf::ElementKind toKind(int k, bool& ok) {
        ok = k >= 0 && k <= 6;
        return static_cast<wf::ElementKind>(k);
    }

    std::span<const wf::PropertyInfo> propsFor(int kind) {
        switch (kind) {
        case 0: return wf::propertiesOf<wf::Wall>();
        case 1: return wf::propertiesOf<wf::Opening>();
        case 2: return wf::propertiesOf<wf::Room>();
        case 3: return wf::propertiesOf<wf::Node>();
        case 4: return wf::propertiesOf<wf::Poi>();
        case 5: return wf::propertiesOf<wf::Anchor>();
        case 6: return wf::propertiesOf<wf::Level>();
        default: return {};
        }
    }

    // Convert "0.3" / "true" / "1,2" / "door" into the right PropertyValue for a property.
    bool parseValue(const wf::PropertyInfo& p, const char* text, wf::PropertyValue& out) {
        if (!text) return false;
        const std::string s(text);
        try {
            switch (p.type) {
            case wf::PropertyType::Bool:   out = (s == "true" || s == "1" || s == "yes"); return true;
            case wf::PropertyType::Int:    out = std::stoi(s); return true;
            case wf::PropertyType::Float:  out = std::stof(s); return true;
            case wf::PropertyType::String: out = s; return true;
            case wf::PropertyType::Enum:   out = s; return true;
            case wf::PropertyType::Vec2: {
                const size_t c = s.find(',');
                if (c == std::string::npos) return false;
                out = wf::Vec2{ std::stof(s.substr(0, c)), std::stof(s.substr(c + 1)) };
                return true;
            }
            }
        }
        catch (...) { return false; }
        return false;
    }

    int writeRoute(wf_doc d, const wf::Result<wf::graph::Route>& r, const wf::Building& b, float* out, int maxFloats, float* costOut) {
        if (!r) { setError(r.error()); return -1; }
        d->lastRoute = *r;
        int written = 0;
        for (const auto& s : r->steps) {
            if (written + 3 > maxFloats) break;
            const wf::Level* l = b.findLevel(s.level);
            out[written++] = s.pos.x; out[written++] = s.pos.y; out[written++] = l ? l->elevation : 0.f;
        }
        if (costOut) *costOut = r->totalCost;
        return written;
    }

} // namespace

#define WF_TRY try {
#define WF_CATCH(ret) } catch (const std::exception& e) { setError(e.what()); return ret; } catch (...) { setError("unknown exception"); return ret; }

// lifecycle 
WF_API int         wf_ping(void) { return 42; }
WF_API const char* wf_version(void) { return wf::kVersionString; }
WF_API const char* wf_platform(void) { return wf::platformName(); }
WF_API const char* wf_last_error(void) { return g_lastError.c_str(); }

WF_API wf_doc wf_convert_svg(const char* path, float metresPerUnit) {
    WF_TRY
        if (!path) { setError("null path"); return nullptr; }
    auto svg = wf::vec::importSvg(path);
    if (!svg) { setError(svg.error()); return nullptr; }
    auto segs = wf::vec::scale(svg->segments, metresPerUnit, {}, true, svg->height);
    segs = wf::vec::clean(segs);
    wf::Building b;
    b.building.name = std::filesystem::path(path).stem().string();
    b.source.file = std::filesystem::path(path).filename().string();
    b.source.pixelsPerMetre = metresPerUnit > 0 ? 1.f / metresPerUnit : 0.f;
    wf::Level level; level.id = "L1"; level.name = "Level 1";
    wf::IdGenerator ids;
    auto st = wf::read::interpret(segs, level, ids, {});
    if (!st) { setError(st.error()); return nullptr; }
    b.levels.push_back(std::move(level));
    auto* h = new wf_doc_t{ wf::Document(std::move(b)), {} };
    return h;
    WF_CATCH(nullptr)
}

WF_API wf_doc wf_open_plan(const char* path) {
    WF_TRY
        if (!path) { setError("null path"); return nullptr; }
    const std::string ext = wf::io::lowerExtension(path);
    if (ext == ".svg") return wf_convert_svg(path, 1.f);
    auto doc = wf::Document::load(path);
    if (!doc) { setError(doc.error()); return nullptr; }
    return new wf_doc_t{ std::move(doc.value()), {} };
    WF_CATCH(nullptr)
}

WF_API wf_doc wf_new_doc(const char* name) {
    WF_TRY
        wf::Building b; b.building.name = name ? name : "Untitled";
    return new wf_doc_t{ wf::Document(std::move(b)), {} };
    WF_CATCH(nullptr)
}

WF_API void wf_close(wf_doc d) { delete d; }

WF_API int wf_save(wf_doc d, const char* path) {
    WF_TRY
        if (!d || !path) { setError("null argument"); return -1; }
    auto s = d->doc.save(path);
    if (!s) { setError(s.message); return -1; }
    return 0;
    WF_CATCH(-1)
}
WF_API int wf_is_dirty(wf_doc d) { return d ? (d->doc.dirty() ? 1 : 0) : -1; }

// levels 
WF_API int wf_level_count(wf_doc d) { return d ? d->doc.levelCount() : -1; }
WF_API int wf_get_level_id(wf_doc d, int level, char* out, int cap) {
    WF_TRY const wf::Level* l = levelOf(d, level); if (!l) return -1; return copyOut(l->id, out, cap); WF_CATCH(-1)
}
WF_API int wf_add_level(wf_doc d, const char* id, const char* name, float elevation) {
    WF_TRY
        if (!d || !id) { setError("null argument"); return -1; }
    wf::Level l; l.id = id; l.name = name ? name : id; l.elevation = elevation;
    return d->doc.addLevel(std::move(l));
    WF_CATCH(-1)
}

// walls 
WF_API int wf_wall_count(wf_doc d, int level) { WF_TRY const wf::Level* l = levelOf(d, level); return l ? static_cast<int>(l->walls.size()) : -1; WF_CATCH(-1) }
WF_API int wf_get_walls(wf_doc d, int level, float* out, int maxFloats) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !out) return -1;
    int n = 0;
    for (const auto& w : l->walls) {
        if (n + 5 > maxFloats) break;
        out[n++] = w.a.x; out[n++] = w.a.y; out[n++] = w.b.x; out[n++] = w.b.y; out[n++] = w.thickness;
    }
    return n;
    WF_CATCH(-1)
}
WF_API int wf_get_wall_confidence(wf_doc d, int level, float* out, int maxFloats) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !out) return -1;
    int n = 0; for (const auto& w : l->walls) { if (n >= maxFloats) break; out[n++] = w.confidence; }
    return n;
    WF_CATCH(-1)
}
WF_API int wf_get_wall_id(wf_doc d, int level, int i, char* out, int cap) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l) return -1;
    if (i < 0 || i >= static_cast<int>(l->walls.size())) { setError("wall index out of range"); return -1; }
    return copyOut(l->walls[static_cast<size_t>(i)].id, out, cap);
    WF_CATCH(-1)
}
WF_API int wf_add_wall(wf_doc d, int level, float ax, float ay, float bx, float by, float t, char* idOut, int idCap) {
    WF_TRY
        if (!levelOf(d, level)) return -1;
    std::string id = d->doc.addWall(level, { ax, ay }, { bx, by }, t);
    if (idOut) copyOut(id, idOut, idCap);
    return 0;
    WF_CATCH(-1)
}
WF_API int wf_move_wall(wf_doc d, int level, const char* wallId, float ax, float ay, float bx, float by) {
    WF_TRY
        if (!levelOf(d, level) || !wallId) return -1;
    if (!d->doc.moveWall(level, wallId, { ax, ay }, { bx, by })) { setError(std::string("no wall '") + wallId + "'"); return -1; }
    return 0;
    WF_CATCH(-1)
}
WF_API int wf_delete_wall(wf_doc d, int level, const char* wallId) {
    WF_TRY
        if (!levelOf(d, level) || !wallId) return -1;
    if (!d->doc.deleteWall(level, wallId)) { setError(std::string("no wall '") + wallId + "'"); return -1; }
    return 0;
    WF_CATCH(-1)
}

// openings 
WF_API int wf_opening_count(wf_doc d, int level) { WF_TRY const wf::Level* l = levelOf(d, level); return l ? static_cast<int>(l->openings.size()) : -1; WF_CATCH(-1) }
WF_API int wf_get_openings(wf_doc d, int level, float* out, int maxFloats) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !out) return -1;
    int n = 0;
    for (const auto& o : l->openings) {
        if (n + 4 > maxFloats) break;
        const wf::Wall* w = l->findWall(o.wall);
        const wf::Vec2 p = w ? wf::openingPosition(*w, o) : wf::Vec2{};
        out[n++] = p.x; out[n++] = p.y; out[n++] = o.width; out[n++] = static_cast<float>(o.type);
    }
    return n;
    WF_CATCH(-1)
}