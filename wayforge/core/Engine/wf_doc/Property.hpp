/*!
 * \file Property.hpp
 * \brief The property system: ask a struct what fields it has, by name
 *
 * C++ cannot list a struct's fields, so each struct lists them once here
 * (name, type and where it sits in the struct). Anything that needs to go over
 * every field uses that list: saving, loading, comparing two buildings, and
 * undoing a property change. Adding a field to a struct is then one line.
 * Also has getProperty / setProperty to read or write a field by name.
 *
 * Links: Property.cpp has the code behind it; Types.hpp registers every struct
 * with the WF_PROPERTIES and WF_REGISTER_TYPE macros; Serialize.cpp and
 * Command.cpp (SetPropertyCommand) loop over the lists.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan 100%
 *   - Property types, values and the field list structure
 *   - The WF_PROP, WF_PROPERTIES and WF_REGISTER_TYPE macros
 *   - Enum name handling and the get / set / describe templates
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-09-08
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#pragma once
#include <cstddef>
#include <cstdint>
#include <optional>
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

    struct PropertyInfo 
    {
        std::string_view name;
        PropertyType     type;
        size_t           offset;
        const char* const* enumNames = nullptr;   
        int              enumCount = 0;
    };

    template <class T> struct PropertyTraits;   // specialised by WF_PROPERTIES

    template <class T> inline constexpr bool is_wf_enum_v = std::is_enum_v<T>;

    // Map a C++ field type to a PropertyType.
    template <class F> constexpr PropertyType propertyTypeOf() 
    {
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

    template <class F> constexpr const char* const* enumNamesOf() 
    {
        if constexpr (std::is_enum_v<F>) return EnumNames<F>::names;
        else return nullptr;
    }


    template <class F> constexpr int enumCountOf() 
    {
        if constexpr (std::is_enum_v<F>) { int n = 0; while (EnumNames<F>::names[n]) ++n; return n;}
        else return 0;
    }

    // Public API 
    template <class T> std::span<const PropertyInfo> propertiesOf() { return PropertyTraits<T>::properties(); }
    template <class T> constexpr std::string_view typeName() { return PropertyTraits<T>::name(); }

    const PropertyInfo* findProperty(std::span<const PropertyInfo> props, std::string_view name) noexcept;

    //reads field by name
    PropertyValue getPropertyRaw(const void* object, const PropertyInfo& info);

    bool setPropertyRaw(void* object, const PropertyInfo& info, const PropertyValue& value);

    std::string propertyValueToString(const PropertyValue& v, const PropertyInfo* info = nullptr);

    template <class T> std::optional<PropertyValue> getProperty(const T& obj, std::string_view name) 
    {
        const PropertyInfo* p = findProperty(propertiesOf<T>(), name);
        if (!p) return std::nullopt;
        return getPropertyRaw(&obj, *p);
    }

    template <class T> bool setProperty(T& obj, std::string_view name, const PropertyValue& value) 
    {
        const PropertyInfo* p = findProperty(propertiesOf<T>(), name);
        return p ? setPropertyRaw(&obj, *p, value) : false;
    }

    //Debugging and prints line by line
    template <class T> std::string describe(const T& obj) 
    {
        std::string out(typeName<T>());
        out += " {\n";
        for (const auto& p : propertiesOf<T>()) 
        {
            out += "  "; out += p.name; out += " = ";
            out += propertyValueToString(getPropertyRaw(&obj, p), &p); out += "\n";
        }

        out += "}";
        return out;
    }

    const char* propertyTypeName(PropertyType t) noexcept;

} // namespace wf

// Declaration macros 

//make 1 row
#define WF_PROP(field) \
    ::wf::PropertyInfo{ #field, ::wf::propertyTypeOf<decltype(WfSelf::field)>(), offsetof(WfSelf, field), \
                        ::wf::enumNamesOf<decltype(WfSelf::field)>(), ::wf::enumCountOf<decltype(WfSelf::field)>() }

//Builds its field list
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