// NativeBridge.cs - the ONLY file that talks to the C++ core (P/Invoke). Nothing else uses DllImport.
using System;
using System.Runtime.InteropServices;

namespace Wayforge
{
    public static class NativeBridge
    {
        const string Lib = "wayforge";   // Plugins/x86_64/wayforge.dll, Plugins/Android/libs/arm64-v8a/libwayforge.so

        [DllImport(Lib)] public static extern int wf_ping();
        [DllImport(Lib)] static extern IntPtr wf_version();
        [DllImport(Lib)] static extern IntPtr wf_platform();

        public static string Version()  => Marshal.PtrToStringAnsi(wf_version());
        public static string Platform() => Marshal.PtrToStringAnsi(wf_platform());

        public static bool PluginLoads()
        {
            try { return wf_ping() == 42; }
            catch (DllNotFoundException) { return false; }
        }
    }
}
