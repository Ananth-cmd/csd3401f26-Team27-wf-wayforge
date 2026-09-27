// Gives out the one shared document instance. Everything else should get
// its document from here instead of creating a WayforgeDocument or a
// StubWayforgeDocument directly.
//
// If wayforge.dll loads, Studio gets the real WayforgeDocument (C++ core
// through NativeBridge). If it doesn't - the core hasn't been built yet, or
// the dll isn't in Assets/Wayforge/Plugins/x86_64 - it falls back to the
// fake StubWayforgeDocument so the window still opens, and UsingFakeData
// tells the UI to say so.

using UnityEngine;
using Wayforge.Stub;

namespace Wayforge.Editor
{
    public static class DocumentProvider
    {
        private static IWayforgeDocument _instance;

        /// True when the plugin didn't load and Studio is showing the built-in fake house.
        public static bool UsingFakeData { get; private set; }

        // Domain reloads wipe this static field, so don't cache the
        // result elsewhere - always go through Current.
        public static IWayforgeDocument Current => _instance ??= CreateDocument();

        private static IWayforgeDocument CreateDocument()
        {
            if (NativeBridge.PluginLoads())
            {
                UsingFakeData = false;
                return new WayforgeDocument();
            }

            UsingFakeData = true;
            Debug.LogWarning("[DocumentProvider] wayforge.dll did not load, so Studio is using fake data. " +
                             "Build the core (core/script_build_and_run.bat) and restart Unity.");
            return new StubWayforgeDocument();
        }

        // Called when the Studio window closes. The real document holds
        // native memory that needs to be released, not left to the GC.
        public static void Reset()
        {
            _instance?.Dispose();
            _instance = null;
        }
    }
}
