/*!
\file wf_api.h

\brief Flat C interface used by Unity and other Wayforge host applications
Defines the public C API exposed by the Wayforge shared library. The interface
is designed to work across language and library boundaries, including Unity
through P/Invoke, so only primitive values, pointers, buffers, and opaque
document handles are passed across the boundary.

The API provides access to document loading and saving, floor plan conversion,
levels, walls, openings, rooms, reflected properties, undo and redo, routing,
navigation graphs, room search, points of interest, and building metadata.

No C++ exceptions or STL types are allowed to cross this boundary. Functions
report failures using integer return codes, while wf_last_error() provides
additional information about the most recent failed call. Where arrays or
strings are returned, the caller supplies the destination buffer and its
capacity.

The same interface is compiled into the Wayforge shared library on all
supported platforms: wayforge.dll on Windows, libwayforge.so on Linux and
Android, and libwayforge.dylib on macOS.


Links: Used by the Unity NativeBridge through P/Invoke and by other host
applications that need to access Wayforge functionality without depending
directly on the internal C++ implementation.



\author Kervin Ong Guan Cheng (Kervinguancheng.ong@digipen.edu)



Contribution: Kervin Ong Guan Cheng 100%
Public C API declarations and shared-library export macros
Document lifecycle, loading, conversion, and saving functions
Level, wall, opening, and room access and editing functions
Generic property access and undo/redo interface
Navigation graph, routing, and instruction functions
Room search, POI, and building metadata helpers



AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.


\date 2026-10-02

\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
*/
#ifndef WAYFORGE_API_H
#define WAYFORGE_API_H

// Export the functions from the DLL on Windows.
// Other platforms use the default visibility setting.
#if defined(_WIN32)
#if defined(WF_API_BUILDING)
#define WF_API_EXPORT __declspec(dllexport)
#else
#define WF_API_EXPORT __declspec(dllimport)
#endif
#else
#define WF_API_EXPORT __attribute__((visibility("default")))
#endif

