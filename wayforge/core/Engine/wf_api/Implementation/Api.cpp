/*!

\file Api.cpp

\brief Implementation of the public Wayforge C API
Implements the flat C interface declared in wf_api.h and connects external
host applications, such as Unity, to Wayforge's internal C++ systems.
This file translates C-style handles, pointers, primitive values, and caller
supplied buffers into operations on Wayforge documents, images, vectors,
floor plan elements, properties, and navigation data. It also handles
conversion from SVG and floor plan images into Wayforge building documents.

Errors are stored in a thread-local string and exposed through
wf_last_error(). API functions use try/catch wrappers so C++ exceptions do
not escape across the C boundary. Helper functions are provided for safe
string copying, level and room lookup, property conversion, and route output.

Routing support can be enabled through WF_API_WITH_GRAPH. When graph support
is disabled, routing-related functions return an error explaining that the
graph module is unavailable.



Links: Implements the functions declared in wf_api.h and connects them to
wf_doc, wf_image, wf_vector, wf_read, and wf_graph. This is the main bridge
between the Wayforge C++ core and Unity's P/Invoke layer.


\author Kervin Ong Guan Cheng (Kervinguancheng.ong@digipen.edu)


Contribution: Kervin Ong Guan Cheng 100%
C API implementation and shared-library boundary handling
Document loading, saving, creation, and floor plan conversion
Level, wall, opening, room, and property access
Error handling and thread-local error reporting
Undo and redo integration
Navigation graph, routing, and route helper functions
Room search, POI, level, and building metadata helpers



AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.



\date 2026-10-02

\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
*/

#define WF_API_BUILDING 1
#include "wf_api/wf_api.h"
#include "wf_doc/wf_doc.hpp"
#include "wf_image/wf_image.hpp"
#include "wf_vector/wf_vector.hpp"
#include "wf_read/wf_read.hpp"
#include "wf_graph/wf_graph.hpp"
#include <cstring>
#include <string>
#include <algorithm>
#include <filesystem>

// Keep this at 0 until the graph/routing part is ready.
#define WF_API_WITH_GRAPH 0

struct wf_doc_t {
    wf::Document doc;
#if WF_API_WITH_GRAPH
    wf::graph::Route lastRoute;                // kept so wf_instructions can describe it
#else
    int lastRoute = 0;
#endif
};

// helpers 
namespace {

    thread_local std::string g_lastError;

    // Saves the latest error message.
    void setError(std::string msg) { g_lastError = std::move(msg); }

    // Copies a C++ string into the output buffer.
    int copyOut(const std::string& s, char* out, int cap) {
        if (!out || cap <= 0) return -1;
        const int n = static_cast<int>(std::min<size_t>(s.size(), static_cast<size_t>(cap - 1)));
        std::memcpy(out, s.data(), static_cast<size_t>(n));
        out[n] = '\0';
        return n;
    }

    // Gets a level safely and reports an error if it is invalid.
    const wf::Level* levelOf(wf_doc d, int level) {
        if (!d) { setError("null document"); return nullptr; }
        const wf::Level* l = d->doc.level(level);
        if (!l) setError("level index " + std::to_string(level) + " out of range (document has " + std::to_string(d->doc.levelCount()) + ")");
        return l;
    }

    // Converts the API element number into an ElementKind.
    wf::ElementKind toKind(int k, bool& ok) {
        ok = k >= 0 && k <= 6;
        return static_cast<wf::ElementKind>(k);
    }

    // Gets the properties for the selected element type.
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

    // Convert text into the property type expected by Wayforge.
    // Converts a text value into the correct property type.
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

#if WF_API_WITH_GRAPH
    // Copies a calculated route into the output buffer.
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

#else
    // Returns an error while routing support is disabled.
    int graphMissing() { setError("routing needs wf_graph, which is not written yet"); return -1; }
#endif
} // namespace

#define WF_TRY try {
#define WF_CATCH(ret) } catch (const std::exception& e) { setError(e.what()); return ret; } catch (...) { setError("unknown exception"); return ret; }

