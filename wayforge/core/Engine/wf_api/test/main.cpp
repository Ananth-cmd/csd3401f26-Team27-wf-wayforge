// Links the shared library exactly the way Unity will.
#include "wf_api/wf_api.h"
#include <iostream>

int main() {
    if (wf_ping() != 42) { std::cerr << "wf_ping failed\n"; return 1; }
    std::cout << "wayforge " << wf_version() << " on " << wf_platform() << ": plugin OK\n";
    return 0;
}
