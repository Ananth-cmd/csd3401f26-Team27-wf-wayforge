// Gives out the one shared document instance. Everything else should get
// its document from here instead of creating a new StubWayforgeDocument
// (or the real one, once it exists) directly.
//
// To switch to the real document once it's ready: set UseRealDocument to
// true, uncomment the "new WayforgeDocument()" line below, and remove the
// fallback line under it. Nothing else needs to change as long as the
// real class implements IWayforgeDocument the same way this interface does.

using UnityEngine;
using Wayforge.Stub;

namespace Wayforge.Editor
{
    public static class DocumentProvider
    {
        private const bool UseRealDocument = false;

        private static IWayforgeDocument _instance;

        // Domain reloads wipe this static field, so don't cache the
        // result elsewhere - always go through Current.
        public static IWayforgeDocument Current => _instance ??= CreateDocument();

        private static IWayforgeDocument CreateDocument()
        {
            if (UseRealDocument)
            {
                // return new WayforgeDocument();
                Debug.LogError("[DocumentProvider] UseRealDocument is true but the real " +
                                "WayforgeDocument line is still commented out. Falling back " +
                                "to fake data so Studio doesn't crash.");
                return new StubWayforgeDocument();
            }

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