// lifecycle 
// Simple check to confirm that the plugin loaded correctly.
WF_API int         wf_ping(void) { return 42; }
// Returns the current Wayforge version.
WF_API const char* wf_version(void) { return wf::kVersionString; }
// Returns the current platform name.
WF_API const char* wf_platform(void) { return wf::platformName(); }
// Returns the last error message from this thread.
WF_API const char* wf_last_error(void) { return g_lastError.c_str(); }

// Converts an SVG floor plan into a Wayforge document.
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

// Floor plan picture -> walls, openings and rooms.
// Clean the image, trace its lines and turn them into floor plan data.
// widthMetres is the real width. 0 uses the default 2 cm per pixel.
// Converts a floor plan image into a Wayforge document.
WF_API wf_doc wf_convert_image(const char* path, float widthMetres) {
    WF_TRY
        if (!path) { setError("null path"); return nullptr; }
    auto image = wf::img::load(path);
    if (!image) { setError(image.error()); return nullptr; }

    // Clean the dark lines and turn them into straight segments.
    auto ink = wf::img::adaptiveThreshold(*image);
    auto segs = wf::vec::fitPolylines(wf::vec::traceSkeleton(wf::vec::thin(ink)), 1.5f, 3.f);
    if (segs.empty()) { setError("no lines found in the image"); return nullptr; }

    // Convert pixels into metres and flip the image Y direction.
    float width = wf::vec::bounds(segs).size().x;
    float metresPerPixel = (widthMetres > 0.f && width > 0.f) ? widthMetres / width : 0.02f;
    segs = wf::vec::clean(wf::vec::scale(segs, metresPerPixel, {}, true, static_cast<float>(image->height)));

    // Turn the line segments into walls, openings and rooms.
    wf::Building b;
    b.building.name = std::filesystem::path(path).stem().string();
    wf::Level level; level.id = "L1"; level.name = "Level 1";
    wf::IdGenerator ids;
    auto result = wf::read::interpret(segs, level, ids);
    if (!result) { setError(result.error()); return nullptr; }
    b.levels.push_back(std::move(level));
    return new wf_doc_t{ wf::Document(std::move(b)), {} };
    WF_CATCH(nullptr)
}

// Opens a saved plan or converts an SVG file.
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

// Creates a new empty Wayforge document.
WF_API wf_doc wf_new_doc(const char* name) {
    WF_TRY
        wf::Building b; b.building.name = name ? name : "Untitled";
    return new wf_doc_t{ wf::Document(std::move(b)), {} };
    WF_CATCH(nullptr)
}

// Closes a document and frees its memory.
WF_API void wf_close(wf_doc d) { delete d; }

// Saves the document to a file.
WF_API int wf_save(wf_doc d, const char* path) {
    WF_TRY
        if (!d || !path) { setError("null argument"); return -1; }
    auto s = d->doc.save(path);
    if (!s) { setError(s.message); return -1; }
    return 0;
    WF_CATCH(-1)
}
// Checks if the document has unsaved changes.
WF_API int wf_is_dirty(wf_doc d) { return d ? (d->doc.dirty() ? 1 : 0) : -1; }

// levels 
// Returns the number of levels in the document.
WF_API int wf_level_count(wf_doc d) { return d ? d->doc.levelCount() : -1; }
// Copies the selected level ID into the output buffer.
WF_API int wf_get_level_id(wf_doc d, int level, char* out, int cap) {
    WF_TRY const wf::Level* l = levelOf(d, level); if (!l) return -1; return copyOut(l->id, out, cap); WF_CATCH(-1)
}
// Adds a new level to the building.
WF_API int wf_add_level(wf_doc d, const char* id, const char* name, float elevation) {
    WF_TRY
        if (!d || !id) { setError("null argument"); return -1; }
    wf::Level l; l.id = id; l.name = name ? name : id; l.elevation = elevation;
    return d->doc.addLevel(std::move(l));
    WF_CATCH(-1)
}

