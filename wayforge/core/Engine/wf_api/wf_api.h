/* wf_api - the flat C interface used by Unity (P/Invoke) and any other host.
 *
 *   - only primitives and pointers cross the boundary; no std::string, no std::vector
 *   - no exception may escape: every function body is wrapped in try/catch
 *   - every function returns an int status: 0 = success, <0 = failure, and
 *     wf_last_error() explains; count/getter functions return the count or -1
 *   - the caller allocates buffers: call wf_wall_count, allocate, then wf_get_walls
 *
 * Built as the shared library "wayforge": wayforge.dll on Windows, libwayforge.so
 * on Linux/Android, libwayforge.dylib on macOS. Same source for all three.
 */
#ifndef WAYFORGE_API_H
#define WAYFORGE_API_H

#if defined(_WIN32)
#if defined(WF_API_BUILDING)
#define WF_API_EXPORT __declspec(dllexport)
#else
#define WF_API_EXPORT __declspec(dllimport)
#endif
#else
#define WF_API_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
#define WF_API extern "C" WF_API_EXPORT
#else
#define WF_API WF_API_EXPORT
#endif

#ifdef __cplusplus
extern "C" {
#endif

    typedef struct wf_doc_t* wf_doc;

    /* --- lifecycle ------------------------------------------------------------ */
    WF_API int         wf_ping(void);                        /* returns 42: the week-1 "the plugin loads" test */
    WF_API const char* wf_version(void);                     /* "0.1.0" */
    WF_API const char* wf_platform(void);                    /* "Windows" / "Linux" / "Android" / "macOS" */
    WF_API const char* wf_last_error(void);                  /* message from the last failed call, thread-local */

    WF_API wf_doc      wf_open_plan(const char* path);       /* .wfb loads; .svg converts (metresPerUnit=1); png/jpg/bmp convert (1px = 2cm) */
    WF_API wf_doc      wf_convert_svg(const char* path, float metresPerUnit);
    WF_API wf_doc      wf_convert_image(const char* path, float widthMetres);  /* png/jpg/bmp; widthMetres = real width of the drawing, <=0 -> 1px = 2cm */
    WF_API wf_doc      wf_new_doc(const char* buildingName);
    WF_API void        wf_close(wf_doc d);
    WF_API int         wf_save(wf_doc d, const char* path);
    WF_API int         wf_is_dirty(wf_doc d);

    /* --- levels ------------------------------------------------------------------ */
    WF_API int         wf_level_count(wf_doc d);
    WF_API int         wf_get_level_id(wf_doc d, int level, char* out, int cap);
    WF_API int         wf_add_level(wf_doc d, const char* id, const char* name, float elevation);

    /* --- walls: 5 floats each: ax ay bx by thickness --------------------------- */
    WF_API int         wf_wall_count(wf_doc d, int level);
    WF_API int         wf_get_walls(wf_doc d, int level, float* out, int maxFloats);            /* returns floats written */
    WF_API int         wf_get_wall_confidence(wf_doc d, int level, float* out, int maxFloats);  /* one per wall */
    WF_API int         wf_get_wall_id(wf_doc d, int level, int i, char* out, int cap);
    WF_API int         wf_add_wall(wf_doc d, int level, float ax, float ay, float bx, float by, float thickness, char* idOut, int idCap);
    WF_API int         wf_move_wall(wf_doc d, int level, const char* wallId, float ax, float ay, float bx, float by);
    WF_API int         wf_delete_wall(wf_doc d, int level, const char* wallId);

    /* --- openings: 4 floats each: x y width type(0 door,1 window,2 opening) ---- */
    WF_API int         wf_opening_count(wf_doc d, int level);
    WF_API int         wf_get_openings(wf_doc d, int level, float* out, int maxFloats);

    /* --- rooms ---------------------------------------------------------------------- */
    WF_API int         wf_room_count(wf_doc d, int level);
    WF_API int         wf_get_room(wf_doc d, int level, int i, char* codeOut, int codeCap, float* centroidOut /*2*/, float* confidenceOut);
    WF_API int         wf_get_room_id(wf_doc d, int level, int i, char* out, int cap);
    WF_API int         wf_get_room_kind(wf_doc d, int level, int i);                                /* RoomKind enum index */
    WF_API int         wf_get_room_polygon(wf_doc d, int level, int i, float* out, int maxFloats);  /* x y pairs, returns floats written */
    WF_API int         wf_set_room_code(wf_doc d, int level, int i, const char* code, const char* name);
    WF_API int         wf_set_room_kind(wf_doc d, int level, int i, const char* kindName);          /* "classroom", "stair", "exit"... */

    /* --- generic property access (any reflected element) --------------------- */
    /* elementKind: 0 wall, 1 opening, 2 room, 3 node, 4 poi, 5 anchor, 6 level. Values are text. */
    WF_API int         wf_property_count(int elementKind);
    WF_API int         wf_property_name(int elementKind, int i, char* nameOut, int cap, char* typeOut, int typeCap);
    WF_API int         wf_get_property(wf_doc d, int level, int elementKind, const char* elementId, const char* prop, char* out, int cap);
    WF_API int         wf_set_property(wf_doc d, int level, int elementKind, const char* elementId, const char* prop, const char* value);

    /* --- undo ------------------------------------------------------------------------ */
    WF_API int         wf_undo(wf_doc d);
    WF_API int         wf_redo(wf_doc d);
    WF_API int         wf_can_undo(wf_doc d);
    WF_API int         wf_can_redo(wf_doc d);

    /* --- graph and routing --------------------------------------------------------- */
    WF_API int         wf_build_graph(wf_doc d);
    WF_API int         wf_node_count(wf_doc d, int level);
    WF_API int         wf_get_nodes(wf_doc d, int level, float* out, int maxFloats);   /* 3 floats: x y kind */
    WF_API int         wf_edge_count(wf_doc d, int level);
    WF_API int         wf_get_edges(wf_doc d, int level, int* out, int maxInts);       /* 3 ints: nodeIndexA nodeIndexB stepFree */
    WF_API int         wf_add_link(wf_doc d, const char* fromRef, const char* toRef, const char* kind, int stepFree, float cost);

    /* Route between two node refs ("L1:n3"). Writes up to maxFloats as x y elevation triples. Returns floats written. */
    WF_API int         wf_route(wf_doc d, const char* fromRef, const char* toRef, int stepFreeOnly, float* out, int maxFloats, float* totalCostOut);
    WF_API int         wf_route_to_room(wf_doc d, const char* fromRef, const char* roomCode, int stepFreeOnly, float* out, int maxFloats, float* totalCostOut);
    WF_API int         wf_egress(wf_doc d, const char* fromRef, int stepFreeOnly, float* out, int maxFloats, float* totalCostOut);
    WF_API int         wf_node_for_room(wf_doc d, const char* roomCodeOrId, char* refOut, int cap);
    WF_API int         wf_nearest_node(wf_doc d, const char* levelId, float x, float y, char* refOut, int cap);

    /* app helpers */
    /* Turn-by-turn text for the last route computed by wf_route/wf_route_to_room/wf_egress on this doc. Writes instructions separated by '\n' into out. Returns the number of instructions. */
    WF_API int         wf_instructions(wf_doc d, char* out, int cap);

    /* Rooms whose code or name contains query (empty = all). Writes "L1:r3|CODE|NAME|kind\n" lines. Returns count. */
    WF_API int         wf_search_rooms(wf_doc d, const char* query, char* out, int cap);

    /* Room lookup by "L1:r3" ref -> code/name/kind/centroid. */
    WF_API int         wf_room_info(wf_doc d, const char* roomRef, char* codeOut, int codeCap, char* nameOut, int nameCap, int* kindOut, float* centroidOut /*2*/);

    /* POIs on a level: writes "id|kind|label|x|y\n" lines. Returns count. */
    WF_API int         wf_pois(wf_doc d, int level, char* out, int cap);
    WF_API int         wf_add_poi(wf_doc d, int level, const char* kind, const char* label, float x, float y);

    /* Level metadata. */
    WF_API int         wf_level_info(wf_doc d, int level, char* nameOut, int nameCap, float* elevationOut, float* heightOut);
    WF_API int         wf_building_name(wf_doc d, char* out, int cap);

#ifdef __cplusplus
}
#endif
#endif /* WAYFORGE_API_H */
