// NativeBridge.cs - the ONLY file that talks to the C++ core (P/Invoke). Nothing else uses DllImport.
// Owned by RTIS 2 (Kervin). Each line mirrors one function in core/Engine/wf_api/wf_api.h.
// Trimmed to what the M1 Studio prototype uses; add more declarations here as they are needed.
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Wayforge
{
    public static class NativeBridge
    {
        const string Lib = "wayforge";   // Plugins/x86_64/wayforge.dll, Plugins/Android/libs/arm64-v8a/libwayforge.so

        [DllImport(Lib)] public static extern int wf_ping();
        [DllImport(Lib)] static extern IntPtr wf_version();
        [DllImport(Lib)] static extern IntPtr wf_platform();
        [DllImport(Lib)] static extern IntPtr wf_last_error();

        // open / close a building file (.wfb)
        [DllImport(Lib)] public static extern IntPtr wf_open_plan(string path);
        [DllImport(Lib)] public static extern void   wf_close(IntPtr doc);

        // walls: 5 floats each (ax ay bx by thickness)
        [DllImport(Lib)] public static extern int wf_wall_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_walls(IntPtr doc, int level, float[] outBuf, int maxFloats);

        // rooms
        [DllImport(Lib)] public static extern int wf_room_count(IntPtr doc, int level);
        [DllImport(Lib)] public static extern int wf_get_room(IntPtr doc, int level, int i, StringBuilder codeOut, int codeCap, float[] centroidOut, out float confidence);
        [DllImport(Lib)] public static extern int wf_get_room_id(IntPtr doc, int level, int i, StringBuilder outBuf, int cap);
        [DllImport(Lib)] public static extern int wf_get_room_polygon(IntPtr doc, int level, int i, float[] outBuf, int maxFloats);

        public static string Version()   => Marshal.PtrToStringAnsi(wf_version());
        public static string Platform()  => Marshal.PtrToStringAnsi(wf_platform());
        public static string LastError() => Marshal.PtrToStringAnsi(wf_last_error());

        public static bool PluginLoads()
        {
            try { return wf_ping() == 42; }
            catch (DllNotFoundException) { return false; }
            catch (EntryPointNotFoundException) { return false; }
        }
    }
}
