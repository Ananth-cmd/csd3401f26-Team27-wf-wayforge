/*!
\file Result.hpp

\brief Lightweight error handling for operations that can fail
Provides Status and Result<T> types for reporting success or failure
without relying on exceptions. Status is used for operations that only need
to report whether they succeeded, while Result<T> stores either a returned
value or an error message.

This is especially useful at library and C API boundaries, where exceptions
should not escape into calling code. Functions can instead return a
Result<T> or Status and allow the caller to handle errors explicitly.
Result<T> stores successful values using std::optional and provides helper
operators for accessing them in a similar way to normal objects and
pointers. Failed results keep an error string describing what went wrong.



Links: Used by Wayforge functions that may fail, particularly code called
through wf_api where errors must be reported safely across the C boundary.



\author Kervin Ong Guan Cheng (Kervinguancheng.ong@digipen.edu)



Contribution: Kervin Ong Guan Cheng 100%
Status type for simple success and failure reporting
Result<T> type for returning either values or error messages
Value access and pointer-style helper operators
Error propagation without exceptions crossing API boundaries



AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.



\date 2026-10-02

\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
*/
#pragma once
#include <optional>
#include <string>
#include <utility>

namespace wf {

struct Status {
    bool        ok = true;
    std::string message;

    static Status success()                    { return {}; }
    static Status fail(std::string msg)        { return {false, std::move(msg)}; }
    explicit operator bool() const noexcept    { return ok; }
};

template <class T>
class Result {
public:
    Result(T value) : m_value(std::move(value)) {}                      // NOLINT implicit on purpose
    static Result fail(std::string msg) { Result r; r.m_error = std::move(msg); return r; }

    bool        ok()    const noexcept { return m_value.has_value(); }
    explicit operator bool() const noexcept { return ok(); }
    const std::string& error() const noexcept { return m_error; }

    T&       value()       & { return *m_value; }
    const T& value() const & { return *m_value; }
    T&&      value()      && { return std::move(*m_value); }
    T*       operator->()       { return &*m_value; }
    const T* operator->() const { return &*m_value; }
    T&       operator*()        { return *m_value; }
    const T& operator*()  const { return *m_value; }

private:
    Result() = default;
    std::optional<T> m_value;
    std::string      m_error;
};

} // namespace wf
