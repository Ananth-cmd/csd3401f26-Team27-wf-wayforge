#include "wf_core/FileIO.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <iterator>

namespace wf::io {

    Result<std::string> readText(const fs::path& path)
    {
        std::ifstream in(path, std::ios::in | std::ios::binary);

        if (!in) {
            return Result<std::string>::fail(
                "cannot open file for reading: " + path.string()
            );
        }

        std::string text(
            (std::istreambuf_iterator<char>(in)),
            std::istreambuf_iterator<char>()
        );

        if (in.bad()) {
            return Result<std::string>::fail(
                "read failed: " + path.string()
            );
        }

        // Normalise Windows line endings so parsers see the same bytes
        // on every platform.
        text.erase(
            std::remove(text.begin(), text.end(), '\r'),
            text.end()
        );

        return text;
    }

    Result<std::vector<uint8_t>> readBytes(const fs::path& path)
    {
        std::ifstream in(path, std::ios::in | std::ios::binary);

        if (!in) {
            return Result<std::vector<uint8_t>>::fail(
                "cannot open file for reading: " + path.string()
            );
        }

        std::vector<uint8_t> bytes(
            (std::istreambuf_iterator<char>(in)),
            std::istreambuf_iterator<char>()
        );

        if (in.bad()) {
            return Result<std::vector<uint8_t>>::fail(
                "read failed: " + path.string()
            );
        }

        return bytes;
    }

    Status writeText(const fs::path& path, std::string_view text)
    {
        if (path.has_parent_path()) {
            if (auto s = ensureDirectory(path.parent_path()); !s) {
                return s;
            }
        }

        std::ofstream out(
            path,
            std::ios::out | std::ios::binary | std::ios::trunc
        );

        if (!out) {
            return Status::fail(
                "cannot open file for writing: " + path.string()
            );
        }

        out.write(
            text.data(),
            static_cast<std::streamsize>(text.size())
        );

        if (!out) {
            return Status::fail(
                "write failed: " + path.string()
            );
        }

        return Status::success();
    }

    Status writeBytes(
        const fs::path& path,
        const std::vector<uint8_t>& bytes)
    {
        if (path.has_parent_path()) {
            if (auto s = ensureDirectory(path.parent_path()); !s) {
                return s;
            }
        }

        std::ofstream out(
            path,
            std::ios::out | std::ios::binary | std::ios::trunc
        );

        if (!out) {
            return Status::fail(
                "cannot open file for writing: " + path.string()
            );
        }

        if (!bytes.empty()) {
            out.write(
                reinterpret_cast<const char*>(bytes.data()),
                static_cast<std::streamsize>(bytes.size())
            );
        }

        if (!out) {
            return Status::fail(
                "write failed: " + path.string()
            );
        }

        return Status::success();
    }

    bool exists(const fs::path& path) noexcept
    {
        std::error_code ec;
        return fs::exists(path, ec);
    }

    Status ensureDirectory(const fs::path& dir)
    {
        if (dir.empty()) {
            return Status::success();
        }

        std::error_code ec;

        if (fs::exists(dir, ec)) {
            if (ec) {
                return Status::fail(
                    "cannot check directory " +
                    dir.string() +
                    ": " +
                    ec.message()
                );
            }

            if (!fs::is_directory(dir, ec)) {
                return Status::fail(
                    "path exists but is not a directory: " +
                    dir.string()
                );
            }

            return Status::success();
        }

        fs::create_directories(dir, ec);

        if (ec) {
            return Status::fail(
                "cannot create directory " +
                dir.string() +
                ": " +
                ec.message()
            );
        }

        return Status::success();
    }

    std::string lowerExtension(const fs::path& path)
    {
        std::string ext = path.extension().string();

        std::transform(
            ext.begin(),
            ext.end(),
            ext.begin(),
            [](unsigned char c) {
                return static_cast<char>(std::tolower(c));
            }
        );

        return ext;
    }

} // namespace wf::io