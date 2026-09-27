//   WF_LOG_INFO("loaded " << n << " walls");
//   wf::log::setLevel(wf::log::Level::Debug);
#pragma once
#include <sstream>
#include <string>
#include <string_view>
#include <functional>

namespace wf::log {

    enum class Level { Trace = 0, Debug, Info, Warn, Error, Off };

    using Sink = std::function<void(Level, std::string_view)>;

    void  setLevel(Level level) noexcept;
    Level level() noexcept;
    void  setSink(Sink sink);          // default sink writes to stdout/stderr (logcat on Android)
    void  write(Level level, std::string_view message);
    const char* levelName(Level level) noexcept;

} // namespace wf::log

#define WF_LOG(lvl, expr)                                              \
    do {                                                               \
        if (static_cast<int>(lvl) >= static_cast<int>(::wf::log::level())) { \
            std::ostringstream _wf_oss; _wf_oss << expr;               \
            ::wf::log::write(lvl, _wf_oss.str());                      \
        }                                                              \
    } while (0)

#define WF_LOG_TRACE(expr) WF_LOG(::wf::log::Level::Trace, expr)
#define WF_LOG_DEBUG(expr) WF_LOG(::wf::log::Level::Debug, expr)
#define WF_LOG_INFO(expr)  WF_LOG(::wf::log::Level::Info,  expr)
#define WF_LOG_WARN(expr)  WF_LOG(::wf::log::Level::Warn,  expr)
#define WF_LOG_ERROR(expr) WF_LOG(::wf::log::Level::Error, expr)
