// NativeBridge.cs - the ONLY file that talks to the C++ core (P/Invoke into wayforge.dll / libwayforge.so).
// Owned by RTIS 2. Shared by the Editor tool and the Android app. Nothing else in C# may call DllImport.
//
// Every declaration below mirrors one function in core/Engine/wf_api/wf_api.h, in the same order.
// If a signature changes there it must change here too, or Unity crashes on the call.
// Rules: primitives and arrays only across the boundary; every native call returns int status
// (0 ok, <0 failed -> read LastError()). Caller allocates buffers: count first, then fill.
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Wayforge
{
    public static class NativeBridge
    {
        // Windows: Plugins/x86_64/wayforge.dll   Android: Plugins/Android/libs/arm64-v8a/libwayforge.so
        const string Lib = "wayforge";

        // --- lifecycle --------------------------------------------------------------------
        [DllImport(Lib)] public static extern int wf_ping();
        [DllImport(Lib)] static extern IntPtr wf_version();
        [DllImport(Lib)] static extern IntPtr wf_platform();
        [DllImport(Lib)] static extern IntPtr wf_last_error();
        [DllImport(Lib)] public static extern IntPtr wf_open_plan(string path);
        [DllImport(Lib)] public static extern IntPtr wf_convert_svg(string path, float metresPerUnit);
        [DllImport(Lib)] public static extern IntPtr wf_new_doc(string name);
        [DllImport(Lib)] public static extern void   wf_close(IntPtr doc);
        [DllImport(Lib)] public static extern int    wf_save(IntPtr doc, string path);
        [DllImport(Lib)] public static extern int    wf_is_dirty(IntPtr doc);

        // --- levels ------------------------------------------------------------------------
        [DllImport(Lib)] public static extern int wf_level_count(IntPtr doc);
        [DllImport(Lib)] public static extern int wf_get_level_id(IntPtr doc, int level, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_add_level(IntPtr doc, string id, string name, float elevation);

        // --- walls: 5 floats each (ax ay bx by thickness) ------------------------------------
        [DllImport(Lib)] public static extern int wf_wall_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_walls(IntPtr doc, int level, float[] outBuf, int maxFloats);
        [DllImport(Lib)] public static extern int wf_get_wall_confidence(IntPtr doc, int level, float[] outBuf, int maxFloats);
        [DllImport(Lib)] public static extern int wf_get_wall_id(IntPtr doc, int level, int i, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_add_wall(IntPtr doc, int level, float ax, float ay, float bx, float by, float thickness, StringBuilder idOut, int idCap);
        [DllImport(Lib)] public static extern int wf_move_wall(IntPtr doc, int level, string wallId, float ax, float ay, float bx, float by);
        [DllImport(Lib)] public static extern int wf_delete_wall(IntPtr doc, int level, string wallId);

        // --- openings: 4 floats each (x y width type) ------------------------------------------
        [DllImport(Lib)] public static extern int wf_opening_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_openings(IntPtr doc, int level, float[] outBuf, int maxFloats);

        // --- rooms ----------------------------------------------------------------------------
        [DllImport(Lib)] public static extern int wf_room_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_room(IntPtr doc, int level, int i, StringBuilder codeOut, int codeCap, float[] centroidOut, out float confidence);
        [DllImport(Lib)] public static extern int wf_get_room_id(IntPtr doc, int level, int i, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_get_room_kind(IntPtr doc, int level, int i);
        [DllImport(Lib)] public static extern int wf_get_room_polygon(IntPtr doc, int level, int i, float[] outBuf, int maxFloats);
        [DllImport(Lib)] public static extern int wf_set_room_code(IntPtr doc, int level, int i, string code, string name);
        [DllImport(Lib)] public static extern int wf_set_room_kind(IntPtr doc, int level, int i, string kindName);

        // --- generic properties (reflection-driven inspector) -----------------------------------
        [DllImport(Lib)] public static extern int wf_property_count(int elementKind);
        [DllImport(Lib)] public static extern int wf_property_name(int elementKind, int i, StringBuilder nameOut, int cap, StringBuilder typeOut, int typeCap);
        [DllImport(Lib)] public static extern int wf_get_property(IntPtr doc, int level, int elementKind, string elementId, string prop, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_set_property(IntPtr doc, int level, int elementKind, string elementId, string prop, string value);

        // --- undo ------------------------------------------------------------------------------
        [DllImport(Lib)] public static extern int wf_undo(IntPtr doc);
        [DllImport(Lib)] public static extern int wf_redo(IntPtr doc);
        [DllImport(Lib)] public static extern int wf_can_undo(IntPtr doc);
        [DllImport(Lib)] public static extern int wf_can_redo(IntPtr doc);

        // --- graph / routing ---------------------------------------------------------------------
        [DllImport(Lib)] public static extern int wf_build_graph(IntPtr doc);
        [DllImport(Lib)] public static extern int wf_node_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_nodes(IntPtr doc, int level, float[] outBuf, int maxFloats);
        [DllImport(Lib)] public static extern int wf_edge_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_edges(IntPtr doc, int level, int[] outBuf, int maxInts);
        [DllImport(Lib)] public static extern int wf_add_link(IntPtr doc, string fromRef, string toRef, string kind, int stepFree, float cost);
        [DllImport(Lib)] public static extern int wf_route(IntPtr doc, string fromRef, string toRef, int stepFreeOnly, float[] outBuf, int maxFloats, out float totalCost);
        [DllImport(Lib)] public static extern int wf_route_to_room(IntPtr doc, string fromRef, string roomCode, int stepFreeOnly, float[] outBuf, int maxFloats, out float totalCost);
        [DllImport(Lib)] public static extern int wf_egress(IntPtr doc, string fromRef, int stepFreeOnly, float[] outBuf, int maxFloats, out float totalCost);
        [DllImport(Lib)] public static extern int wf_node_for_room(IntPtr doc, string roomCodeOrId, StringBuilder refOut, int cap);
        [DllImport(Lib)] public static extern int wf_nearest_node(IntPtr doc, string levelId, float x, float y, StringBuilder refOut, int cap);

        // --- app helpers -----------------------------------------------------------------------------
        [DllImport(Lib)] public static extern int wf_instructions(IntPtr doc, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_search_rooms(IntPtr doc, string query, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_room_info(IntPtr doc, string roomRef, StringBuilder codeOut, int codeCap, StringBuilder nameOut, int nameCap, out int kind, float[] centroidOut);
        [DllImport(Lib)] public static extern int wf_pois(IntPtr doc, int level, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_add_poi(IntPtr doc, int level, string kind, string label, float x, float y);
        [DllImport(Lib)] public static extern int wf_level_info(IntPtr doc, int level, StringBuilder nameOut, int nameCap, out float elevation, out float height);
        [DllImport(Lib)] public static extern int wf_building_name(IntPtr doc, StringBuilder outBuf, int cap);

        // --- friendly wrappers ---------------------------------------------------------------------
        public static string Version()   => Marshal.PtrToStringAnsi(wf_version());
        public static string Platform()  => Marshal.PtrToStringAnsi(wf_platform());
        public static string LastError() => Marshal.PtrToStringAnsi(wf_last_error());

        // True when wayforge.dll is present, loads, and answers the week-1 ping.
        // EntryPointNotFound = an old dll without wf_ping; BadImageFormat = a 32-bit dll.
        public static bool PluginLoads()
        {
            try { return wf_ping() == 42; }
            catch (DllNotFoundException) { return false; }
            catch (EntryPointNotFoundException) { return false; }
            catch (BadImageFormatException) { return false; }
        }
    }
}
