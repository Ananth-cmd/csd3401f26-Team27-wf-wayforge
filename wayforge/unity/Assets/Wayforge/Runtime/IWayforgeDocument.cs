// The interface Studio's UI talks to. StudioWindow, PlanCanvas and
// RoomTagger only ever call methods on this interface, never a concrete
// class directly. Right now DocumentProvider hands out a fake
// implementation (StubWayforgeDocument) since the real one doesn't exist
// yet. Once it does, as long as it implements this same interface,
// swapping it in is a one-line change in DocumentProvider - none of the
// UI files need to change.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
    public interface IWayforgeDocument : IDisposable
    {
        // lifecycle

        bool IsOpen { get; }
        bool IsDirty { get; }

        ///Opens a plan file. Throws if it can't be read.
        void Open(string path);

        /// Turns a floor-plan image (png / jpg / bmp) into a building: walls,
        /// doors and rooms are detected by the core. widthMetres is the real
        /// width of the drawing; 0 means "assume 1 pixel = 2 cm". Throws on failure.
        void ImportImage(string imagePath, float widthMetres);

        /// The file this document came from (.wfb, .svg or an image). Null if none.
        string FilePath { get; }

        /// Saves to the last opened/saved path. Does nothing if nothing changed.
        void Save();

        void SaveAs(string path);

        // levels

        int LevelCount { get; }
        int CurrentLevel { get; set; }
        string BuildingName { get; }
        string LevelName(int levelIndex);

        // reads - these are snapshots, not live references, so the UI
        // re-fetches every time it draws instead of caching anything

        IReadOnlyList<WfWall> Walls(int levelIndex);
        IReadOnlyList<WfOpening> Openings(int levelIndex);
        IReadOnlyList<WfRoom> Rooms(int levelIndex);
        IReadOnlyList<WfNode> Nodes(int levelIndex);
        IReadOnlyList<WfEdge> Edges(int levelIndex);

        /// Display names for the kind dropdown in the room panel.
        IReadOnlyList<string> RoomKinds { get; }

        // edits

        void SetRoomCode(int levelIndex, string roomId, string code, string name);
        void SetRoomKind(int levelIndex, string roomId, RoomKind kind);
        void MoveWall(int levelIndex, string wallId, Vector2 a, Vector2 b);
        void DeleteWall(int levelIndex, string wallId);
        string AddWall(int levelIndex, Vector2 a, Vector2 b, float thickness);

        // property panel - lets RoomTagger draw fields for a wall/room
        // without knowing what those fields are ahead of time

        IReadOnlyList<WfPropertyRow> GetProperties(int levelIndex, ElementKind kind, string elementId);

        /// Returns false if valueText couldn't be parsed for this property's type.
        bool SetProperty(int levelIndex, ElementKind kind, string elementId, string propertyName, string valueText);

        // undo/redo

        bool CanUndo { get; }
        bool CanRedo { get; }
        void Undo();
        void Redo();

        // graph + routing

        void BuildGraph();

        ///Looks up a room's node ref by code or id. Null if not found.
        string NodeForRoom(string codeOrId);

        WfRouteResult Route(string fromNodeRef, string toNodeRef, bool stepFreeOnly);

        IReadOnlyList<WfRoomHit> SearchRooms(string query, int max = 20);

        // plugin status

        bool NativePluginLoaded { get; }
        string NativeVersion { get; }
    }
}