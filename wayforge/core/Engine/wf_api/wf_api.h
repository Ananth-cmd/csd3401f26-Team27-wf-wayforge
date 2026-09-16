/* wf_api - the flat C interface that Unity (P/Invoke) loads from wayforge.dll / libwayforge.so.
 * Rules: C types only across the boundary; every function wrapped in try/catch; caller allocates buffers.
 */
#ifndef WAYFORGE_API_H
#define WAYFORGE_API_H

#if defined(_WIN32)
  #if defined(WF_API_BUILDING)
    #define WF_API_EXPORT __declspec(dllexport)
  #else
    #define WF_API_EXPORT __declspec(dllimport)
  #endif
#else
  #define WF_API_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
  #define WF_API extern "C" WF_API_EXPORT
#else
  #define WF_API WF_API_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

WF_API int         wf_ping(void);      /* returns 42: proves the plugin loads */
WF_API const char* wf_version(void);
WF_API const char* wf_platform(void);

/* TODO(RTIS2): wf_open_plan, wf_close, wf_last_error, wall/room getters, undo, graph, route ... */

#ifdef __cplusplus
}
#endif
#endif
