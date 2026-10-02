/*!
 * \file Log.hpp
 * \brief Tiny logger used by the whole C++ core
 *
 * Gives every library one way to print messages with a level (trace,
 * debug, info, warn, error). Messages are written with the WF_LOG_* macros
 * using normal "<<" streaming. On a PC they go to the console; on Android
 * they go to logcat, so the same log lines show up on the phone too.
 * A custom "sink" can be plugged in (e.g. to show logs inside Unity).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Stream-style logging macros that cost nothing when the level is off
 *   - Pluggable sink, with logcat output on Android
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-22
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// Tiny logger. Stream-style so we do not depend on std::format (NDK / older GCC)
// or spdlog. spdlog is approved and can replace this later without touching callers.
//
//   WF_LOG_INFO("loaded " << n << " walls");
//   wf::log::setLevel(wf::log::Level::Debug);
#pragma once
#include <sstream>       // std::ostringstream builds the message inside WF_LOG.
#include <string>
#include <string_view>   // Messages are passed around without copying.
#include <functional>    // std::function holds the (optional) custom sink.

namespace wf::log {

// Lowest to highest. Anything below the current level is skipped. "Off" hides everything.
enum class Level { Trace = 0, Debug, Info, Warn, Error, Off };

// A sink is "where log lines go": any function taking (level, message).
using Sink = std::function<void(Level, std::string_view)>;

void  setLevel(Level level) noexcept;   // Choose how chatty the log is (default: Info).
Level level() noexcept;                 // The current level, used by the WF_LOG macro.
void  setSink(Sink sink);          // default sink writes to stdout/stderr (logcat on Android)
void  write(Level level, std::string_view message);   // Send one finished message to the sink.
const char* levelName(Level level) noexcept;          // Level -> "info", "warn" ... for printing.

} // namespace wf::log

// The macro first checks the level, so a disabled message never even builds its text (cheap when off).
// do { ... } while (0) makes it behave like one normal statement, even inside an if without braces.
#define WF_LOG(lvl, expr)                                              \
    do {                                                               \
        if (static_cast<int>(lvl) >= static_cast<int>(::wf::log::level())) { \
            std::ostringstream _wf_oss; _wf_oss << expr;               \
            ::wf::log::write(lvl, _wf_oss.str());                      \
        }                                                              \
    } while (0)

// One shortcut per level, e.g. WF_LOG_WARN("no rooms found in " << path);
#define WF_LOG_TRACE(expr) WF_LOG(::wf::log::Level::Trace, expr)
#define WF_LOG_DEBUG(expr) WF_LOG(::wf::log::Level::Debug, expr)
#define WF_LOG_INFO(expr)  WF_LOG(::wf::log::Level::Info,  expr)
#define WF_LOG_WARN(expr)  WF_LOG(::wf::log::Level::Warn,  expr)
#define WF_LOG_ERROR(expr) WF_LOG(::wf::log::Level::Error, expr)