// walls 
// Returns the number of walls on a level.
WF_API int wf_wall_count(wf_doc d, int level) { WF_TRY const wf::Level* l = levelOf(d, level); return l ? static_cast<int>(l->walls.size()) : -1; WF_CATCH(-1) }
// Copies wall positions and thickness values into the output buffer.
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
// Copies the confidence value for each wall.
WF_API int wf_get_wall_confidence(wf_doc d, int level, float* out, int maxFloats) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !out) return -1;
    int n = 0; for (const auto& w : l->walls) { if (n >= maxFloats) break; out[n++] = w.confidence; }
    return n;
    WF_CATCH(-1)
}
// Copies the ID of one wall.
WF_API int wf_get_wall_id(wf_doc d, int level, int i, char* out, int cap) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l) return -1;
    if (i < 0 || i >= static_cast<int>(l->walls.size())) { setError("wall index out of range"); return -1; }
    return copyOut(l->walls[static_cast<size_t>(i)].id, out, cap);
    WF_CATCH(-1)
}
// Adds a wall to the selected level.
WF_API int wf_add_wall(wf_doc d, int level, float ax, float ay, float bx, float by, float t, char* idOut, int idCap) {
    WF_TRY
        if (!levelOf(d, level)) return -1;
    std::string id = d->doc.addWall(level, { ax, ay }, { bx, by }, t);
    if (idOut) copyOut(id, idOut, idCap);
    return 0;
    WF_CATCH(-1)
}
// Moves an existing wall to new endpoints.
WF_API int wf_move_wall(wf_doc d, int level, const char* wallId, float ax, float ay, float bx, float by) {
    WF_TRY
        if (!levelOf(d, level) || !wallId) return -1;
    if (!d->doc.moveWall(level, wallId, { ax, ay }, { bx, by })) { setError(std::string("no wall '") + wallId + "'"); return -1; }
    return 0;
    WF_CATCH(-1)
}
// Deletes a wall using its ID.
WF_API int wf_delete_wall(wf_doc d, int level, const char* wallId) {
    WF_TRY
        if (!levelOf(d, level) || !wallId) return -1;
    if (!d->doc.deleteWall(level, wallId)) { setError(std::string("no wall '") + wallId + "'"); return -1; }
    return 0;
    WF_CATCH(-1)
}

// openings 
// Returns the number of openings on a level.
WF_API int wf_opening_count(wf_doc d, int level) { WF_TRY const wf::Level* l = levelOf(d, level); return l ? static_cast<int>(l->openings.size()) : -1; WF_CATCH(-1) }
// Copies opening position, width and type into the output buffer.
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

// Room functions.
namespace {
    // Gets a room safely using its index.
    const wf::Room* roomAt(wf_doc d, int level, int i) {
        const wf::Level* l = levelOf(d, level); if (!l) return nullptr;
        if (i < 0 || i >= static_cast<int>(l->rooms.size())) { setError("room index out of range"); return nullptr; }
        return &l->rooms[static_cast<size_t>(i)];
    }
}
// Returns the number of rooms on a level.
WF_API int wf_room_count(wf_doc d, int level) { WF_TRY const wf::Level* l = levelOf(d, level); return l ? static_cast<int>(l->rooms.size()) : -1; WF_CATCH(-1) }
// Gets the main information for one room.
WF_API int wf_get_room(wf_doc d, int level, int i, char* codeOut, int codeCap, float* centroidOut, float* confOut) {
    WF_TRY
        const wf::Room* r = roomAt(d, level, i); if (!r) return -1;
    if (codeOut) copyOut(r->code, codeOut, codeCap);
    if (centroidOut) { centroidOut[0] = r->centroid.x; centroidOut[1] = r->centroid.y; }
    if (confOut) *confOut = r->confidence;
    return 0;
    WF_CATCH(-1)
}
// Copies the ID of one room.
WF_API int wf_get_room_id(wf_doc d, int level, int i, char* out, int cap) { WF_TRY const wf::Room* r = roomAt(d, level, i); return r ? copyOut(r->id, out, cap) : -1; WF_CATCH(-1) }
// Returns the type of the selected room.
WF_API int wf_get_room_kind(wf_doc d, int level, int i) { WF_TRY const wf::Room* r = roomAt(d, level, i); return r ? static_cast<int>(r->kind) : -1; WF_CATCH(-1) }
// Copies the room polygon as x and y pairs.
WF_API int wf_get_room_polygon(wf_doc d, int level, int i, float* out, int maxFloats) {
    WF_TRY
        const wf::Room* r = roomAt(d, level, i); if (!r || !out) return -1;
    int n = 0; for (const auto& p : r->polygon) { if (n + 2 > maxFloats) break; out[n++] = p.x; out[n++] = p.y; }
    return n;
    WF_CATCH(-1)
}
// Changes the room code and name.
WF_API int wf_set_room_code(wf_doc d, int level, int i, const char* code, const char* name) {
    WF_TRY
        const wf::Room* r = roomAt(d, level, i); if (!r) return -1;
    d->doc.setRoomCode(level, r->id, code ? code : "", name ? name : "");
    return 0;
    WF_CATCH(-1)
}
// Changes the room type.
WF_API int wf_set_room_kind(wf_doc d, int level, int i, const char* kindName) {
    WF_TRY
        const wf::Room* r = roomAt(d, level, i); if (!r || !kindName) return -1;
    if (!d->doc.setProperty(level, wf::ElementKind::Room, r->id, "kind", std::string(kindName))) { setError(std::string("unknown room kind '") + kindName + "'"); return -1; }
    return 0;
    WF_CATCH(-1)
}

