#include "wf_doc/Serialize.hpp"
#include "wf_doc/Property.hpp"
#include <algorithm>
#include <cstdio>
#include <cstdlib>

namespace wf {
    namespace {

        std::string fieldError(const std::string& file, const std::string& path,
            const std::string& field, const std::string& what) {
            return file + ": " + path + ": \"" + field + "\" must be " + what + ".";
        }

        json floatToJson(float f) {
            char buf[32];
            for (int prec = 1; prec <= 9; ++prec) {
                std::snprintf(buf, sizeof buf, "%.*g", prec, static_cast<double>(f));
                if (std::strtof(buf, nullptr) == f) break;
            }
            return std::strtod(buf, nullptr);
        }

        json vec2ToJson(Vec2 p) { return json::array({ floatToJson(p.x), floatToJson(p.y) }); }

        bool readVec2(const json& j, Vec2& out) {
            if (!j.is_array() || j.size() != 2 || !j[0].is_number() || !j[1].is_number()) return false;
            out.x = static_cast<float>(j[0].get<double>());
            out.y = static_cast<float>(j[1].get<double>());
            return true;
        }

        json valueToJson(const PropertyValue& v) {
            if (const bool* b = std::get_if<bool>(&v))               return *b;
            if (const int* i = std::get_if<int>(&v))                 return *i;
            if (const float* f = std::get_if<float>(&v))             return floatToJson(*f);
            if (const std::string* s = std::get_if<std::string>(&v)) return *s;
            return vec2ToJson(std::get<Vec2>(v));
        }

        template <class T> json objectToJson(const T& o) {
            json j = json::object();
            for (const PropertyInfo& p : propertiesOf<T>())
                j[std::string(p.name)] = valueToJson(getPropertyRaw(&o, p));
            return j;
        }

        template <class T> json listToJson(const std::vector<T>& v) {
            json a = json::array();
            for (const T& e : v) a.push_back(objectToJson(e));
            return a;
        }

        json roomToJson(const Room& r) {
            json j = objectToJson(r);
            json boundary = json::array();
            for (const std::string& id : r.boundary) boundary.push_back(id);
            j["boundary"] = boundary;
            json poly = json::array();
            for (Vec2 p : r.polygon) poly.push_back(vec2ToJson(p));
            j["polygon"] = poly;
            return j;
        }

        json levelToJson(const Level& lv) {
            json j = objectToJson(lv);
            j["walls"] = listToJson(lv.walls);
            j["openings"] = listToJson(lv.openings);
            json rooms = json::array();
            for (const Room& r : lv.rooms) rooms.push_back(roomToJson(r));
            j["rooms"] = rooms;
            j["nodes"] = listToJson(lv.nodes);
            j["edges"] = listToJson(lv.edges);
            j["pois"] = listToJson(lv.pois);
            j["anchors"] = listToJson(lv.anchors);
            return j;
        }

        std::string expectedText(const PropertyInfo& p) {
            switch (p.type) {
            case PropertyType::Bool:   return "true or false";
            case PropertyType::Int:    return "an integer";
            case PropertyType::Float:  return "a number";
            case PropertyType::String: return "a string";
            case PropertyType::Vec2:   return "two numbers";
            case PropertyType::Enum: {
                std::string s = "one of:";
                for (int i = 0; i < p.enumCount; ++i) s += (i ? ", " : " ") + std::string(p.enumNames[i]);
                return s;
            }
            }
            return "valid";
        }

        bool jsonToValue(const json& j, const PropertyInfo& p, PropertyValue& out) {
            switch (p.type) {
            case PropertyType::Bool:
                if (!j.is_boolean()) return false;
                out = j.get<bool>();
                return true;
            case PropertyType::Int:
                if (!j.is_number_integer()) return false;
                out = j.get<int>();
                return true;
            case PropertyType::Float:
                if (!j.is_number()) return false;
                out = static_cast<float>(j.get<double>());
                return true;
            case PropertyType::String:
            case PropertyType::Enum:
                if (!j.is_string()) return false;
                out = j.get<std::string>();
                return true;
            case PropertyType::Vec2: {
                Vec2 v;
                if (!readVec2(j, v)) return false;
                out = v;
                return true;
            }
            }
            return false;
        }

