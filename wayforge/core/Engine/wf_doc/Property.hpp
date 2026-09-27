#pragma once
// Property system: describe each struct's fields once; save/load, the C API,
// undo commands and the Unity inspector all iterate the same list.


#include "wf_core/wf_core.hpp"   // Vec2
#include <cstddef>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <type_traits>
#include <variant>

namespace wf {

    enum class PropertyType { Bool, Int, Float, String, Vec2, Enum };

    using PropertyValue = std::variant<bool, int, float, std::string, Vec2>;

    struct PropertyInfo {
        std::string_view name;
        PropertyType type;
        size_t offset;
        const char* const* enumNames = nullptr;
        int enumCount = 0;
    };

    template <class E> struct EnumNames;

    template <class T> std::span<const PropertyInfo> propertiesOf();   

    const PropertyInfo* findProperty(std::span<const PropertyInfo>, std::string_view name);
    PropertyValue getPropertyRaw(const void* object, const PropertyInfo&);
    bool setPropertyRaw(void* object, const PropertyInfo&, const PropertyValue&);   

    std::string propertyValueToString(const PropertyValue&, const PropertyInfo*);
    const char* propertyTypeName(PropertyType);

    template <class T> std::optional<PropertyValue> getProperty(const T& o, std::string_view name) {
        const PropertyInfo* p = findProperty(propertiesOf<T>(), name);
        if (!p) return std::nullopt;
        return getPropertyRaw(&o, *p);
    }

    template <class T> bool setProperty(T& o, std::string_view name, const PropertyValue& v) {
        const PropertyInfo* p = findProperty(propertiesOf<T>(), name);
        return p && setPropertyRaw(&o, *p, v);
    }

  
    template <class T> bool setProperty(T& o, std::string_view name, const char* s) {
        return setProperty(o, name, PropertyValue{ std::string(s) });
    }

    namespace detail {
        template <class T> constexpr PropertyType typeOf() {
            if constexpr (std::is_same_v<T, bool>)             return PropertyType::Bool;
            else if constexpr (std::is_same_v<T, int>)         return PropertyType::Int;
            else if constexpr (std::is_same_v<T, float>)       return PropertyType::Float;
            else if constexpr (std::is_same_v<T, std::string>) return PropertyType::String;
            else if constexpr (std::is_same_v<T, Vec2>)        return PropertyType::Vec2;
            else {
                static_assert(std::is_enum_v<T> && sizeof(T) == 1, "property must be bool/int/float/string/Vec2 or a uint8_t enum class");
                return PropertyType::Enum;
            }
        }
        template <class T> constexpr const char* const* enumNamesOf() {
            if constexpr (std::is_enum_v<T>) return EnumNames<T>::names; else return nullptr;
        }
        template <class T> constexpr int enumCountOf() {
            if constexpr (std::is_enum_v<T>) return EnumNames<T>::count; else return 0;
        }
    }

    // Usage inside a struct:   WF_PROPERTIES(Wall, WF_PROP(Wall, id), WF_PROP(Wall, a), ...)
    // and right after it:      WF_REGISTER_TYPE(Wall)
#define WF_PROP(Type, field) \
    ::wf::PropertyInfo{ #field, ::wf::detail::typeOf<decltype(Type::field)>(), offsetof(Type, field), \
                        ::wf::detail::enumNamesOf<decltype(Type::field)>(), \
                        ::wf::detail::enumCountOf<decltype(Type::field)>() }

#define WF_PROPERTIES(Type, ...) \
    static std::span<const ::wf::PropertyInfo> properties() { \
        static const ::wf::PropertyInfo t[] = { __VA_ARGS__ }; \
        return t; \
    }

#define WF_REGISTER_TYPE(Type) \
    template<> inline std::span<const PropertyInfo> propertiesOf<Type>() { \
        return Type::properties(); \
    }

} // namespace wf