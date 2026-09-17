#pragma once

#include "wf_doc/Types.hpp"
#include <string>
#include <string_view>
#include <variant>
#include <span>
#include <optional>
#include <cstddef>

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

    template <class T> std::span<const PropertyInfo> propertiesOf();

    const PropertyInfo* findProperty(std::span<const PropertyInfo>, std::string_view name);
    PropertyValue getPropertyRaw(const void* object, const PropertyInfo&);
    bool setPropertyRaw(void* object, const PropertyInfo&, const PropertyValue&);

    template <class T> std::optional<PropertyValue> getProperty(const T&, std::string_view);
    template <class T> bool setProperty(T&, std::string_view, const PropertyValue&);

    std::string propertyValueToString(const PropertyValue&, const PropertyInfo*);
    const char* propertyTypeName(PropertyType);

    // Macros to be implemented in Week 1
#define WF_PROP(field) /* offsetof + type deduction */
#define WF_PROPERTIES(Type, ...) \
    static std::span<const PropertyInfo> properties() { \
        static const PropertyInfo t[] = { __VA_ARGS__ }; \
        return t; \
    }
#define WF_REGISTER_TYPE(Type) \
    template<> inline std::span<const PropertyInfo> propertiesOf<Type>() { \
        return Type::properties(); \
    }

} // namespace wf