        template <class T>
        Status readObject(const json& j, T& o, const std::string& file, const std::string& path) {
            if (!j.is_object()) return Status::fail(file + ": " + path + ": must be an object.");
            for (const PropertyInfo& p : propertiesOf<T>()) {
                auto it = j.find(std::string(p.name));
                if (it == j.end()) continue;
                PropertyValue v;
                if (!jsonToValue(*it, p, v) || !setPropertyRaw(&o, p, v))
                    return Status::fail(fieldError(file, path, std::string(p.name), expectedText(p)));
            }
            return Status::success();
        }

        struct NoExtra {
            template <class T> Status operator()(const json&, T&, const std::string&) const { return Status::success(); }
        };

        template <class T, class Extra>
        Status readList(const json& parent, const char* key, const std::string& parentPath, const std::string& file,
            std::vector<T>& out, Extra extra) {
            auto it = parent.find(key);
            if (it == parent.end()) return Status::success();
            if (!it->is_array())
                return Status::fail(fieldError(file, parentPath.empty() ? std::string("(root)") : parentPath, key, "an array"));
            const std::string listPath = parentPath.empty() ? std::string(key) : parentPath + "." + key;
            out.clear();
            out.reserve(it->size());
            for (size_t i = 0; i < it->size(); ++i) {
                const json& ji = (*it)[i];
                const std::string path = listPath + "[" + std::to_string(i) + "]";
                T item;
                Status s = readObject(ji, item, file, path);
                if (!s.ok) return s;
                s = extra(ji, item, path);
                if (!s.ok) return s;
                out.push_back(std::move(item));
            }
            return Status::success();
        }

        Status readRoomExtras(const json& j, Room& r, const std::string& file, const std::string& path) {
            auto b = j.find("boundary");
            if (b != j.end()) {
                if (!b->is_array()) return Status::fail(fieldError(file, path, "boundary", "an array of strings"));
                for (const json& e : *b) {
                    if (!e.is_string()) return Status::fail(fieldError(file, path, "boundary", "an array of strings"));
                    r.boundary.push_back(e.get<std::string>());
                }
            }
            auto p = j.find("polygon");
            if (p != j.end()) {
                if (!p->is_array()) return Status::fail(fieldError(file, path, "polygon", "an array of [x, y] pairs"));
                for (const json& e : *p) {
                    Vec2 v;
                    if (!readVec2(e, v)) return Status::fail(fieldError(file, path, "polygon", "an array of [x, y] pairs"));
                    r.polygon.push_back(v);
                }
            }
            return Status::success();
        }

        Status readLevelChildren(const json& j, Level& lv, const std::string& file, const std::string& path) {
            Status s = readList(j, "walls", path, file, lv.walls, NoExtra{});
            if (!s.ok) return s;
            s = readList(j, "openings", path, file, lv.openings, NoExtra{});
            if (!s.ok) return s;
            s = readList(j, "rooms", path, file, lv.rooms,
                [&](const json& jr, Room& r, const std::string& rp) { return readRoomExtras(jr, r, file, rp); });
            if (!s.ok) return s;
            s = readList(j, "nodes", path, file, lv.nodes, NoExtra{});
            if (!s.ok) return s;
            s = readList(j, "edges", path, file, lv.edges, NoExtra{});
            if (!s.ok) return s;
            s = readList(j, "pois", path, file, lv.pois, NoExtra{});
            if (!s.ok) return s;
            return readList(j, "anchors", path, file, lv.anchors, NoExtra{});
        }

        template <class T>
        void diffObject(const T& a, const T& b, const std::string& path, std::vector<std::string>& out) {
            for (const PropertyInfo& p : propertiesOf<T>()) {
                PropertyValue va = getPropertyRaw(&a, p);
                PropertyValue vb = getPropertyRaw(&b, p);
                if (va != vb)
                    out.push_back(path + "." + std::string(p.name) + ": " + propertyValueToString(va, &p) +
                        " vs " + propertyValueToString(vb, &p));
            }
        }

        struct NoDiffExtra {
            template <class T> void operator()(const T&, const T&, const std::string&, std::vector<std::string>&) const {}
        };

        template <class T, class Extra>
        void diffList(const std::vector<T>& a, const std::vector<T>& b, const std::string& path,
            std::vector<std::string>& out, Extra extra) {
            if (a.size() != b.size())
                out.push_back(path + ": " + std::to_string(a.size()) + " items vs " + std::to_string(b.size()));
            const size_t n = std::min(a.size(), b.size());
            for (size_t i = 0; i < n; ++i) {
                const std::string p = path + "[" + std::to_string(i) + "]";
                diffObject(a[i], b[i], p, out);
                extra(a[i], b[i], p, out);
            }
        }

