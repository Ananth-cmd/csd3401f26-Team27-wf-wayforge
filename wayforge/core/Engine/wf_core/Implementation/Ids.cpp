#include "wf_core/Ids.hpp"
#include <cctype>
#include <charconv>

namespace wf {

int idNumber(std::string_view id) noexcept {
    size_t i = 0;
    while (i < id.size() && !std::isdigit(static_cast<unsigned char>(id[i]))) ++i;
    if (i >= id.size()) return -1;
    int value = 0;
    auto [ptr, ec] = std::from_chars(id.data() + i, id.data() + id.size(), value);
    return ec == std::errc{} ? value : -1;
}

} // namespace wf
