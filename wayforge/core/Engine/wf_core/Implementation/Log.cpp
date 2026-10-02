/*!
 * \file Log.cpp
 * \brief Implementation of the Wayforge logger
 *
 * Keeps the current log level and the optional custom sink, and decides
 * where each message ends up: Android's logcat on the phone, or the
 * console (stdout for info, stderr for warnings and errors) on a PC.
 * A mutex makes sure two threads never mix their lines together.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Default console / logcat output, chosen at compile time
 *   - Thread-safe writing with a mutex
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-22
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_core/Log.hpp"        // Level, Sink and the functions defined here.
#include "wf_core/Platform.hpp"   // WF_PLATFORM_ANDROID tells us if we are building for the phone.
#include <iostream>               // std::cout / std::cerr for the PC console.
#include <mutex>                  // std::mutex so only one thread writes at a time.

#if defined(WF_PLATFORM_ANDROID)
    #include <android/log.h>      // __android_log_print: Android's logcat (only exists in the NDK).
#endif

namespace wf::log {
namespace {   // Anonymous namespace: these globals are private to this file.
    Level      g_level = Level::Info;   // Show info, warn and error by default.
    Sink       g_sink;                  // Empty unless someone calls setSink().
    std::mutex g_mutex;                 // Guards g_sink and the actual writing.

    // Where messages go when no custom sink is set.
    void defaultSink(Level lvl, std::string_view msg) {
#if defined(WF_PLATFORM_ANDROID)
        // Map our level to Android's priority so logcat colours and filters it properly.
        int prio = ANDROID_LOG_INFO;
        switch (lvl) {
            case Level::Trace: prio = ANDROID_LOG_VERBOSE; break;
            case Level::Debug: prio = ANDROID_LOG_DEBUG;   break;
            case Level::Info:  prio = ANDROID_LOG_INFO;    break;
            case Level::Warn:  prio = ANDROID_LOG_WARN;    break;
            default:           prio = ANDROID_LOG_ERROR;   break;
        }
        // "%.*s" prints exactly msg.size() characters (a string_view is not null-terminated).
        __android_log_print(prio, "wayforge", "%.*s", static_cast<int>(msg.size()), msg.data());
#else
        // Warnings and errors go to stderr so they stand out; everything else to stdout.
        std::ostream& os = (lvl >= Level::Warn) ? std::cerr : std::cout;
        os << "[" << levelName(lvl) << "] " << msg << '\n';   // e.g. "[warn] no rooms found"
#endif
    }
}

void  setLevel(Level level) noexcept { g_level = level; }
Level level() noexcept { return g_level; }
void  setSink(Sink sink) { std::lock_guard<std::mutex> lock(g_mutex); g_sink = std::move(sink); }   // Locked so a log line can't be mid-way through the old sink.

void write(Level lvl, std::string_view message) {
    std::lock_guard<std::mutex> lock(g_mutex);   // One message at a time, so lines from two threads never mix.
    if (g_sink) g_sink(lvl, message);            // Someone plugged in their own output: use it.
    else        defaultSink(lvl, message);       // Otherwise console / logcat.
}

const char* levelName(Level lvl) noexcept {
    // Short lower-case names used in the "[info]" prefix.
    switch (lvl) {
        case Level::Trace: return "trace";
        case Level::Debug: return "debug";
        case Level::Info:  return "info";
        case Level::Warn:  return "warn";
        case Level::Error: return "error";
        default:           return "off";
    }
}

} // namespace wf::log