// properties 
// Returns the number of properties for an element type.
WF_API int wf_property_count(int kind) { return static_cast<int>(propsFor(kind).size()); }
// Gets the name and type of a property.
WF_API int wf_property_name(int kind, int i, char* nameOut, int cap, char* typeOut, int typeCap) {
    WF_TRY
        auto props = propsFor(kind);
    if (i < 0 || i >= static_cast<int>(props.size())) { setError("property index out of range"); return -1; }
    copyOut(std::string(props[static_cast<size_t>(i)].name), nameOut, cap);
    if (typeOut) copyOut(wf::propertyTypeName(props[static_cast<size_t>(i)].type), typeOut, typeCap);
    return 0;
    WF_CATCH(-1)
}
// Reads a property and returns it as text.
WF_API int wf_get_property(wf_doc d, int level, int kind, const char* id, const char* prop, char* out, int cap) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !prop) return -1;
    auto props = propsFor(kind);
    const wf::PropertyInfo* p = wf::findProperty(props, prop);
    if (!p) { setError(std::string("no property '") + prop + "'"); return -1; }
    const void* obj = nullptr;
    switch (kind) {
    case 0: obj = l->findWall(id ? id : ""); break;
    case 1: for (auto& o : l->openings) if (id && o.id == id) obj = &o; break;
    case 2: obj = l->findRoom(id ? id : ""); break;
    case 3: obj = l->findNode(id ? id : ""); break;
    case 4: for (auto& o : l->pois) if (id && o.id == id) obj = &o; break;
    case 5: for (auto& o : l->anchors) if (id && o.id == id) obj = &o; break;
    case 6: obj = l; break;
    }
    if (!obj) { setError(std::string("no element '") + (id ? id : "") + "'"); return -1; }
    return copyOut(wf::propertyValueToString(wf::getPropertyRaw(obj, *p), p), out, cap);
    WF_CATCH(-1)
}
// Sets a property using a text value.
WF_API int wf_set_property(wf_doc d, int level, int kind, const char* id, const char* prop, const char* value) {
    WF_TRY
        if (!levelOf(d, level) || !prop) return -1;
    bool ok; wf::ElementKind ek = toKind(kind, ok);
    if (!ok) { setError("bad element kind"); return -1; }
    const wf::PropertyInfo* p = wf::findProperty(propsFor(kind), prop);
    if (!p) { setError(std::string("no property '") + prop + "'"); return -1; }
    wf::PropertyValue v;
    if (!parseValue(*p, value, v)) { setError(std::string("cannot parse '") + (value ? value : "") + "' as " + wf::propertyTypeName(p->type)); return -1; }
    if (!d->doc.setProperty(level, ek, id ? id : "", prop, v)) { setError(std::string("set failed for '") + (id ? id : "") + "." + prop + "'"); return -1; }
    return 0;
    WF_CATCH(-1)
}

