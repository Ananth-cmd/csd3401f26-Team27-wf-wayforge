#define WF_API_BUILDING 1
#include "wf_api/wf_api.h"
#include "wf_core/wf_core.hpp"

WF_API int         wf_ping(void)     { return 42; }
WF_API const char* wf_version(void)  { return wf::kVersionString; }
WF_API const char* wf_platform(void) { return wf::platformName(); }
