#include "wf_doc/Property.hpp"
#include <cstring>
#include <sstream>
#include <iomanip>

namespace wf {

const PropertyInfo* findProperty(std::span<const PropertyInfo> props, std::string_view name) noexcept {
    for (const auto& p : props) if (p.name == name) return &p;
    return nullptr;
}

PropertyValue getPropertyRaw(const void* object, const PropertyInfo& info) {
    const auto* base = static_cast<const std::byte*>(object) + info.offset;
    switch (info.type) {
        case PropertyType::Bool:   return *reinterpret_cast<const bool*>(base);
        case PropertyType::Int:    return *reinterpret_cast<const int*>(base);
        case PropertyType::Float:  return *reinterpret_cast<const float*>(base);
        case PropertyType::String: return *reinterpret_cast<const std::string*>(base);
        case PropertyType::Vec2:   return *reinterpret_cast<const Vec2*>(base);
        case PropertyType::Enum:   return static_cast<int>(*reinterpret_cast<const uint8_t*>(base));
    }
    return {};
}

bool setPropertyRaw(void* object, const PropertyInfo& info, const PropertyValue& value) {
    auto* base = static_cast<std::byte*>(object) + info.offset;
    switch (info.type) {
        case PropertyType::Bool:
            if (auto* v = std::get_if<bool>(&value)) { *reinterpret_cast<bool*>(base) = *v; return true; }
            if (auto* v = std::get_if<int>(&value))  { *reinterpret_cast<bool*>(base) = *v != 0; return true; }
            return false;
        case PropertyType::Int:
            if (auto* v = std::get_if<int>(&value))   { *reinterpret_cast<int*>(base) = *v; return true; }
            if (auto* v = std::get_if<float>(&value)) { *reinterpret_cast<int*>(base) = static_cast<int>(*v); return true; }
            return false;
        case PropertyType::Float:
            if (auto* v = std::get_if<float>(&value)) { *reinterpret_cast<float*>(base) = *v; return true; }
            if (auto* v = std::get_if<int>(&value))   { *reinterpret_cast<float*>(base) = static_cast<float>(*v); return true; }
            return false;
        case PropertyType::String:
            if (auto* v = std::get_if<std::string>(&value)) { *reinterpret_cast<std::string*>(base) = *v; return true; }
            return false;
        case PropertyType::Vec2:
            if (auto* v = std::get_if<Vec2>(&value)) { *reinterpret_cast<Vec2*>(base) = *v; return true; }
            return false;
        case PropertyType::Enum: {
            int idx = -1;
            if (auto* v = std::get_if<int>(&value)) idx = *v;
            else if (auto* s = std::get_if<std::string>(&value)) {
                for (int i = 0; i < info.enumCount; ++i)
                    if (*s == info.enumNames[i]) { idx = i; break; }
            }
            if (idx < 0 || idx >= info.enumCount) return false;
            *reinterpret_cast<uint8_t*>(base) = static_cast<uint8_t>(idx);
            return true;
        }
    }
    return false;
}

std::string propertyValueToString(const PropertyValue& v, const PropertyInfo* info) {
    std::ostringstream os;
    os << std::setprecision(6);
    if (info && info->type == PropertyType::Enum) {
        if (auto* i = std::get_if<int>(&v); i && *i >= 0 && *i < info->enumCount) return info->enumNames[*i];
    }
    std::visit([&](const auto& x) {
        using T = std::decay_t<decltype(x)>;
        if constexpr (std::is_same_v<T, bool>)        os << (x ? "true" : "false");
        else if constexpr (std::is_same_v<T, Vec2>)   os << "(" << x.x << ", " << x.y << ")";
        else if constexpr (std::is_same_v<T, std::string>) os << '"' << x << '"';
        else os << x;
    }, v);
    return os.str();
}

const char* propertyTypeName(PropertyType t) noexcept {
    switch (t) {
        case PropertyType::Bool: return "bool";
        case PropertyType::Int: return "int";
        case PropertyType::Float: return "float";
        case PropertyType::String: return "string";
        case PropertyType::Vec2: return "vec2";
        case PropertyType::Enum: return "enum";
    }
    return "?";
}

} // namespace wf
