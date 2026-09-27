// wf_cli - headless tool. Runs on Ubuntu in CI.
//   wf_cli --version
// TODO(IMGD1): convert / info / graph / route commands.
#include "wf_core/wf_core.hpp"
#include <iostream>
#include <string>

int main(int argc, char** argv) {
    if (argc > 1 && std::string(argv[1]) == "--version") {
        std::cout << "wf_cli " << wf::kVersionString << " (" << wf::platformName() << ")\n";
        return 0;
    }
    std::cout << "usage: wf_cli --version\n";
    return 2;
}
