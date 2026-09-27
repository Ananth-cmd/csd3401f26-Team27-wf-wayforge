#pragma once
#include <optional>
#include <string>
#include <utility>

namespace wf {

    struct Status {
        bool        ok = true;
        std::string message;

        static Status success() { return {}; }
        static Status fail(std::string msg) { return { false, std::move(msg) }; }
        explicit operator bool() const noexcept { return ok; }
    };

    template <class T>
    class Result {
    public:
        Result(T value) : m_value(std::move(value)) {}                      // NOLINT implicit on purpose
        static Result fail(std::string msg) { Result r; r.m_error = std::move(msg); return r; }

        bool        ok()    const noexcept { return m_value.has_value(); }
        explicit operator bool() const noexcept { return ok(); }
        const std::string& error() const noexcept { return m_error; }

        T& value()& { return *m_value; }
        const T& value() const& { return *m_value; }
        T&& value()&& { return std::move(*m_value); }
        T* operator->() { return &*m_value; }
        const T* operator->() const { return &*m_value; }
        T& operator*() { return *m_value; }
        const T& operator*()  const { return *m_value; }

    private:
        Result() = default;
        std::optional<T> m_value;
        std::string      m_error;
    };

} // namespace wf
