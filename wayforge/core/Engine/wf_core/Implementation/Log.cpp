#include "wf_core/Log.hpp"
#include "wf_core/Platform.hpp"
#include <iostream>
#include <mutex>

#if defined(WF_PLATFORM_ANDROID)
#include <android/log.h>
#endif

namespace wf::log {
    namespace {
        Level      g_level = Level::Info;
        Sink       g_sink;
        std::mutex g_mutex;

        void defaultSink(Level lvl, std::string_view msg) {
#if defined(WF_PLATFORM_ANDROID)
            int prio = ANDROID_LOG_INFO;
            switch (lvl) {
            case Level::Trace: prio = ANDROID_LOG_VERBOSE; break;
            case Level::Debug: prio = ANDROID_LOG_DEBUG;   break;
            case Level::Info:  prio = ANDROID_LOG_INFO;    break;
            case Level::Warn:  prio = ANDROID_LOG_WARN;    break;
            default:           prio = ANDROID_LOG_ERROR;   break;
            }
            __android_log_print(prio, "wayforge", "%.*s", static_cast<int>(msg.size()), msg.data());
#else
            std::ostream& os = (lvl >= Level::Warn) ? std::cerr : std::cout;
            os << "[" << levelName(lvl) << "] " << msg << '\n';
#endif
        }
    }

    void  setLevel(Level level) noexcept { g_level = level; }
    Level level() noexcept { return g_level; }
    void  setSink(Sink sink) { std::lock_guard<std::mutex> lock(g_mutex); g_sink = std::move(sink); }

    void write(Level lvl, std::string_view message) {
        std::lock_guard<std::mutex> lock(g_mutex);
        if (g_sink) g_sink(lvl, message);
        else        defaultSink(lvl, message);
    }

    const char* levelName(Level lvl) noexcept {
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