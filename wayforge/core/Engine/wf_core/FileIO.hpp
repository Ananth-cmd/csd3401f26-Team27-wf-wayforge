#pragma once
#include <filesystem>
#include <string>
#include <vector>
#include <cstdint>
#include "Result.hpp"

namespace wf::io {

	namespace fs = std::filesystem;

	Result<std::string>          readText(const fs::path& path);
	Result<std::vector<uint8_t>> readBytes(const fs::path& path);
	Status                       writeText(const fs::path& path, std::string_view text);
	Status                       writeBytes(const fs::path& path, const std::vector<uint8_t>& bytes);
	bool                         exists(const fs::path& path) noexcept;
	Status                       ensureDirectory(const fs::path& dir);
	std::string                  lowerExtension(const fs::path& path);   // ".SVG" -> ".svg"

} // namespace wf::io
