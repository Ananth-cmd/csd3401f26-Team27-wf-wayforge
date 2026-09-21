// IWayforgeDocument.cs
//
// THE SHARED CONTRACT between IMGD 2 (Studio UI) and RTIS 2 (native bridge).
//
// This interface is built directly from:
//   - Work Breakdown section "2.2 NativeBridge.cs and WayforgeDocument.cs"
//   - Work Breakdown section "4. IMGD 2" (what Studio needs to call)
//   - Work Breakdown section "3.5 wf_doc/Document.hpp" (the C++ shape this mirrors)
//
// THE RULE THAT MATTERS: StudioWindow, PlanCanvas and RoomTagger are written
// against IWayforgeDocument ONLY. They never reference a concrete class.
// That means:
//
//   1. Today, before RTIS 2 has written anything, you run Studio against
//      StubWayforgeDocument (Editor/Stub/StubWayforgeDocument.cs) -- an
//      in-memory fake with a small hardcoded building. Everything draws,
//      everything is clickable, tagging/undo/route preview all work.
//
//   2. The day RTIS 2's real WayforgeDocument.cs (wrapping NativeBridge.cs
//      P/Invoke calls into wayforge.dll) is ready and it implements this
//      SAME interface, you change ONE LINE in DocumentProvider.cs and every
//      UI file keeps working unmodified, now against the real C++ core.
//
// If RTIS 2's method signatures end up drifting from this file (different
// parameter order, different return type), that is a five-minute conversation
// to reconcile BEFORE either side writes 300 lines against the wrong shape --
// which is the entire reason this file exists as a separate, tiny, reviewable
// artifact instead of being implicit in StudioWindow.cs.
//
// IMPORTANT: when the real wayforge-setup skeleton repo lands, check
// whether it already defines WayforgeDocument's public API (it likely will,
// since RTIS 2's row in the Order-of-Work table has them writing it from
// week 1). If so, DIFF that against this file first and reconcile any
// mismatches -- the skeleton wins, this file is a placeholder until then.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
    /// <summary>
    /// A property-value pair used when calling SetProperty. Mirrors the C++
    /// PropertyValue variant (Work Breakdown 3.2) collapsed to text, since
    /// wf_set_property takes valueText and parses it by the property's
    /// declared type on the C++ side.
    /// </summary>
    public interface IWayforgeDocument : IDisposable
    {
        // --- lifecycle -------------------------------------------------
        // wf_open_plan / wf_new_doc / wf_close / wf_save / wf_is_dirty

        /// <summary>True if a document is currently open.</summary>
        bool IsOpen { get; }

        /// <summary>True if there are unsaved changes (shown as * in the title bar).</summary>
        bool IsDirty { get; }

        /// <summary>
        /// Opens a .wfb file, or converts a .svg on the fly (wf_open_plan
        /// handles both extensions). Throws IOException with a message
        /// naming the file on failure -- StudioWindow catches this and
        /// shows a dialog rather than letting Unity print a raw exception.
        /// </summary>
        void Open(string path);

        /// <summary>Saves to the path last opened/saved. No-op if !IsDirty.</summary>
        void Save();

        /// <summary>Saves to a new path (Save As).</summary>
        void SaveAs(string path);

        // --- levels ------------------------------------------------------
        // wf_level_count / wf_get_level_id / wf_level_info / wf_building_name

        int LevelCount { get; }

        /// <summary>Index of the level currently being edited/viewed.</summary>
        int CurrentLevel { get; set; }

        string BuildingName { get; }

        /// <summary>Display name for a level index, e.g. "Level 1".</summary>
        string LevelName(int levelIndex);

        // --- reads: these return snapshots, not live references ---------
        // PlanCanvas re-fetches every repaint. That's intentional -- it is
        // what "Studio holds no building data" means in practice. It costs
        // a copy per frame; the copies here are small (a lab building is a
        // few hundred elements) so this is not a real performance concern
        // at M1/M2 scale. RTIS 1 flags perf work for week 11 on the C++
        // side (10.5), not here.

        IReadOnlyList<WfWall> Walls(int levelIndex);
        IReadOnlyList<WfOpening> Openings(int levelIndex);
        IReadOnlyList<WfRoom> Rooms(int levelIndex);
        IReadOnlyList<WfNode> Nodes(int levelIndex);
        IReadOnlyList<WfEdge> Edges(int levelIndex);

        /// <summary>
        /// Display names for RoomKind, in the order RoomTagger's kind
        /// dropdown should show them. Wraps wf_property_name's enum name
        /// table for RoomKind so the dropdown never hardcodes the list.
        /// </summary>
        IReadOnlyList<string> RoomKinds { get; }

        // --- edits: every one of these must be undoable in the C++ core -
        // (Work Breakdown 3.4 Command.hpp). From the UI's point of view
        // they are just method calls; RTIS 2's implementation is what
        // turns each into an ICommand on the C++ CommandStack.

        void SetRoomCode(int levelIndex, string roomId, string code, string name);
        void SetRoomKind(int levelIndex, string roomId, RoomKind kind);
        void MoveWall(int levelIndex, string wallId, Vector2 a, Vector2 b);
        void DeleteWall(int levelIndex, string wallId);
        string AddWall(int levelIndex, Vector2 a, Vector2 b, float thickness);

        // --- generic property system (Work Breakdown 3.2) ---------------
        // This is what lets RoomTagger draw the wall inspector with a loop
        // instead of one field per wall property. wf_property_count(kind)
        // + wf_property_name give the schema; wf_get_property /
        // wf_set_property read/write one value by name.

        /// <summary>
        /// Full property table for one element, as text rows ready to
        /// render. RoomTagger iterates this and draws one control per row
        /// (a DelayedTextField for most types) -- it never special-cases
        /// individual field names.
        /// </summary>
        IReadOnlyList<WfPropertyRow> GetProperties(int levelIndex, ElementKind kind, string elementId);

        /// <summary>
        /// Sets one property by name. valueText is parsed by the C++ side
        /// according to that property's declared type. Returns false (and
        /// leaves the value unchanged) if the text doesn't parse -- this
        /// mirrors wf_set_property's return contract, so the UI can show
        /// "invalid value" without needing to know why.
        /// </summary>
        bool SetProperty(int levelIndex, ElementKind kind, string elementId, string propertyName, string valueText);

        // --- undo/redo ---------------------------------------------------

        bool CanUndo { get; }
        bool CanRedo { get; }
        void Undo();
        void Redo();

        // --- graph + routing ----------------------------------------------

        /// <summary>Rebuilds the navigation graph for every level (wf_build_graph).</summary>
        void BuildGraph();

        /// <summary>
        /// Resolves a room code or id to its node ref ("L1:n3"), or null if
        /// not found / graph not built. Used by RoomTagger's route preview
        /// before calling Route.
        /// </summary>
        string NodeForRoom(string codeOrId);

        /// <summary>
        /// Finds a route between two node refs (as returned by
        /// NodeForRoom). success=false + errorMessage on failure (unknown
        /// ref, no path) -- RoomTagger shows errorMessage in a dialog
        /// rather than a raw exception, per the PDD's error-handling
        /// philosophy (messages the human can act on).
        /// </summary>
        WfRouteResult Route(string fromNodeRef, string toNodeRef, bool stepFreeOnly);

        // --- search (used later by app NavigationUI, and by RoomTagger's
        // From/To fields if you want autocomplete rather than raw code
        // entry -- optional for M1, but the signature is here so IMGD 2
        // and RTIS 2 agree on it now rather than inventing it in week 11) -

        IReadOnlyList<WfRoomHit> SearchRooms(string query, int max = 20);

        // --- plugin health -------------------------------------------------
        // Not part of wf_doc/Document.hpp itself, but StudioWindow needs
        // this before it dares call Open(). Wraps NativeBridge.PluginLoads().

        bool NativePluginLoaded { get; }

        /// <summary>Version string from the native core, or null if the plugin didn't load.</summary>
        string NativeVersion { get; }
    }
}
