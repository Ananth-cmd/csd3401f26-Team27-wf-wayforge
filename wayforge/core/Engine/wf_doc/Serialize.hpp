// JSON serialization of the model via nlohmann::json, driven by the property
// system: any WF_REGISTER_TYPE struct serialises its reflected fields
// automatically. Containers (walls, rooms, polygons) are handled once here.
#pragma once
#include <string>
#include <string_view>
#include "Types.hpp"

namespace wf {

std::string buildingToJson(const Building& b, int indent = 2);
Result<Building> buildingFromJson(std::string_view json);

// Golden-test helper: semantic comparison with a float tolerance.
// Returns an empty string when equal, otherwise a description of the first difference.
std::string compareBuildings(const Building& a, const Building& b, float tolerance = 1e-3f);

} // namespace wf
