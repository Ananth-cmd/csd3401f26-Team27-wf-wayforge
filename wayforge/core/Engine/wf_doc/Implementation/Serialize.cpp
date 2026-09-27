#include "wf_doc/Serialize.hpp"
#include <nlohmann/json.hpp>
#include <cmath>

using json = nlohmann::json;

namespace wf {
namespace {

// ---- generic: reflected fields <-> json -------------------------------------------
template <class T> void reflectToJson(json& j, const T& obj) {
    for (const auto& p : propertiesOf<T>()) {
        PropertyValue v = getPropertyRaw(&obj, p);
        std::string key(p.name);
        switch (p.type) {
            case PropertyType::Bool:   j[key] = std::get<bool>(v); break;
            case PropertyType::Int:    j[key] = std::get<int>(v); break;
            case PropertyType::Float:  j[key] = std::get<float>(v); break;
            case PropertyType::String: j[key] = std::get<std::string>(v); break;
            case PropertyType::Vec2:   { auto& x = std::get<Vec2>(v); j[key] = json::array({x.x, x.y}); break; }
            case PropertyType::Enum:   { int i = std::get<int>(v); j[key] = (i >= 0 && i < p.enumCount) ? p.enumNames[i] : "?"; break; }
        }
    }
}

template <class T> void reflectFromJson(const json& j, T& obj, const std::string& where) {
    for (const auto& p : propertiesOf<T>()) {
        auto it = j.find(std::string(p.name));
        if (it == j.end()) continue;                      // missing fields keep their defaults
        const json& v = *it;
        bool ok = true;
        switch (p.type) {
            case PropertyType::Bool:   ok = v.is_boolean() && setPropertyRaw(&obj, p, v.get<bool>()); break;
            case PropertyType::Int:    ok = v.is_number()  && setPropertyRaw(&obj, p, v.get<int>()); break;
            case PropertyType::Float:  ok = v.is_number()  && setPropertyRaw(&obj, p, v.get<float>()); break;
            case PropertyType::String: ok = v.is_string()  && setPropertyRaw(&obj, p, v.get<std::string>()); break;
            case PropertyType::Vec2:   ok = v.is_array() && v.size() == 2 && setPropertyRaw(&obj, p, Vec2{v[0].get<float>(), v[1].get<float>()}); break;
            case PropertyType::Enum:   ok = v.is_string()  && setPropertyRaw(&obj, p, v.get<std::string>()); break;
        }
        if (!ok) throw std::runtime_error(where + ": field '" + std::string(p.name) + "' has the wrong type, expected " + propertyTypeName(p.type));
    }
}

json vecArray(std::span<const Vec2> pts) {
    json a = json::array();
    for (auto& p : pts) a.push_back(json::array({p.x, p.y}));
    return a;
}
std::vector<Vec2> vecArrayFrom(const json& j, const std::string& where) {
    std::vector<Vec2> out;
    if (!j.is_array()) throw std::runtime_error(where + ": expected an array of [x,y]");
    for (auto& e : j) {
        if (!e.is_array() || e.size() != 2) throw std::runtime_error(where + ": expected [x,y] pairs");
        out.push_back({e[0].get<float>(), e[1].get<float>()});
    }
    return out;
}

template <class T> json listToJson(const std::vector<T>& v) {
    json a = json::array();
    for (auto& e : v) { json o; reflectToJson(o, e); a.push_back(std::move(o)); }
    return a;
}
template <class T> std::vector<T> listFromJson(const json& j, const std::string& where) {
    std::vector<T> out;
    if (j.is_null()) return out;
    if (!j.is_array()) throw std::runtime_error(where + ": expected an array");
    size_t i = 0;
    for (auto& e : j) { T t; reflectFromJson(e, t, where + "[" + std::to_string(i++) + "]"); out.push_back(std::move(t)); }
    return out;
}

} // namespace

std::string buildingToJson(const Building& b, int indent) {
    json root;
    root["version"] = b.version;
    reflectToJson(root["building"], b.building);
    json levels = json::array();
    for (const auto& l : b.levels) {
        json lj; reflectToJson(lj, l);
        lj["walls"]    = listToJson(l.walls);
        lj["openings"] = listToJson(l.openings);
        json rooms = json::array();
        for (const auto& r : l.rooms) {
            json rj; reflectToJson(rj, r);
            rj["boundary"] = r.boundary;
            rj["polygon"]  = vecArray(r.polygon);
            rooms.push_back(std::move(rj));
        }
        lj["rooms"]   = std::move(rooms);
        lj["nodes"]   = listToJson(l.nodes);
        lj["edges"]   = listToJson(l.edges);
        lj["pois"]    = listToJson(l.pois);
        lj["anchors"] = listToJson(l.anchors);
        levels.push_back(std::move(lj));
    }
    root["levels"] = std::move(levels);
    root["links"]  = listToJson(b.links);
    reflectToJson(root["source"], b.source);
    return root.dump(indent);
}

Result<Building> buildingFromJson(std::string_view text) {
    try {
        json root = json::parse(text);
        if (!root.is_object()) return Result<Building>::fail("root is not a JSON object");
        Building b;
        b.version = root.value("version", 1);
        if (b.version != 1) return Result<Building>::fail("unsupported .wfb version " + std::to_string(b.version) + ", this build reads version 1");
        if (root.contains("building")) reflectFromJson(root["building"], b.building, "building");
        if (root.contains("source"))   reflectFromJson(root["source"],   b.source,   "source");
        size_t li = 0;
        for (auto& lj : root.value("levels", json::array())) {
            const std::string where = "levels[" + std::to_string(li++) + "]";
            Level l; reflectFromJson(lj, l, where);
            l.walls    = listFromJson<Wall>   (lj.value("walls",    json::array()), where + ".walls");
            l.openings = listFromJson<Opening>(lj.value("openings", json::array()), where + ".openings");
            size_t ri = 0;
            for (auto& rj : lj.value("rooms", json::array())) {
                const std::string rw = where + ".rooms[" + std::to_string(ri++) + "]";
                Room r; reflectFromJson(rj, r, rw);
                if (rj.contains("boundary")) r.boundary = rj["boundary"].get<std::vector<std::string>>();
                if (rj.contains("polygon"))  r.polygon  = vecArrayFrom(rj["polygon"], rw + ".polygon");
                l.rooms.push_back(std::move(r));
            }
            l.nodes   = listFromJson<Node>  (lj.value("nodes",   json::array()), where + ".nodes");
            l.edges   = listFromJson<Edge>  (lj.value("edges",   json::array()), where + ".edges");
            l.pois    = listFromJson<Poi>   (lj.value("pois",    json::array()), where + ".pois");
            l.anchors = listFromJson<Anchor>(lj.value("anchors", json::array()), where + ".anchors");
            // referential integrity - say which element is wrong, not just "parse error"
            for (auto& o : l.openings)
                if (!l.findWall(o.wall)) return Result<Building>::fail(where + ": opening '" + o.id + "' references missing wall '" + o.wall + "'");
            for (auto& e : l.edges) {
                if (!l.findNode(e.a)) return Result<Building>::fail(where + ": edge references missing node '" + e.a + "'");
                if (!l.findNode(e.b)) return Result<Building>::fail(where + ": edge references missing node '" + e.b + "'");
            }
            b.levels.push_back(std::move(l));
        }
        b.links = listFromJson<Link>(root.value("links", json::array()), "links");
        return b;
    } catch (const json::exception& e) {
        return Result<Building>::fail(std::string("invalid JSON: ") + e.what());
    } catch (const std::exception& e) {
        return Result<Building>::fail(e.what());
    }
}

// ---- golden comparison -------------------------------------------------------------
namespace {
    bool near(float a, float b, float tol) { return std::abs(a - b) <= tol; }
    bool near(const Vec2& a, const Vec2& b, float tol) { return near(a.x, b.x, tol) && near(a.y, b.y, tol); }

