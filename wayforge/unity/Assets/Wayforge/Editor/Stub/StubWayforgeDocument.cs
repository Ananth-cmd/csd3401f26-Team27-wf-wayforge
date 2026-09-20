// StubWayforgeDocument.cs
//
// An in-memory, pure-C# fake that implements IWayforgeDocument. No DLL, no
// P/Invoke, no dependency on RTIS 1 / RTIS 2 / IMGD 1's code existing yet.
//
// PURPOSE: lets you build and test StudioWindow / PlanCanvas / RoomTagger
// TODAY against a small hardcoded building, so you are never blocked
// waiting for the native core. When the real WayforgeDocument.cs lands
// (implementing the same IWayforgeDocument interface), you flip one line
// in DocumentProvider.cs and this file is simply unused -- nothing in your
// three real files changes.
//
// The hardcoded building here is a 10m x 8m box with a divider (mirrors
// the same example building described in Work Breakdown 3.1's wf_read
// "Done when" section: "a hand-built segment list for a 10x8 box with a
// divider and three door gaps yields 3 rooms, 2 doors, 1 corridor" --
// using the same shape means what you see in Studio during development
// will resemble what the real pipeline eventually produces for the same
// input, and it doubles as a sanity check on your own geometry code).
//
// This file is NOT meant to survive into the final submission as anything
// load-bearing -- it is a development harness. Keep it, but once the real
// WayforgeDocument works, Studio should default to that.

