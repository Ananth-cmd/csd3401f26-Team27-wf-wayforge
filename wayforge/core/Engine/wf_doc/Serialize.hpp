/*!
 * \file Serialize.hpp
 * \brief Saving, loading and comparing the .wfb file
 *
 * The functions for turning a Building into JSON and back: to and from a JSON
 * tree, from JSON text, and to and from a file. Loading returns an error that
 * says which file, which element and which field is wrong instead of crashing.
 * Also compareBuildings, which lists the differences between two buildings
 * (used to check that save then load gives the same building).
 *
 * Links: Serialize.cpp has the code; Document.cpp saves and loads through
 * these; wf_cli uses them for convert, info and the other commands.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan 100%
 *   - The save, load and compare functions
 *   - The error message format
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-09-16
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */


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

	json buildingToJson(const Building& b);

	//fileName is only used to start the error message
	Result<Building>  buildingFromJson(const json& j, std::string_view fileName = {});
	Result<Building>  buildingFromJsonText(std::string_view jsonText, std::string_view fileName = {});

	Status saveBuilding(const Building& b, const std::filesystem::path& path, int indent = 2);
	Result<Building>  loadBuilding(const std::filesystem::path& path);

	//numbers within tolerance count as equal
	std::vector<std::string> compareBuildings(const Building& a, const Building& b, float tolerance = 1e-3f);

} // namespace wf