        void diffRoomExtras(const Room& a, const Room& b, const std::string& path, std::vector<std::string>& out) {
            if (a.boundary != b.boundary) out.push_back(path + ".boundary differs");
            bool same = a.polygon.size() == b.polygon.size();
            for (size_t i = 0; same && i < a.polygon.size(); ++i) same = (a.polygon[i] == b.polygon[i]);
            if (!same) out.push_back(path + ".polygon differs");
        }

        void diffLevelChildren(const Level& a, const Level& b, const std::string& path, std::vector<std::string>& out) {
            diffList(a.walls, b.walls, path + ".walls", out, NoDiffExtra{});
            diffList(a.openings, b.openings, path + ".openings", out, NoDiffExtra{});
            diffList(a.rooms, b.rooms, path + ".rooms", out, diffRoomExtras);
            diffList(a.nodes, b.nodes, path + ".nodes", out, NoDiffExtra{});
            diffList(a.edges, b.edges, path + ".edges", out, NoDiffExtra{});
            diffList(a.pois, b.pois, path + ".pois", out, NoDiffExtra{});
            diffList(a.anchors, b.anchors, path + ".anchors", out, NoDiffExtra{});
        }

    } // namespace

    json buildingToJson(const Building& b) {
        json j = json::object();
        j["version"] = b.version;
        j["building"] = objectToJson(b.building);
        j["source"] = objectToJson(b.source);
        json levels = json::array();
        for (const Level& lv : b.levels) levels.push_back(levelToJson(lv));
        j["levels"] = levels;
        j["links"] = listToJson(b.links);
        return j;
    }

    Result<Building> buildingFromJson(const json& j, std::string_view fileNameForErrors) {
        const std::string file(fileNameForErrors);
        if (!j.is_object()) return Result<Building>::fail(file + ": the top level must be a JSON object.");

        Building out;
        auto v = j.find("version");
        if (v != j.end()) {
            if (!v->is_number_integer()) return Result<Building>::fail(fieldError(file, "(root)", "version", "an integer"));
            const int ver = v->get<int>();
            if (ver > kWfbVersion)
                return Result<Building>::fail(file + ": file version " + std::to_string(ver) +
                    " is newer than this program supports (version " +
                    std::to_string(kWfbVersion) + "); update Wayforge.");
            out.version = ver;
        }

        auto bi = j.find("building");
        if (bi != j.end()) {
            Status s = readObject(*bi, out.building, file, "building");
            if (!s.ok) return Result<Building>::fail(s.message);
        }
        auto si = j.find("source");
        if (si != j.end()) {
            Status s = readObject(*si, out.source, file, "source");
            if (!s.ok) return Result<Building>::fail(s.message);
        }

        Status s = readList(j, "levels", "", file, out.levels,
            [&](const json& jl, Level& lv, const std::string& lp) { return readLevelChildren(jl, lv, file, lp); });
        if (!s.ok) return Result<Building>::fail(s.message);
        s = readList(j, "links", "", file, out.links, NoExtra{});
        if (!s.ok) return Result<Building>::fail(s.message);

        return Result<Building>(std::move(out));
    }

    std::vector<std::string> compareBuildings(const Building& a, const Building& b) {
        std::vector<std::string> out;
        if (a.version != b.version)
            out.push_back("version: " + std::to_string(a.version) + " vs " + std::to_string(b.version));
        diffObject(a.building, b.building, "building", out);
        diffObject(a.source, b.source, "source", out);
        diffList(a.levels, b.levels, "levels", out, diffLevelChildren);
        diffList(a.links, b.links, "links", out, NoDiffExtra{});
        return out;
    }

    Status saveBuilding(const Building& b, const std::filesystem::path& path) {
        const std::string text = buildingToJson(b).dump(2, ' ', false, json::error_handler_t::replace) + "\n";
        return io::writeText(path, text);
    }

    Result<Building> loadBuilding(const std::filesystem::path& path) {
        Result<std::string> text = io::readText(path);
        if (!text) return Result<Building>::fail(text.error());
        json j = json::parse(*text, nullptr, false);
        if (j.is_discarded()) return Result<Building>::fail(path.string() + ": not valid JSON.");
        return buildingFromJson(j, path.string());
    }

} // namespace wf