    template <class T> std::string cmpReflected(const T& a, const T& b, float tol, const std::string& where) {
        for (const auto& p : propertiesOf<T>()) {
            PropertyValue va = getPropertyRaw(&a, p), vb = getPropertyRaw(&b, p);
            bool eq = true;
            if (p.type == PropertyType::Float)     eq = near(std::get<float>(va), std::get<float>(vb), tol);
            else if (p.type == PropertyType::Vec2) eq = near(std::get<Vec2>(va), std::get<Vec2>(vb), tol);
            else                                   eq = va == vb;
            if (!eq) return where + "." + std::string(p.name) + ": " + propertyValueToString(va, &p) + " vs " + propertyValueToString(vb, &p);
        }
        return {};
    }
    template <class T> std::string cmpList(const std::vector<T>& a, const std::vector<T>& b, float tol, const std::string& where) {
        if (a.size() != b.size()) return where + ": count " + std::to_string(a.size()) + " vs " + std::to_string(b.size());
        for (size_t i = 0; i < a.size(); ++i)
            if (auto d = cmpReflected(a[i], b[i], tol, where + "[" + std::to_string(i) + "]"); !d.empty()) return d;
        return {};
    }
}

std::string compareBuildings(const Building& a, const Building& b, float tol) {
    if (auto d = cmpReflected(a.building, b.building, tol, "building"); !d.empty()) return d;
    if (a.levels.size() != b.levels.size()) return "levels: count " + std::to_string(a.levels.size()) + " vs " + std::to_string(b.levels.size());
    for (size_t i = 0; i < a.levels.size(); ++i) {
        const std::string w = "levels[" + std::to_string(i) + "]";
        const Level& la = a.levels[i]; const Level& lb = b.levels[i];
        if (auto d = cmpReflected(la, lb, tol, w); !d.empty()) return d;
        if (auto d = cmpList(la.walls, lb.walls, tol, w + ".walls"); !d.empty()) return d;
        if (auto d = cmpList(la.openings, lb.openings, tol, w + ".openings"); !d.empty()) return d;
        if (auto d = cmpList(la.rooms, lb.rooms, tol, w + ".rooms"); !d.empty()) return d;
        for (size_t r = 0; r < la.rooms.size(); ++r) {
            if (la.rooms[r].polygon.size() != lb.rooms[r].polygon.size())
                return w + ".rooms[" + std::to_string(r) + "].polygon: vertex count differs";
            for (size_t k = 0; k < la.rooms[r].polygon.size(); ++k)
                if (!near(la.rooms[r].polygon[k], lb.rooms[r].polygon[k], tol))
                    return w + ".rooms[" + std::to_string(r) + "].polygon[" + std::to_string(k) + "] differs";
        }
        if (auto d = cmpList(la.nodes, lb.nodes, tol, w + ".nodes"); !d.empty()) return d;
        if (auto d = cmpList(la.edges, lb.edges, tol, w + ".edges"); !d.empty()) return d;
    }
    if (auto d = cmpList(a.links, b.links, tol, "links"); !d.empty()) return d;
    return {};
}

} // namespace wf
