// wf_doc - public header.
// The document model (walls, openings, rooms, graph), the property system,
// the undo/redo command stack and JSON save/load of the .wfb file.
// Rule 2: the building file is the single source of truth; meshes are derived.
#pragma once
#include "Types.hpp"
#include "Property.hpp"
#include "Command.hpp"
#include "Document.hpp"
#include "Serialize.hpp"
