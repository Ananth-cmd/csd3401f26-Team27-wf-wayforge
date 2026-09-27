#pragma once
#include <string>
#include <string_view>
#include <vector>
#include <filesystem>
#include <nlohmann/json.hpp>
#include "Types.hpp"

namespace wf 
{

	using json = nlohmann::json;

	json              buildingToJson(const Building& b);
	Result<Building>  buildingFromJson(const json& j, std::string_view fileName = {});
	Result<Building>  buildingFromJsonText(std::string_view jsonText, std::string_view fileName = {});

	Status            saveBuilding(const Building& b, const std::filesystem::path& path, int indent = 2);
	Result<Building>  loadBuilding(const std::filesystem::path& path);

	std::vector<std::string> compareBuildings(const Building& a, const Building& b, float tolerance = 1e-3f);

} // namespace wf