using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace Wayforge.Stub
{
    public class StubWayforgeDocument : IWayforgeDocument
    {
        private class Level
        {
            public string id;
            public string name;
            public List<WfWall> walls = new List<WfWall>();
            public List<WfOpening> openings = new List<WfOpening>();
            public List<WfRoom> rooms = new List<WfRoom>();
            public List<WfNode> nodes = new List<WfNode>();
            public List<WfEdge> edges = new List<WfEdge>();
        }

        // Extremely small undo model: snapshot-based, not command-based.
        // This is NOT how the real C++ CommandStack works (Work Breakdown
        // 3.4 -- real undo is Do/Undo pairs with merge coalescing), and
        // that's fine: this class only needs to make the UI *behave* the
        // same from the outside (CanUndo flips, Undo reverts a tag, etc.),
        // not to reimplement the coalescing/merge-window logic RTIS 1/
        // IMGD 1 own. Don't let this snapshot approach leak into your real
        // UI code -- StudioWindow only ever calls doc.Undo()/doc.Redo(),
        // it has no idea how either implementation works underneath.
        private readonly List<List<Level>> _undoStack = new List<List<Level>>();
        private readonly List<List<Level>> _redoStack = new List<List<Level>>();

        private List<Level> _levels = new List<Level>();
        private string _openPath;
        private bool _dirty;

        public bool IsOpen { get; private set; }
        public bool IsDirty => _dirty;
        public int LevelCount => _levels.Count;
        public int CurrentLevel { get; set; }
        public string BuildingName { get; private set; } = "untitled";

        public bool NativePluginLoaded => true; // always reports success -- this fake data has no real plugin to fail
        public string NativeVersion => "fake-0.0 (no native core loaded, this is dummy data)";

        public IReadOnlyList<string> RoomKinds { get; } =
            Enum.GetNames(typeof(RoomKind));

        public string LevelName(int levelIndex) =>
            InRange(levelIndex) ? _levels[levelIndex].name : "?";

        // --- lifecycle -------------------------------------------------

        public void Open(string path)
        {
            // Real Open() dispatches on extension (.wfb loads, .svg
            // converts) per wf_open_plan. This fake version ignores the
            // path content entirely and always builds the same dummy
            // building, which is fine for UI development -- but DON'T let
            // StudioWindow assume the path is meaningless; it must still
            // pass a real path through so the same code path works once
            // this class is swapped for the real one.
            _openPath = path;
            BuildingName = string.IsNullOrEmpty(path)
                ? "untitled"
                : System.IO.Path.GetFileNameWithoutExtension(path);

            _levels = new List<Level> { BuildDummyLevel() };
            CurrentLevel = 0;
            IsOpen = true;
            _dirty = false;
            _undoStack.Clear();
            _redoStack.Clear();
        }

        public void Save()
        {
            if (!_dirty) return;
            SaveAs(_openPath);
        }

        public void SaveAs(string path)
        {
            _openPath = path;
            _dirty = false;
            // Real SaveAs writes building.wfb via wf_save. This fake
            // version has nothing to persist to -- there is no real file
            // backing this dummy data. Log so it's obvious in the console
            // this isn't really hitting disk.
            Debug.Log($"[StubWayforgeDocument] Save does nothing here -- this is fake/dummy data, not a real file. " +
                      $"Would have written: {path}");
        }

        // --- reads -------------------------------------------------------

        public IReadOnlyList<WfWall> Walls(int levelIndex) =>
            InRange(levelIndex) ? _levels[levelIndex].walls : Array.Empty<WfWall>();

        public IReadOnlyList<WfOpening> Openings(int levelIndex) =>
            InRange(levelIndex) ? _levels[levelIndex].openings : Array.Empty<WfOpening>();

        public IReadOnlyList<WfRoom> Rooms(int levelIndex) =>
            InRange(levelIndex) ? _levels[levelIndex].rooms : Array.Empty<WfRoom>();

        public IReadOnlyList<WfNode> Nodes(int levelIndex) =>
            InRange(levelIndex) ? _levels[levelIndex].nodes : Array.Empty<WfNode>();

        public IReadOnlyList<WfEdge> Edges(int levelIndex) =>
            InRange(levelIndex) ? _levels[levelIndex].edges : Array.Empty<WfEdge>();

        // --- edits ---------------------------------------------------------
        // Every edit: PushUndo() BEFORE mutating, so Undo() can restore the
        // pre-edit snapshot. Real implementation: each of these becomes an
        // ICommand.Do() call instead.

        public void SetRoomCode(int levelIndex, string roomId, string code, string name)
        {
            if (!InRange(levelIndex)) return;
            PushUndo();
            var level = _levels[levelIndex];
            int idx = level.rooms.FindIndex(r => r.id == roomId);
            if (idx < 0) return;
            var room = level.rooms[idx];
            room.code = code;
            room.name = name;
            level.rooms[idx] = room;
            _dirty = true;
        }

        public void SetRoomKind(int levelIndex, string roomId, RoomKind kind)
        {
            if (!InRange(levelIndex)) return;
            PushUndo();
            var level = _levels[levelIndex];
            int idx = level.rooms.FindIndex(r => r.id == roomId);
            if (idx < 0) return;
            var room = level.rooms[idx];
            room.kind = kind;
            level.rooms[idx] = room;
            _dirty = true;
        }

        public void MoveWall(int levelIndex, string wallId, Vector2 a, Vector2 b)
        {
            if (!InRange(levelIndex)) return;
            PushUndo();
            var level = _levels[levelIndex];
            int idx = level.walls.FindIndex(w => w.id == wallId);
            if (idx < 0) return;
            var wall = level.walls[idx];
            wall.a = a;
            wall.b = b;
            level.walls[idx] = wall;
            _dirty = true;
        }

        public void DeleteWall(int levelIndex, string wallId)
        {
            if (!InRange(levelIndex)) return;
            PushUndo();
            var level = _levels[levelIndex];
            level.walls.RemoveAll(w => w.id == wallId);
            // Real DeleteWall also removes openings on that wall and
            // remembers them for Undo (Work Breakdown 3.4: "DeleteWall
            // (remembers the wall AND its openings)"). This fake version
            // just mirrors the *visible* behaviour (openings on a deleted
            // wall vanish too) via the snapshot approach, so this still
            // looks right without separately tracking it.
            level.openings.RemoveAll(o => o.wall == wallId);
            _dirty = true;
        }

        public string AddWall(int levelIndex, Vector2 a, Vector2 b, float thickness)
        {
            if (!InRange(levelIndex)) return null;
            PushUndo();
            var level = _levels[levelIndex];
            string id = NextId(level, "w");
            level.walls.Add(new WfWall { id = id, a = a, b = b, thickness = thickness, confidence = 1f });
            _dirty = true;
            return id;
        }

        // --- property system ------------------------------------------
        // A small hand-written table of made-up values, standing in for
        // the real system (Work Breakdown 3.2), which drives this from
        // wf_property_count/wf_property_name against the C++ struct
        // definitions. Here we hand-list Wall's fields -- just enough for
        // RoomTagger's wall inspector to have something real to iterate
        // during development.

        public IReadOnlyList<WfPropertyRow> GetProperties(int levelIndex, ElementKind kind, string elementId)
        {
            if (kind != ElementKind.Wall || !InRange(levelIndex))
                return Array.Empty<WfPropertyRow>();

            var level = _levels[levelIndex];
            var wall = level.walls.FirstOrDefault(w => w.id == elementId);
            if (wall.id == null) return Array.Empty<WfPropertyRow>();

            return new List<WfPropertyRow>
            {
                new WfPropertyRow { name = "id", type = PropertyType.String, valueText = wall.id },
                new WfPropertyRow { name = "thickness", type = PropertyType.Float, valueText = wall.thickness.ToString("F3") },
                new WfPropertyRow { name = "confidence", type = PropertyType.Float, valueText = wall.confidence.ToString("F2") },
            };
        }

        public bool SetProperty(int levelIndex, ElementKind kind, string elementId, string propertyName, string valueText)
        {
            if (kind != ElementKind.Wall || !InRange(levelIndex)) return false;
            var level = _levels[levelIndex];
            int idx = level.walls.FindIndex(w => w.id == elementId);
            if (idx < 0) return false;

            var wall = level.walls[idx];
            switch (propertyName)
            {
                case "thickness":
                    if (!float.TryParse(valueText, out float t)) return false;
                    PushUndo();
                    wall.thickness = t;
                    level.walls[idx] = wall;
                    _dirty = true;
                    return true;
                default:
                    return false; // id/confidence are read-only in this fake version
            }
        }

        // --- undo/redo -----------------------------------------------------

        public bool CanUndo => _undoStack.Count > 0;
        public bool CanRedo => _redoStack.Count > 0;

        public void Undo()
        {
            if (!CanUndo) return;
            _redoStack.Add(DeepCopy(_levels));
            _levels = _undoStack[_undoStack.Count - 1];
            _undoStack.RemoveAt(_undoStack.Count - 1);
            _dirty = true;
        }

        public void Redo()
        {
            if (!CanRedo) return;
            _undoStack.Add(DeepCopy(_levels));
            _levels = _redoStack[_redoStack.Count - 1];
            _redoStack.RemoveAt(_redoStack.Count - 1);
            _dirty = true;
        }

        private void PushUndo()
        {
            _undoStack.Add(DeepCopy(_levels));
            _redoStack.Clear();
        }

        // --- graph + routing ---------------------------------------------

        public void BuildGraph()
        {
            if (!InRange(CurrentLevel)) return;
            var level = _levels[CurrentLevel];
            level.nodes.Clear();
            level.edges.Clear();

            // One node per room at its centroid (Work Breakdown 5.1
            // Build.cpp) -- simplified: no door nodes, no corridor
            // sampling, no line-of-sight test. This is enough for
            // RoomTagger's route preview to have something to route
            // through during UI development; it is NOT a stand-in for
            // IMGD 3's real wf_graph.
            foreach (var room in level.rooms)
            {
                level.nodes.Add(new WfNode
                {
                    id = NextId(level, "n"),
                    pos = room.centroid,
                    kind = room.kind == RoomKind.Corridor ? NodeKind.Corridor : NodeKind.Room,
                    room = room.id
                });
            }

            // Fully connect nodes (straight-line "route" for this fake
            // version only -- no wall-crossing check).
            for (int i = 0; i < level.nodes.Count; i++)
                for (int j = i + 1; j < level.nodes.Count; j++)
                {
                    float cost = Vector2.Distance(level.nodes[i].pos, level.nodes[j].pos);
                    level.edges.Add(new WfEdge { a = level.nodes[i].id, b = level.nodes[j].id, cost = cost, stepFree = true });
                }

            _dirty = true;
        }

        public string NodeForRoom(string codeOrId)
        {
            if (!InRange(CurrentLevel)) return null;
            var level = _levels[CurrentLevel];
            var room = level.rooms.FirstOrDefault(r => r.code == codeOrId || r.id == codeOrId);
            if (room.id == null) return null;
            var node = level.nodes.FirstOrDefault(n => n.room == room.id);
            return node.id == null ? null : $"{level.id}:{node.id}";
        }

        public WfRouteResult Route(string fromNodeRef, string toNodeRef, bool stepFreeOnly)
        {
            if (!InRange(CurrentLevel))
                return new WfRouteResult { success = false, errorMessage = "no level open" };

            var level = _levels[CurrentLevel];
            string fromId = StripLevelPrefix(fromNodeRef);
            string toId = StripLevelPrefix(toNodeRef);

            var fromNode = level.nodes.FirstOrDefault(n => n.id == fromId);
            var toNode = level.nodes.FirstOrDefault(n => n.id == toId);

            if (fromNode.id == null)
                return new WfRouteResult { success = false, errorMessage = $"unknown node ref '{fromNodeRef}' -- build the graph first" };
            if (toNode.id == null)
                return new WfRouteResult { success = false, errorMessage = $"unknown node ref '{toNodeRef}' -- build the graph first" };

            // Fake route = straight line between the two room centroids.
            // Real route = A* over the navigation graph (Work Breakdown
            // 5.1 Route.cpp). Good enough to prove RoomTagger's
            // find-route -> show-step-count-and-cost flow end to end.
            float cost = Vector2.Distance(fromNode.pos, toNode.pos);
            var points = new[]
            {
                new Vector3(fromNode.pos.x, 0f, fromNode.pos.y),
                new Vector3(toNode.pos.x, 0f, toNode.pos.y),
            };

            return new WfRouteResult
            {
                success = true,
                points = points,
                totalCost = cost,
                stepFree = true,
                stepCount = 2
            };
        }

        public IReadOnlyList<WfRoomHit> SearchRooms(string query, int max = 20)
        {
            if (!InRange(CurrentLevel)) return Array.Empty<WfRoomHit>();
            var level = _levels[CurrentLevel];
            query = (query ?? "").ToLowerInvariant();

            return level.rooms
                .Where(r => (r.code ?? "").ToLowerInvariant().Contains(query) ||
                            (r.name ?? "").ToLowerInvariant().Contains(query))
                .Take(max)
                .Select(r => new WfRoomHit
                {
                    levelNodeRef = $"{level.id}:{r.id}",
                    code = r.code,
                    name = r.name,
                    kind = r.kind.ToString()
                })
                .ToList();
        }

        public void Dispose()
        {
            IsOpen = false;
        }

        // --- building the dummy/made-up building --------------------------
        // A 10m x 8m box, one vertical divider at x=6, three door gaps.
        // Matches the shape described in Work Breakdown 3.1 wf_read's
        // "Done when" example. Produces 2 rooms in this simplified, made-up
        // geometry (a real planar-graph implementation over the same
        // segments would also find the corridor sliver -- this fake
        // version skips planar-graph face-finding entirely and just
        // declares rooms directly, since exercising Trace/Planar.cpp is
        // RTIS 1's job, not something the Studio UI's dummy data needs to
        // reimplement).

        private Level BuildDummyLevel()
        {
            var level = new Level { id = "L1", name = "Level 1" };

            level.walls.AddRange(new[]
            {
                new WfWall { id = "w1", a = new Vector2(0, 0),  b = new Vector2(10, 0), thickness = 0.15f, confidence = 0.9f },
                new WfWall { id = "w2", a = new Vector2(10, 0), b = new Vector2(10, 8), thickness = 0.15f, confidence = 0.9f },
                new WfWall { id = "w3", a = new Vector2(10, 8), b = new Vector2(0, 8),  thickness = 0.15f, confidence = 0.9f },
                new WfWall { id = "w4", a = new Vector2(0, 8),  b = new Vector2(0, 0),  thickness = 0.15f, confidence = 0.9f },
                new WfWall { id = "w5", a = new Vector2(6, 0),  b = new Vector2(6, 3),  thickness = 0.15f, confidence = 0.75f },
                new WfWall { id = "w6", a = new Vector2(6, 4),  b = new Vector2(6, 8),  thickness = 0.15f, confidence = 0.4f }, // deliberately low-confidence -> should draw orange/red
            });

            level.openings.Add(new WfOpening { id = "o1", wall = "w5", offset = 2.5f, width = 1f, type = OpeningType.Door, confidence = 0.8f });

            level.rooms.AddRange(new[]
            {
                new WfRoom
                {
                    id = "r1", code = "E2-01-01", name = "Room A1", kind = RoomKind.Classroom,
                    boundary = new List<string> { "w1", "w5", "w6", "w4" },
                    polygon = new List<Vector2> { new Vector2(0,0), new Vector2(6,0), new Vector2(6,8), new Vector2(0,8) },
                    centroid = new Vector2(3, 4), area = 48f, confidence = 0.85f
                },
                new WfRoom
                {
                    id = "r2", code = "", name = "", kind = RoomKind.Unknown, // deliberately UNTAGGED so RoomTagger has something to tag
                    boundary = new List<string> { "w5", "w2", "w3", "w6" },
                    polygon = new List<Vector2> { new Vector2(6,0), new Vector2(10,0), new Vector2(10,8), new Vector2(6,8) },
                    centroid = new Vector2(8, 4), area = 32f, confidence = 0.6f
                },
            });

            return level;
        }

        // --- helpers -------------------------------------------------------

        private bool InRange(int levelIndex) => levelIndex >= 0 && levelIndex < _levels.Count;

        private static string NextId(Level level, string prefix)
        {
            int n = 1;
            var existing = new HashSet<string>();
            existing.UnionWith(level.walls.Select(w => w.id));
            existing.UnionWith(level.nodes.Select(x => x.id));
            while (existing.Contains($"{prefix}{n}")) n++;
            return $"{prefix}{n}";
        }

        private static string StripLevelPrefix(string nodeRef)
        {
            if (string.IsNullOrEmpty(nodeRef)) return nodeRef;
            int i = nodeRef.IndexOf(':');
            return i < 0 ? nodeRef : nodeRef.Substring(i + 1);
        }

        private static List<Level> DeepCopy(List<Level> levels)
        {
            // Cheap deep copy via struct value semantics + new list
            // allocations. Fine at this small, made-up scale (a handful of
            // elements); this is fake/dummy-data code, so it is explicitly
            // not held to the performance bar the real undo system is
            // (Command.hpp exists specifically to avoid this kind of
            // full-state copy).
            var copy = new List<Level>();
            foreach (var lv in levels)
            {
                copy.Add(new Level
                {
                    id = lv.id,
                    name = lv.name,
                    walls = new List<WfWall>(lv.walls),
                    openings = new List<WfOpening>(lv.openings),
                    rooms = new List<WfRoom>(lv.rooms),
                    nodes = new List<WfNode>(lv.nodes),
                    edges = new List<WfEdge>(lv.edges),
                });
            }
            return copy;
        }
    }
}
