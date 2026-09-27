#pragma once
// .wfb file: JSON on disk. Property-driven, so adding a field to a struct's WF_PROPERTIES
// updates save, load and compare automatically. Vector fields (polygon, boundary) are handled by hand.

#include "wf_doc/Types.hpp"
#include <filesystem>
#include <nlohmann/json.hpp>
#include <string>
#include <string_view>
#include <vector>

namespace wf {

    // ordered_json keeps insertion order, so keys are written in a fixed order:
    // version, building, source, levels, links. 
    using json = nlohmann::ordered_json;

    json buildingToJson(const Building&);


    Result<Building> buildingFromJson(const json&, std::string_view fileNameForErrors);

    std::vector<std::string> compareBuildings(const Building&, const Building&);

    Status saveBuilding(const Building&, const std::filesystem::path&);
    Result<Building> loadBuilding(const std::filesystem::path&);

    constexpr int kWfbVersion = 1;

} // namespace wf