// undo 
// Undoes the last document change.
WF_API int wf_undo(wf_doc d) { WF_TRY if (!d) return -1; return d->doc.undo() ? 0 : 1; WF_CATCH(-1) }
// Redoes the last undone change.
WF_API int wf_redo(wf_doc d) { WF_TRY if (!d) return -1; return d->doc.redo() ? 0 : 1; WF_CATCH(-1) }
// Checks if there is anything available to undo.
WF_API int wf_can_undo(wf_doc d) { return d ? (d->doc.commands().canUndo() ? 1 : 0) : -1; }
// Checks if there is anything available to redo.
WF_API int wf_can_redo(wf_doc d) { return d ? (d->doc.commands().canRedo() ? 1 : 0) : -1; }

// graph / routing 
#if WF_API_WITH_GRAPH
// Builds the navigation graph for the document.
WF_API int wf_build_graph(wf_doc d) {
    WF_TRY
        if (!d) { setError("null document"); return -1; }
    // Start node IDs higher so they do not clash with wall or room IDs.
    wf::IdGenerator ids; ids.bump(100000);          // node ids must not collide with existing wall/room ids
    wf::graph::buildGraph(d->doc.mutableBuilding(), ids, {});
    return 0;
    WF_CATCH(-1)
}
#else
// Returns the graph-disabled error when routing is not available.
WF_API int wf_build_graph(wf_doc) { return graphMissing(); }
#endif
// Returns the number of navigation nodes on a level.
WF_API int wf_node_count(wf_doc d, int level) { WF_TRY const wf::Level* l = levelOf(d, level); return l ? static_cast<int>(l->nodes.size()) : -1; WF_CATCH(-1) }
// Copies node position and type into the output buffer.
WF_API int wf_get_nodes(wf_doc d, int level, float* out, int maxFloats) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !out) return -1;
    int n = 0; for (const auto& nd : l->nodes) { if (n + 3 > maxFloats) break; out[n++] = nd.pos.x; out[n++] = nd.pos.y; out[n++] = static_cast<float>(nd.kind); }
    return n;
    WF_CATCH(-1)
}
// Returns the number of navigation edges on a level.
WF_API int wf_edge_count(wf_doc d, int level) { WF_TRY const wf::Level* l = levelOf(d, level); return l ? static_cast<int>(l->edges.size()) : -1; WF_CATCH(-1) }
// Copies graph edge information into the output buffer.
WF_API int wf_get_edges(wf_doc d, int level, int* out, int maxInts) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !out) return -1;
    // Convert each node ID into its position in the node list.
    auto index = [&](const std::string& id) { for (size_t i = 0; i < l->nodes.size(); ++i) if (l->nodes[i].id == id) return static_cast<int>(i); return -1; };
    int n = 0; for (const auto& e : l->edges) { if (n + 3 > maxInts) break; out[n++] = index(e.a); out[n++] = index(e.b); out[n++] = e.stepFree ? 1 : 0; }
    return n;
    WF_CATCH(-1)
}
// Adds a link between two navigation references.
WF_API int wf_add_link(wf_doc d, const char* a, const char* b, const char* kind, int stepFree, float cost) {
    WF_TRY
        if (!d || !a || !b) { setError("null argument"); return -1; }
    wf::Link l; l.a = a; l.b = b; l.stepFree = stepFree != 0; l.cost = cost;
    if (kind && !wf::setProperty(l, "kind", std::string(kind))) { setError(std::string("unknown link kind '") + kind + "'"); return -1; }
    d->doc.mutableBuilding().links.push_back(l);
    return 0;
    WF_CATCH(-1)
}
#if WF_API_WITH_GRAPH
// Finds a route between two nodes.
WF_API int wf_route(wf_doc d, const char* from, const char* to, int stepFreeOnly, float* out, int maxFloats, float* costOut) {
    WF_TRY
        if (!d || !from || !to || !out) { setError("null argument"); return -1; }
    return writeRoute(d, wf::graph::findRoute(d->doc.building(), from, to, { stepFreeOnly != 0 }), d->doc.building(), out, maxFloats, costOut);
    WF_CATCH(-1)
}
// Finds a route from a node to a room.
WF_API int wf_route_to_room(wf_doc d, const char* from, const char* roomCode, int stepFreeOnly, float* out, int maxFloats, float* costOut) {
    WF_TRY
        if (!d || !from || !roomCode || !out) { setError("null argument"); return -1; }
    auto ref = wf::graph::nodeForRoom(d->doc.building(), roomCode);
    if (!ref) { setError(std::string("no room '") + roomCode + "' (or it has no node: run wf_build_graph)"); return -1; }
    return writeRoute(d, wf::graph::findRoute(d->doc.building(), from, *ref, { stepFreeOnly != 0 }), d->doc.building(), out, maxFloats, costOut);
    WF_CATCH(-1)
}
// Finds a route from a node to an exit.
WF_API int wf_egress(wf_doc d, const char* from, int stepFreeOnly, float* out, int maxFloats, float* costOut) {
    WF_TRY
        if (!d || !from || !out) { setError("null argument"); return -1; }
    return writeRoute(d, wf::graph::findEgress(d->doc.building(), from, { stepFreeOnly != 0 }), d->doc.building(), out, maxFloats, costOut);
    WF_CATCH(-1)
}
// Finds the navigation node linked to a room.
WF_API int wf_node_for_room(wf_doc d, const char* room, char* out, int cap) {
    WF_TRY
        if (!d || !room) { setError("null argument"); return -1; }
    auto ref = wf::graph::nodeForRoom(d->doc.building(), room);
    if (!ref) { setError(std::string("no node for room '") + room + "'"); return -1; }
    return copyOut(*ref, out, cap);
    WF_CATCH(-1)
}
// Finds the nearest navigation node to a position.
WF_API int wf_nearest_node(wf_doc d, const char* levelId, float x, float y, char* out, int cap) {
    WF_TRY
        if (!d || !levelId) { setError("null argument"); return -1; }
    auto ref = wf::graph::nearestNode(d->doc.building(), levelId, { x, y });
    if (!ref) { setError(std::string("no nodes on level '") + levelId + "'"); return -1; }
    return copyOut(*ref, out, cap);
    WF_CATCH(-1)
}
#else
// Returns the graph-disabled error when routing is not available.
WF_API int wf_route(wf_doc, const char*, const char*, int, float*, int, float*) { return graphMissing(); }
// Returns the graph-disabled error when routing is not available.
WF_API int wf_route_to_room(wf_doc, const char*, const char*, int, float*, int, float*) { return graphMissing(); }
// Returns the graph-disabled error when routing is not available.
WF_API int wf_egress(wf_doc, const char*, int, float*, int, float*) { return graphMissing(); }
// Returns the graph-disabled error when routing is not available.
WF_API int wf_node_for_room(wf_doc, const char*, char*, int) { return graphMissing(); }
// Returns the graph-disabled error when routing is not available.
WF_API int wf_nearest_node(wf_doc, const char*, float, float, char*, int) { return graphMissing(); }
#endif

