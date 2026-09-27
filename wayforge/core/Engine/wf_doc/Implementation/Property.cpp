#include "wf_doc/Property.hpp"
#include <cstdio>

namespace wf {

    const PropertyInfo* findProperty(std::span<const PropertyInfo> ps, std::string_view name) {
        for (const PropertyInfo& p : ps)
            if (p.name == name) return &p;
        return nullptr;
    }

    PropertyValue getPropertyRaw(const void* obj, const PropertyInfo& p) {
        const auto* b = static_cast<const unsigned char*>(obj) + p.offset;
        switch (p.type) {
        case PropertyType::Bool:   return *reinterpret_cast<const bool*>(b);
        case PropertyType::Int:    return *reinterpret_cast<const int*>(b);
        case PropertyType::Float:  return *reinterpret_cast<const float*>(b);
        case PropertyType::String: return *reinterpret_cast<const std::string*>(b);
        case PropertyType::Vec2:   return *reinterpret_cast<const Vec2*>(b);
        case PropertyType::Enum: 
        {
            int i = *b;
            return std::string(i < p.enumCount ? p.enumNames[i] : "");
        }
        }
        return false;
    }

    bool setPropertyRaw(void* obj, const PropertyInfo& p, const PropertyValue& v) {
        auto* b = static_cast<unsigned char*>(obj) + p.offset;
        switch (p.type) {
        case PropertyType::Bool:
            if (const bool* x = std::get_if<bool>(&v)) { *reinterpret_cast<bool*>(b) = *x; return true; }
            return false;
        case PropertyType::Int:
            if (const int* x = std::get_if<int>(&v)) { *reinterpret_cast<int*>(b) = *x; return true; }
            return false;
        case PropertyType::Float:
            if (const float* x = std::get_if<float>(&v)) { *reinterpret_cast<float*>(b) = *x; return true; }
            if (const int* i = std::get_if<int>(&v)) { *reinterpret_cast<float*>(b) = static_cast<float>(*i); return true; }
            return false;
        case PropertyType::String:
            if (const std::string* x = std::get_if<std::string>(&v)) { *reinterpret_cast<std::string*>(b) = *x; return true; }
            return false;
        case PropertyType::Vec2:
            if (const Vec2* x = std::get_if<Vec2>(&v)) { *reinterpret_cast<Vec2*>(b) = *x; return true; }
            return false;
        case PropertyType::Enum:
            if (const std::string* s = std::get_if<std::string>(&v)) {
                for (int i = 0; i < p.enumCount; ++i)
                    if (*s == p.enumNames[i]) { *b = static_cast<unsigned char>(i); return true; }
            }
            return false;
        }
        return false;
    }

    std::string propertyValueToString(const PropertyValue& v, const PropertyInfo*) {
        char buf[64];
        if (const bool* b = std::get_if<bool>(&v))               return *b ? "true" : "false";
        if (const int* i = std::get_if<int>(&v))                 return std::to_string(*i);
        if (const float* f = std::get_if<float>(&v)) { std::snprintf(buf, sizeof buf, "%g", static_cast<double>(*f)); return buf; }
        if (const std::string* s = std::get_if<std::string>(&v)) return *s;
        const Vec2& p = std::get<Vec2>(v);
        std::snprintf(buf, sizeof buf, "%g,%g", static_cast<double>(p.x), static_cast<double>(p.y));
        return buf;
    }

    const char* propertyTypeName(PropertyType t) {
        switch (t) {
        case PropertyType::Bool:   return "bool";
        case PropertyType::Int:    return "int";
        case PropertyType::Float:  return "float";
        case PropertyType::String: return "string";
        case PropertyType::Vec2:   return "vec2";
        case PropertyType::Enum:   return "enum";
        }
        return "unknown";
    }

} // namespace wf