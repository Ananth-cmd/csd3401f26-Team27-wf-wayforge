// The property system.
//
// Asks any registered struct what fields it has, by name and type, at runtime.
// Hand-rolled (about 150 lines) because it must compile under the Android NDK.
// xproperty (approved, recommended) can replace it later behind the same API.
//
//   struct Wall { Vec2 a, b; float thickness;
//       WF_PROPERTIES(Wall, WF_PROP(a), WF_PROP(b), WF_PROP(thickness)) };
//
//   for (auto& p : wf::propertiesOf<Wall>()) ...      // reflection
//   wf::getProperty(wall, "thickness")                // -> PropertyValue
//   wf::setProperty(wall, "thickness", 0.3f)
//
// The editor inspector, the JSON serializer and the generic SetPropertyCommand
// are all written once against this table instead of once per type.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <variant>
#include <vector>
#include <span>
#include <type_traits>
#include "wf_core/wf_core.hpp"

namespace wf {

enum class PropertyType : uint8_t { Bool, Int, Float, String, Vec2, Enum };

using PropertyValue = std::variant<bool, int, float, std::string, Vec2>;

struct PropertyInfo {
    std::string_view name;
    PropertyType     type;
    size_t           offset;
    const char* const* enumNames = nullptr;   // for Enum: null-terminated list of names
    int              enumCount = 0;
};

template <class T> struct PropertyTraits;   // specialised by WF_PROPERTIES

template <class T> inline constexpr bool is_wf_enum_v = std::is_enum_v<T>;

// Map a C++ field type to a PropertyType.
template <class F> constexpr PropertyType propertyTypeOf() {
    if constexpr (std::is_same_v<F, bool>)        return PropertyType::Bool;
    else if constexpr (std::is_same_v<F, int>)    return PropertyType::Int;
    else if constexpr (std::is_same_v<F, float>)  return PropertyType::Float;
    else if constexpr (std::is_same_v<F, std::string>) return PropertyType::String;
    else if constexpr (std::is_same_v<F, Vec2>)   return PropertyType::Vec2;
    else if constexpr (std::is_enum_v<F>)         return PropertyType::Enum;
    else static_assert(sizeof(F) == 0, "unsupported property field type");
}

// Enum name tables: specialise wf::EnumNames<E> for each enum used as a property.
template <class E> struct EnumNames;   // { static constexpr const char* names[] = {..., nullptr}; }

template <class F> constexpr const char* const* enumNamesOf() {
    if constexpr (std::is_enum_v<F>) return EnumNames<F>::names;
    else return nullptr;
}
template <class F> constexpr int enumCountOf() {
    if constexpr (std::is_enum_v<F>) {
        int n = 0; while (EnumNames<F>::names[n]) ++n; return n;
    } else return 0;
}

// Public API ---------------------------------------------------------------
template <class T> std::span<const PropertyInfo> propertiesOf() { return PropertyTraits<T>::properties(); }
template <class T> constexpr std::string_view typeName() { return PropertyTraits<T>::name(); }

const PropertyInfo* findProperty(std::span<const PropertyInfo> props, std::string_view name) noexcept;

// Raw (type-erased) access, used by the serializer and the C API.
PropertyValue getPropertyRaw(const void* object, const PropertyInfo& info);
bool          setPropertyRaw(void* object, const PropertyInfo& info, const PropertyValue& value);
std::string   propertyValueToString(const PropertyValue& v, const PropertyInfo* info = nullptr);

template <class T> PropertyValue getProperty(const T& obj, std::string_view name) {
    const PropertyInfo* p = findProperty(propertiesOf<T>(), name);
    return p ? getPropertyRaw(&obj, *p) : PropertyValue{};
}
template <class T> bool setProperty(T& obj, std::string_view name, const PropertyValue& value) {
    const PropertyInfo* p = findProperty(propertiesOf<T>(), name);
    return p ? setPropertyRaw(&obj, *p, value) : false;
}
// "name = value" lines for every field. No per-type print function needed.
template <class T> std::string describe(const T& obj) {
    std::string out(typeName<T>());
    out += " {\n";
    for (const auto& p : propertiesOf<T>()) {
        out += "  "; out += p.name; out += " = ";
        out += propertyValueToString(getPropertyRaw(&obj, p), &p); out += "\n";
    }
    out += "}";
    return out;
}

const char* propertyTypeName(PropertyType t) noexcept;

} // namespace wf

// Declaration macros ---------------------------------------------------------
#define WF_PROP(field) \
    ::wf::PropertyInfo{ #field, ::wf::propertyTypeOf<decltype(WfSelf::field)>(), offsetof(WfSelf, field), \
                        ::wf::enumNamesOf<decltype(WfSelf::field)>(), ::wf::enumCountOf<decltype(WfSelf::field)>() }

#define WF_PROPERTIES(Type, ...)                                                       \
    using WfSelf = Type;                                                               \
    static std::span<const ::wf::PropertyInfo> wfProperties() {                        \
        static const ::wf::PropertyInfo table[] = { __VA_ARGS__ };                     \
        return { table, sizeof(table) / sizeof(table[0]) };                            \
    }                                                                                  \
    static constexpr std::string_view wfTypeName() { return #Type; }

#define WF_REGISTER_TYPE(Type)                                                         \
    template <> struct wf::PropertyTraits<Type> {                                    \
        static std::span<const ::wf::PropertyInfo> properties() { return Type::wfProperties(); } \
        static constexpr std::string_view name() { return Type::wfTypeName(); }        \
    };
