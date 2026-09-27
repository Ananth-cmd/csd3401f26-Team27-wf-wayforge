// Writes a building level as an SVG so you can *look at the pictures*:
// walls (confidence-coloured), openings, rooms, graph nodes/edges, a route.
#pragma once
#include <string>
#include <vector>
#include "wf_doc/wf_doc.hpp"
#include "wf_graph/wf_graph.hpp"

namespace wf::cli {
std::string levelToSvg(const Level& level, const graph::Route* route = nullptr, bool showGraph = true);
}
