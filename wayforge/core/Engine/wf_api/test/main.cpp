/*!

\file main.cpp

\brief Basic shared-library loading test for the Wayforge API
Provides a small executable that links against the Wayforge shared library
in the same way that Unity does. It verifies that the exported C API can be
called successfully and that the plugin has been linked and loaded correctly.

The test calls wf_ping() and expects the known value 42. If the call succeeds,
it also prints the Wayforge version and detected platform using wf_version()
and wf_platform(). A failed ping returns a non-zero exit code so build and
test systems can detect that the plugin is not working correctly.


Links: Uses the public wf_api interface and acts as a simple smoke test for
the same shared library that Unity loads through P/Invoke.


\author Kervin Ong Guan Cheng (Kervinguancheng.ong@digipen.edu)



Contribution: Kervin Ong Guan Cheng 100%
Shared-library linkage smoke test
wf_ping() validation
Version and platform output for debugging


AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.



\date 2026-10-02

\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
*/
#include "wf_api/wf_api.h"
#include <iostream>

int main() {
    if (wf_ping() != 42) { std::cerr << "wf_ping failed\n"; return 1; }
    std::cout << "wayforge " << wf_version() << " on " << wf_platform() << ": plugin OK\n";
    return 0;
}
