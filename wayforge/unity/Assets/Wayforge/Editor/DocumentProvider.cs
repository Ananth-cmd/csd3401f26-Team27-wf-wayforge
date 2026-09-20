// DocumentProvider.cs
//
// THE ONE-LINE SWAP POINT.
//
// Every other file (StudioWindow, PlanCanvas, RoomTagger) asks THIS class
// for an IWayforgeDocument. Nothing else in Editor/ is allowed to `new`
// StubWayforgeDocument or the real WayforgeDocument directly -- if you
// find yourself typing `new StubWayforgeDocument()` anywhere outside
// this file, stop, that's the coupling this file exists to prevent.
//
// TODAY: UseRealDocument = false, because RTIS 2 hasn't shipped
// WayforgeDocument.cs yet (confirmed: the repo is empty as of this
// writing). Everything runs against fake, made-up data (a small
// hardcoded building) so Studio has something to draw.
//
// THE DAY RTIS 2's REAL CODE LANDS:
//   1. Pull their WayforgeDocument.cs (+ NativeBridge.cs, + wayforge.dll)
//      into this project.
//   2. Confirm WayforgeDocument : IWayforgeDocument (if they didn't code
//      against this interface, you may need to add ": IWayforgeDocument"
//      to their class, or write a 10-line adapter -- either is a small job
//      BECAUSE the interface was agreed up front).
//   3. Flip UseRealDocument to true below.
//   4. Uncomment the `new WayforgeDocument()` line and delete/comment the
//      fake-data line below it.
//   5. Run Studio. If it draws the same way it did against the fake data,
//      minus now being backed by real geometry, you're done -- StudioWindow,
//      PlanCanvas and RoomTagger needed ZERO changes.
//
// If step 5 does NOT work cleanly, the bug is almost certainly a mismatch
// between IWayforgeDocument's method signatures and what RTIS 2 actually
// built (e.g. they made Rooms() take no argument because they only ever
// support one level at a time, or Route() returns something structured
// differently). That's a quick sync conversation, not a rewrite -- bring
// both files (this interface + their class) to that conversation.

using UnityEngine;
using Wayforge.Stub;

namespace Wayforge.Editor
{
    public static class DocumentProvider
    {
        // Flip this to true once RTIS 2's real WayforgeDocument is wired in.
        private const bool UseRealDocument = false;

        private static IWayforgeDocument _instance;

        /// <summary>
        /// The single shared document instance for the currently open
        /// Studio window. Callers should NOT cache this themselves across
        /// domain reloads (Unity recompiles wipe static state) -- always
        /// go through Current, and StudioWindow is responsible for
        /// re-acquiring it in OnEnable.
        /// </summary>
        public static IWayforgeDocument Current => _instance ??= CreateDocument();

        private static IWayforgeDocument CreateDocument()
        {
            if (UseRealDocument)
            {
                // --- swap step 4: uncomment once WayforgeDocument.cs exists ---
                // return new WayforgeDocument();
                Debug.LogError("[DocumentProvider] UseRealDocument is true but the " +
                                "real WayforgeDocument constructor is still commented " +
                                "out below -- falling back to fake/dummy data so Studio " +
                                "doesn't crash on open. Fix DocumentProvider.cs.");
                return new StubWayforgeDocument();
            }

            return new StubWayforgeDocument();
        }

        /// <summary>
        /// Disposes the current document and drops the reference, so the
        /// next access creates a fresh one. StudioWindow.OnDisable calls
        /// this -- native documents (the real implementation) hold C++
        /// memory that MUST be released deterministically, not left to
        /// the GC.
        /// </summary>
        public static void Reset()
        {
            _instance?.Dispose();
            _instance = null;
        }
    }
}