// app helpers 
namespace {
    // Room references use the form "L1:r3".
    // Looks up a room from a reference such as L1:r3.
    std::pair<const wf::Level*, const wf::Room*> splitRoomRef(const wf::Building& b, const char* ref) {
        if (!ref) return { nullptr, nullptr };
        const std::string s(ref); const size_t c = s.find(':');
        const wf::Level* l = c == std::string::npos ? nullptr : b.findLevel(s.substr(0, c));
        // If there is no level prefix, also try it as a room code or ID.
        if (!l) { // maybe a bare room code
            for (const auto& lv : b.levels) for (const auto& r : lv.rooms) if (r.code == s || r.id == s) return { &lv, &r };
            return { nullptr, nullptr };
        }
        return { l, l->findRoom(s.substr(c + 1)) };
    }
}
#if WF_API_WITH_GRAPH
// Creates turn-by-turn instructions from the last route.
WF_API int wf_instructions(wf_doc d, char* out, int cap) {
    WF_TRY
        if (!d || !out) { setError("null argument"); return -1; }
    if (d->lastRoute.empty()) { setError("no route computed yet"); return -1; }
    auto list = wf::graph::instructions(d->doc.building(), d->lastRoute);
    std::string s; for (auto& i : list) { s += i.text; s += '\n'; }
    copyOut(s, out, cap);
    return static_cast<int>(list.size());
    WF_CATCH(-1)
}
// Searches rooms by code or name.
WF_API int wf_search_rooms(wf_doc d, const char* query, char* out, int cap) {
    WF_TRY
        if (!d || !out) { setError("null argument"); return -1; }
    auto refs = wf::graph::searchRooms(d->doc.building(), query ? query : "", 50);
    std::string s;
    for (auto& ref : refs) {
        auto [l, r] = splitRoomRef(d->doc.building(), ref.c_str()); if (!r) continue;
        s += ref + "|" + r->code + "|" + r->name + "|" + wf::EnumNames<wf::RoomKind>::names[static_cast<int>(r->kind)] + "\n";
    }
    copyOut(s, out, cap);
    return static_cast<int>(refs.size());
    WF_CATCH(-1)
}
#else
// Returns the graph-disabled error when instructions are not available.
WF_API int wf_instructions(wf_doc, char*, int) { return graphMissing(); }
// Returns the graph-disabled error when room search is not available.
WF_API int wf_search_rooms(wf_doc, const char*, char*, int) { return graphMissing(); }
#endif
// Gets room information from a room reference or code.
WF_API int wf_room_info(wf_doc d, const char* ref, char* codeOut, int codeCap, char* nameOut, int nameCap, int* kindOut, float* centroidOut) {
    WF_TRY
        if (!d) { setError("null document"); return -1; }
    auto [l, r] = splitRoomRef(d->doc.building(), ref);
    if (!r) { setError(std::string("no room '") + (ref ? ref : "") + "'"); return -1; }
    if (codeOut) copyOut(r->code, codeOut, codeCap);
    if (nameOut) copyOut(r->name, nameOut, nameCap);
    if (kindOut) *kindOut = static_cast<int>(r->kind);
    if (centroidOut) { centroidOut[0] = r->centroid.x; centroidOut[1] = r->centroid.y; }
    return 0;
    WF_CATCH(-1)
}
// Writes all points of interest on a level into the output buffer.
WF_API int wf_pois(wf_doc d, int level, char* out, int cap) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l || !out) return -1;
    std::string s;
    for (auto& p : l->pois) s += p.id + "|" + p.kind + "|" + p.label + "|" + std::to_string(p.pos.x) + "|" + std::to_string(p.pos.y) + "\n";
    copyOut(s, out, cap);
    return static_cast<int>(l->pois.size());
    WF_CATCH(-1)
}
// Adds a point of interest to a level.
WF_API int wf_add_poi(wf_doc d, int level, const char* kind, const char* label, float x, float y) {
    WF_TRY
        if (!levelOf(d, level)) return -1;
    wf::Poi p; p.id = d->doc.nextId("p"); p.kind = kind ? kind : ""; p.label = label ? label : ""; p.pos = { x, y };
    d->doc.mutableLevel(level)->pois.push_back(p);
    return 0;
    WF_CATCH(-1)
}
// Gets the name, elevation and height of a level.
WF_API int wf_level_info(wf_doc d, int level, char* nameOut, int nameCap, float* elevationOut, float* heightOut) {
    WF_TRY
        const wf::Level* l = levelOf(d, level); if (!l) return -1;
    if (nameOut) copyOut(l->name, nameOut, nameCap);
    if (elevationOut) *elevationOut = l->elevation;
    if (heightOut) *heightOut = l->ceilingHeight;
    return 0;
    WF_CATCH(-1)
}
// Copies the building name into the output buffer.
WF_API int wf_building_name(wf_doc d, char* out, int cap) {
    WF_TRY if (!d) { setError("null document"); return -1; } return copyOut(d->doc.building().building.name, out, cap); WF_CATCH(-1)
}
