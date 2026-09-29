using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Wayforge
{
    // Connects Unity to the C++ core (wayforge.dll). This is the only file that calls into the dll.
    // Each function here matches one in core/Engine/wf_api/wf_api.h.
    public static class NativeBridge
    {
        const string Lib = "wayforge";   // wayforge.dll in Plugins/x86_64

        // Basic checks
        [DllImport(Lib)] public static extern int wf_ping();
        [DllImport(Lib)] static extern IntPtr wf_version();
        [DllImport(Lib)] static extern IntPtr wf_platform();
        [DllImport(Lib)] static extern IntPtr wf_last_error();

        // Open and close a .wfb file
        [DllImport(Lib)] public static extern IntPtr wf_open_plan(string path);
        [DllImport(Lib)] public static extern void   wf_close(IntPtr doc);

        // Turn a floor plan picture into walls, doors and rooms (Ananth's image code + Shrinivasan's wf_read)
        [DllImport(Lib)] public static extern IntPtr wf_convert_image(string path, float widthMetres);

        // Walls: 5 numbers each (start x, start y, end x, end y, thickness)
        [DllImport(Lib)] public static extern int wf_wall_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_walls(IntPtr doc, int level, float[] outBuf, int maxFloats);

        // Doors: 4 numbers each (x, y, width, type)
        [DllImport(Lib)] public static extern int wf_opening_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_openings(IntPtr doc, int level, float[] outBuf, int maxFloats);

        // Rooms
        [DllImport(Lib)] public static extern int wf_room_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_room(IntPtr doc, int level, int i, StringBuilder codeOut, int codeCap, float[] centroidOut, out float confidence);
        [DllImport(Lib)] public static extern int wf_get_room_id(IntPtr doc, int level, int i, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_get_room_polygon(IntPtr doc, int level, int i, float[] outBuf, int maxFloats);
        [DllImport(Lib)] public static extern int wf_get_room_kind(IntPtr doc, int level, int i);   // index into RoomData.Kinds

        // Any property as text. elementKind: 0 wall, 1 opening, 2 room, 3 node, 4 poi, 5 anchor, 6 level
        [DllImport(Lib)] public static extern int wf_get_property(IntPtr doc, int level, int elementKind, string elementId, string prop, StringBuilder outBuf, int cap);

        public static string Version()   => Marshal.PtrToStringAnsi(wf_version());
        public static string Platform()  => Marshal.PtrToStringAnsi(wf_platform());
        public static string LastError() => Marshal.PtrToStringAnsi(wf_last_error());

        // True if the dll is found and answers
        public static bool PluginLoads()
        {
            try { return wf_ping() == 42; }
            catch (DllNotFoundException) { return false; }
            catch (EntryPointNotFoundException) { return false; }
        }
    }
}
