// Simple string-id helpers. Ids inside a .wfb are short strings ("w12", "r3")
// so the file stays readable in a text editor.
#pragma once
#include <string>
#include <string_view>

namespace wf {

// Makes "w1", "w2", ... / "r1", ... Thread-unsafe by design (single document per thread).
class IdGenerator {
public:
    std::string next(std::string_view prefix) {
        return std::string(prefix) + std::to_string(++m_counter);
    }
    void bump(int atLeast) noexcept { if (atLeast > m_counter) m_counter = atLeast; }
    void reset() noexcept { m_counter = 0; }
    int  counter() const noexcept { return m_counter; }
private:
    int m_counter = 0;
};

// "w42" -> 42, anything unparsable -> -1
int idNumber(std::string_view id) noexcept;

} // namespace wf
