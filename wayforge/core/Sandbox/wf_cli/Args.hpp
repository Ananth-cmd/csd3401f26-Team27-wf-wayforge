// Tiny command line parser: positional args + --key value + --flag.
#pragma once
#include <string>
#include <vector>
#include <map>
#include <optional>
#include <cstdlib>
#include <algorithm>

namespace wf::cli {

struct Args {
    std::vector<std::string>           positional;
    std::map<std::string, std::string> options;   // "--out" -> "x.wfb"; flags map to "true"

    static Args parse(int argc, char** argv, const std::vector<std::string>& flags = {}) {
        Args a;
        for (int i = 1; i < argc; ++i) {
            std::string s = argv[i];
            if (s.rfind("--", 0) == 0) {
                const bool isFlag = std::find(flags.begin(), flags.end(), s) != flags.end();
                if (!isFlag && i + 1 < argc && std::string(argv[i + 1]).rfind("--", 0) != 0) a.options[s] = argv[++i];
                else a.options[s] = "true";
            } else a.positional.push_back(s);
        }
        return a;
    }
    bool has(const std::string& k) const { return options.count(k) > 0; }
    std::string get(const std::string& k, const std::string& def = "") const { auto it = options.find(k); return it == options.end() ? def : it->second; }
    float getFloat(const std::string& k, float def) const { auto it = options.find(k); return it == options.end() ? def : std::strtof(it->second.c_str(), nullptr); }
    int   getInt(const std::string& k, int def) const { auto it = options.find(k); return it == options.end() ? def : std::atoi(it->second.c_str()); }
    const std::string& pos(size_t i, const std::string& def = "") const { static const std::string empty; return i < positional.size() ? positional[i] : (def.empty() ? empty : def); }
};

} // namespace wf::cli