// Use C linkage so Unity can call these functions through P/Invoke.
#ifdef __cplusplus
#define WF_API extern "C" WF_API_EXPORT
#else
#define WF_API WF_API_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

    // Handle used to access a Wayforge document without exposing the C++ class.
    typedef struct wf_doc_t* wf_doc;

    /* lifecycle */

    // Simple test to check that the plugin loaded correctly.
    WF_API int         wf_ping(void);                        /* returns 42 */

    // Get the current Wayforge version.
    WF_API const char* wf_version(void);                     /* "0.1.0" */

    // Get the platform Wayforge is running on.
    WF_API const char* wf_platform(void);                    /* Windows / Linux / Android / macOS */

    // Get the error message from the last failed API call.
    WF_API const char* wf_last_error(void);

    // Open an existing Wayforge or SVG floor plan.
    WF_API wf_doc      wf_open_plan(const char* path);

    // Convert an SVG floor plan into a Wayforge document.
    WF_API wf_doc      wf_convert_svg(const char* path, float metresPerUnit);

    // Convert a floor plan image into walls, doors and rooms.
    WF_API wf_doc      wf_convert_image(const char* path, float widthMetres);

    // Create a new empty document.
    WF_API wf_doc      wf_new_doc(const char* buildingName);

    // Close the document and free its memory.
    WF_API void        wf_close(wf_doc d);

    // Save the document to a file.
    WF_API int         wf_save(wf_doc d, const char* path);

    // Check whether the document has unsaved changes.
    WF_API int         wf_is_dirty(wf_doc d);

    /* levels */

    // Get the number of levels in the building.
    WF_API int         wf_level_count(wf_doc d);

    // Get the ID of a level.
    WF_API int         wf_get_level_id(wf_doc d, int level, char* out, int cap);

    // Add a new level to the building.
    WF_API int         wf_add_level(wf_doc d, const char* id, const char* name, float elevation);

    /* walls */

    // Get the number of walls on a level.
    WF_API int         wf_wall_count(wf_doc d, int level);

    // Get wall data as ax, ay, bx, by and thickness.
    WF_API int         wf_get_walls(wf_doc d, int level, float* out, int maxFloats);

    // Get the confidence value for each detected wall.
    WF_API int         wf_get_wall_confidence(wf_doc d, int level, float* out, int maxFloats);

    // Get the ID of a wall.
    WF_API int         wf_get_wall_id(wf_doc d, int level, int i, char* out, int cap);

    // Add a new wall.
    WF_API int         wf_add_wall(wf_doc d, int level, float ax, float ay, float bx, float by, float thickness, char* idOut, int idCap);

    // Move an existing wall.
    WF_API int         wf_move_wall(wf_doc d, int level, const char* wallId, float ax, float ay, float bx, float by);

    // Delete a wall.
    WF_API int         wf_delete_wall(wf_doc d, int level, const char* wallId);

    /* openings */

    // Get the number of openings on a level.
    WF_API int         wf_opening_count(wf_doc d, int level);

    // Get opening data as x, y, width and type.
    // Type: 0 = door, 1 = window, 2 = opening.
    WF_API int         wf_get_openings(wf_doc d, int level, float* out, int maxFloats);

    /* rooms */

    // Get the number of rooms on a level.
    WF_API int         wf_room_count(wf_doc d, int level);

    // Get a room's code, centre position and confidence value.
    WF_API int         wf_get_room(wf_doc d, int level, int i, char* codeOut, int codeCap, float* centroidOut /*2*/, float* confidenceOut);

    // Get the ID of a room.
    WF_API int         wf_get_room_id(wf_doc d, int level, int i, char* out, int cap);

    // Get the room type.
    WF_API int         wf_get_room_kind(wf_doc d, int level, int i);

    // Get the points that make up the room shape.
    WF_API int         wf_get_room_polygon(wf_doc d, int level, int i, float* out, int maxFloats);

    // Change the room code and name.
    WF_API int         wf_set_room_code(wf_doc d, int level, int i, const char* code, const char* name);

    // Change the room type, for example classroom or stair.
    WF_API int         wf_set_room_kind(wf_doc d, int level, int i, const char* kindName);

    /* properties */

    // elementKind:
    // 0 = wall, 1 = opening, 2 = room, 3 = node,
    // 4 = POI, 5 = anchor, 6 = level.

    // Get the number of properties available for an element type.
    WF_API int         wf_property_count(int elementKind);

    // Get a property's name and type.
    WF_API int         wf_property_name(int elementKind, int i, char* nameOut, int cap, char* typeOut, int typeCap);

    // Read a property as text.
    WF_API int         wf_get_property(wf_doc d, int level, int elementKind, const char* elementId, const char* prop, char* out, int cap);

    // Set a property using a text value.
    WF_API int         wf_set_property(wf_doc d, int level, int elementKind, const char* elementId, const char* prop, const char* value);

    /* undo / redo */

    // Undo the last change.
    WF_API int         wf_undo(wf_doc d);

    // Redo the last undone change.
    WF_API int         wf_redo(wf_doc d);

    // Check if undo is available.
    WF_API int         wf_can_undo(wf_doc d);

    // Check if redo is available.
    WF_API int         wf_can_redo(wf_doc d);

    /* graph and routing */

    // Build the navigation graph from the floor plan.
    WF_API int         wf_build_graph(wf_doc d);

    // Get the number of navigation nodes on a level.
    WF_API int         wf_node_count(wf_doc d, int level);

    // Get node data as x, y and node type.
    WF_API int         wf_get_nodes(wf_doc d, int level, float* out, int maxFloats);

    // Get the number of graph edges on a level.
    WF_API int         wf_edge_count(wf_doc d, int level);

    // Get edge data as node A, node B and whether it is step-free.
    WF_API int         wf_get_edges(wf_doc d, int level, int* out, int maxInts);

    // Add a connection between two nodes.
    WF_API int         wf_add_link(wf_doc d, const char* fromRef, const char* toRef, const char* kind, int stepFree, float cost);

    // Find a route between two nodes.
    // Route points are returned as x, y and elevation.
    WF_API int         wf_route(wf_doc d, const char* fromRef, const char* toRef, int stepFreeOnly, float* out, int maxFloats, float* totalCostOut);

    // Find a route from a node to a room.
    WF_API int         wf_route_to_room(wf_doc d, const char* fromRef, const char* roomCode, int stepFreeOnly, float* out, int maxFloats, float* totalCostOut);

    // Find a route from a node to an exit.
    WF_API int         wf_egress(wf_doc d, const char* fromRef, int stepFreeOnly, float* out, int maxFloats, float* totalCostOut);

    // Find the navigation node linked to a room.
    WF_API int         wf_node_for_room(wf_doc d, const char* roomCodeOrId, char* refOut, int cap);

    // Find the nearest navigation node to a position.
    WF_API int         wf_nearest_node(wf_doc d, const char* levelId, float x, float y, char* refOut, int cap);

    /* app helpers */

    // Get turn-by-turn instructions from the last route.
    WF_API int         wf_instructions(wf_doc d, char* out, int cap);

    // Search rooms by their code or name.
    WF_API int         wf_search_rooms(wf_doc d, const char* query, char* out, int cap);

    // Get information about a room using its reference.
    WF_API int         wf_room_info(wf_doc d, const char* roomRef, char* codeOut, int codeCap, char* nameOut, int nameCap, int* kindOut, float* centroidOut /*2*/);

    // Get the points of interest on a level.
    WF_API int         wf_pois(wf_doc d, int level, char* out, int cap);

    // Add a new point of interest.
    WF_API int         wf_add_poi(wf_doc d, int level, const char* kind, const char* label, float x, float y);

    // Get the level name, elevation and height.
    WF_API int         wf_level_info(wf_doc d, int level, char* nameOut, int nameCap, float* elevationOut, float* heightOut);

    // Get the building name.
    WF_API int         wf_building_name(wf_doc d, char* out, int cap);

#ifdef __cplusplus
}
#endif

#endif /* WAYFORGE_API_H */
