// The real IWayforgeDocument: every read and edit goes to the C++ core through NativeBridge
// (RTIS 2), and the data itself lives in wf_doc (IMGD 1). This class holds no building data of
// its own - it only converts the flat arrays the C API hands back into the Wf* structs the
// Studio UI already uses, so StudioWindow / PlanCanvas / RoomTagger did not have to change.
//
// DocumentProvider hands this out when wayforge.dll loads, and falls back to
// StubWayforgeDocument when it doesn't.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEngine;

namespace Wayforge
{
    public sealed class WayforgeDocument : IWayforgeDocument
    {
        private IntPtr _handle = IntPtr.Zero;
        private string _path;

        private const int IdCap = 64;
        private const int TextCap = 256;

        public bool IsOpen => _handle != IntPtr.Zero;
        public string FilePath => _path;
        public bool IsDirty => IsOpen && NativeBridge.wf_is_dirty(_handle) == 1;

        public int CurrentLevel { get; set; }
        public int LevelCount => IsOpen ? Math.Max(0, NativeBridge.wf_level_count(_handle)) : 0;
        public string BuildingName => IsOpen ? Text((sb, cap) => NativeBridge.wf_building_name(_handle, sb, cap)) : "untitled";

        public IReadOnlyList<string> RoomKinds { get; } = Enum.GetNames(typeof(RoomKind));

        public bool NativePluginLoaded => NativeBridge.PluginLoads();
        public string NativeVersion => NativePluginLoaded ? $"{NativeBridge.Version()} ({NativeBridge.Platform()})" : "not loaded";

        // --- lifecycle ---------------------------------------------------------------------------

        public void Open(string path)
        {
            // .wfb is loaded as-is; .svg is converted at 1 unit = 1 m; images at 1 px = 2 cm.
            IntPtr h = NativeBridge.wf_open_plan(path);
            if (h == IntPtr.Zero)
                throw new IOException($"The core could not open '{Path.GetFileName(path)}': {NativeBridge.LastError()}");

            Close();
            _handle = h;
            _path = path;
            CurrentLevel = 0;
        }

        public void ImportImage(string imagePath, float widthMetres)
        {
            // threshold -> thin -> trace -> clean -> walls/doors/rooms -> graph, all in the C++ core
            IntPtr h = NativeBridge.wf_convert_image(imagePath, widthMetres);
            if (h == IntPtr.Zero)
                throw new IOException($"The core could not read a floor plan from '{Path.GetFileName(imagePath)}': {NativeBridge.LastError()}");

            Close();
            _handle = h;
            _path = imagePath;
            CurrentLevel = 0;
        }

        public void Save()
        {
            if (!IsOpen || !IsDirty) return;
            SaveAs(_path);
        }

        public void SaveAs(string path)
        {
            if (!IsOpen) return;

            // An .svg (or later an image) is only the source; never overwrite it with building data.
            if (!string.Equals(Path.GetExtension(path), ".wfb", StringComparison.OrdinalIgnoreCase))
                path = Path.ChangeExtension(path, ".wfb");

            if (NativeBridge.wf_save(_handle, path) != 0)
                throw new IOException($"Could not save '{path}': {NativeBridge.LastError()}");
            _path = path;
        }

        public void Dispose() => Close();

        private void Close()
        {
            if (_handle == IntPtr.Zero) return;
            NativeBridge.wf_close(_handle);
            _handle = IntPtr.Zero;
        }

        // --- levels ------------------------------------------------------------------------------

        public string LevelName(int levelIndex)
        {
            if (!IsOpen) return "?";
            var name = new StringBuilder(TextCap);
            return NativeBridge.wf_level_info(_handle, levelIndex, name, TextCap, out _, out _) == 0 ? name.ToString() : "?";
        }

        // --- reads (fresh snapshot on every call) --------------------------------------------------

        public IReadOnlyList<WfWall> Walls(int levelIndex)
        {
            int n = Count(NativeBridge.wf_wall_count(_handle, levelIndex));
            var list = new List<WfWall>(n);
            if (n == 0) return list;

            var buf = new float[n * 5];
            var conf = new float[n];
            NativeBridge.wf_get_walls(_handle, levelIndex, buf, buf.Length);
            NativeBridge.wf_get_wall_confidence(_handle, levelIndex, conf, conf.Length);

            for (int i = 0; i < n; i++)
            {
                int k = i;
                list.Add(new WfWall
                {
                    id = Text((sb, cap) => NativeBridge.wf_get_wall_id(_handle, levelIndex, k, sb, cap), IdCap),
                    a = new Vector2(buf[i * 5], buf[i * 5 + 1]),
                    b = new Vector2(buf[i * 5 + 2], buf[i * 5 + 3]),
                    thickness = buf[i * 5 + 4],
                    confidence = conf[i],
                });
            }
            return list;
        }

        public IReadOnlyList<WfOpening> Openings(int levelIndex)
        {
            // The C API gives each opening's world position directly (x y width type),
            // not the wall + offset the stub uses, so `pos` is filled and `wall` left empty.
            int n = Count(NativeBridge.wf_opening_count(_handle, levelIndex));
            var list = new List<WfOpening>(n);
            if (n == 0) return list;

            var buf = new float[n * 4];
            NativeBridge.wf_get_openings(_handle, levelIndex, buf, buf.Length);
            for (int i = 0; i < n; i++)
            {
                list.Add(new WfOpening
                {
                    id = $"o{i}",
                    pos = new Vector2(buf[i * 4], buf[i * 4 + 1]),
                    width = buf[i * 4 + 2],
                    type = (OpeningType)(int)buf[i * 4 + 3],
                    confidence = 1f,
                });
            }
            return list;
        }

        public IReadOnlyList<WfRoom> Rooms(int levelIndex)
        {
            int n = Count(NativeBridge.wf_room_count(_handle, levelIndex));
            var list = new List<WfRoom>(n);
            var poly = new float[4096];
            var centroid = new float[2];

            for (int i = 0; i < n; i++)
            {
                int k = i;
                var code = new StringBuilder(TextCap);
                NativeBridge.wf_get_room(_handle, levelIndex, i, code, TextCap, centroid, out float confidence);
                string id = Text((sb, cap) => NativeBridge.wf_get_room_id(_handle, levelIndex, k, sb, cap), IdCap);

                int m = Math.Max(0, NativeBridge.wf_get_room_polygon(_handle, levelIndex, i, poly, poly.Length));
                var pts = new List<Vector2>(m / 2);
                for (int j = 0; j + 1 < m; j += 2) pts.Add(new Vector2(poly[j], poly[j + 1]));

                int kind = NativeBridge.wf_get_room_kind(_handle, levelIndex, i);
                list.Add(new WfRoom
                {
                    id = id,
                    code = code.ToString(),
                    name = GetPropertyText(levelIndex, ElementKind.Room, id, "name"),
                    kind = kind >= 0 && kind < RoomKinds.Count ? (RoomKind)kind : RoomKind.Unknown,
                    polygon = pts,
                    boundary = new List<string>(),
                    centroid = new Vector2(centroid[0], centroid[1]),
                    area = ParseFloat(GetPropertyText(levelIndex, ElementKind.Room, id, "area")),
                    confidence = confidence,
                });
            }
            return list;
        }

        public IReadOnlyList<WfNode> Nodes(int levelIndex)
        {
            // The C API has no node ids, only positions; edges refer to nodes by index.
            // "#<index>" is used as the id so WfEdge.a / .b line up with it.
            int n = Count(NativeBridge.wf_node_count(_handle, levelIndex));
            var list = new List<WfNode>(n);
            if (n == 0) return list;

            var buf = new float[n * 3];
            NativeBridge.wf_get_nodes(_handle, levelIndex, buf, buf.Length);
            for (int i = 0; i < n; i++)
                list.Add(new WfNode { id = $"#{i}", pos = new Vector2(buf[i * 3], buf[i * 3 + 1]), kind = (NodeKind)(int)buf[i * 3 + 2] });
            return list;
        }

        public IReadOnlyList<WfEdge> Edges(int levelIndex)
        {
            int n = Count(NativeBridge.wf_edge_count(_handle, levelIndex));
            var list = new List<WfEdge>(n);
            if (n == 0) return list;

            var buf = new int[n * 3];
            NativeBridge.wf_get_edges(_handle, levelIndex, buf, buf.Length);
            for (int i = 0; i < n; i++)
                list.Add(new WfEdge { a = $"#{buf[i * 3]}", b = $"#{buf[i * 3 + 1]}", stepFree = buf[i * 3 + 2] != 0 });
            return list;
        }

        // --- edits (Studio is view-only for M1, but the interface still offers them) ---------------

        public void SetRoomCode(int levelIndex, string roomId, string code, string name)
        {
            int i = RoomIndex(levelIndex, roomId);
            if (i >= 0) Check(NativeBridge.wf_set_room_code(_handle, levelIndex, i, code ?? "", name ?? ""));
        }

        public void SetRoomKind(int levelIndex, string roomId, RoomKind kind)
        {
            int i = RoomIndex(levelIndex, roomId);
            if (i >= 0) Check(NativeBridge.wf_set_room_kind(_handle, levelIndex, i, kind.ToString().ToLowerInvariant()));
        }

        public void MoveWall(int levelIndex, string wallId, Vector2 a, Vector2 b) =>
            Check(NativeBridge.wf_move_wall(_handle, levelIndex, wallId, a.x, a.y, b.x, b.y));

        public void DeleteWall(int levelIndex, string wallId) =>
            Check(NativeBridge.wf_delete_wall(_handle, levelIndex, wallId));

        public string AddWall(int levelIndex, Vector2 a, Vector2 b, float thickness)
        {
            var id = new StringBuilder(IdCap);
            return Check(NativeBridge.wf_add_wall(_handle, levelIndex, a.x, a.y, b.x, b.y, thickness, id, IdCap)) ? id.ToString() : null;
        }

        // --- property panel ------------------------------------------------------------------------

        public IReadOnlyList<WfPropertyRow> GetProperties(int levelIndex, ElementKind kind, string elementId)
        {
            var rows = new List<WfPropertyRow>();
            if (!IsOpen || string.IsNullOrEmpty(elementId)) return rows;

            int n = NativeBridge.wf_property_count((int)kind);
            for (int i = 0; i < n; i++)
            {
                var name = new StringBuilder(IdCap);
                var type = new StringBuilder(16);
                if (NativeBridge.wf_property_name((int)kind, i, name, IdCap, type, 16) != 0) continue;

                var value = new StringBuilder(TextCap);
                // A failed read means the element no longer exists: return nothing so the panel says so.
                if (NativeBridge.wf_get_property(_handle, levelIndex, (int)kind, elementId, name.ToString(), value, TextCap) < 0)
                    return new List<WfPropertyRow>();

                rows.Add(new WfPropertyRow { name = name.ToString(), type = ParseType(type.ToString()), valueText = Unquote(value.ToString()) });
            }
            return rows;
        }

        public bool SetProperty(int levelIndex, ElementKind kind, string elementId, string propertyName, string valueText) =>
            IsOpen && NativeBridge.wf_set_property(_handle, levelIndex, (int)kind, elementId, propertyName, valueText) == 0;

        // --- undo / redo ---------------------------------------------------------------------------

        public bool CanUndo => IsOpen && NativeBridge.wf_can_undo(_handle) == 1;
        public bool CanRedo => IsOpen && NativeBridge.wf_can_redo(_handle) == 1;
        public void Undo() { if (IsOpen) NativeBridge.wf_undo(_handle); }
        public void Redo() { if (IsOpen) NativeBridge.wf_redo(_handle); }

        // --- graph + routing -----------------------------------------------------------------------

        public void BuildGraph()
        {
            if (!IsOpen) return;
            if (NativeBridge.wf_build_graph(_handle) != 0)
                throw new InvalidOperationException("Build graph failed: " + NativeBridge.LastError());
        }

        public string NodeForRoom(string codeOrId)
        {
            if (!IsOpen || string.IsNullOrEmpty(codeOrId)) return null;
            var sb = new StringBuilder(IdCap);
            return NativeBridge.wf_node_for_room(_handle, codeOrId, sb, IdCap) > 0 ? sb.ToString() : null;
        }

        public WfRouteResult Route(string fromNodeRef, string toNodeRef, bool stepFreeOnly)
        {
            if (!IsOpen) return new WfRouteResult { success = false, errorMessage = "no document open" };

            var buf = new float[3 * 1024];
            int n = NativeBridge.wf_route(_handle, fromNodeRef, toNodeRef, stepFreeOnly ? 1 : 0, buf, buf.Length, out float cost);
            if (n < 0) return new WfRouteResult { success = false, errorMessage = NativeBridge.LastError() };

            // core gives x y elevation; Unity is y-up, so elevation goes into y (same as the stub)
            var pts = new Vector3[n / 3];
            for (int i = 0; i < pts.Length; i++) pts[i] = new Vector3(buf[i * 3], buf[i * 3 + 2], buf[i * 3 + 1]);
            return new WfRouteResult { success = true, points = pts, totalCost = cost, stepFree = stepFreeOnly, stepCount = pts.Length };
        }

        public IReadOnlyList<WfRoomHit> SearchRooms(string query, int max = 20)
        {
            var hits = new List<WfRoomHit>();
            if (!IsOpen) return hits;

            var sb = new StringBuilder(16384);
            if (NativeBridge.wf_search_rooms(_handle, query ?? "", sb, sb.Capacity) < 0) return hits;

            // one line per room: "L1:r3|CODE|NAME|kind"
            foreach (var line in sb.ToString().Split(new[] { '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var f = line.Split('|');
                if (f.Length < 4) continue;
                hits.Add(new WfRoomHit { levelNodeRef = f[0], code = f[1], name = f[2], kind = f[3] });
                if (hits.Count >= max) break;
            }
            return hits;
        }

        // --- helpers -------------------------------------------------------------------------------

        private int Count(int n) => IsOpen && n > 0 ? n : 0;

        private string GetPropertyText(int levelIndex, ElementKind kind, string id, string prop)
        {
            var sb = new StringBuilder(TextCap);
            return NativeBridge.wf_get_property(_handle, levelIndex, (int)kind, id, prop, sb, TextCap) >= 0 ? Unquote(sb.ToString()) : "";
        }

        // The core writes text properties as "value" (in quotes, no escaping);
        // numbers, bools and enums come back bare.
        private static string Unquote(string s) =>
            s != null && s.Length >= 2 && s[0] == '"' && s[s.Length - 1] == '"' ? s.Substring(1, s.Length - 2) : s;

        private int RoomIndex(int levelIndex, string roomId)
        {
            int n = Count(NativeBridge.wf_room_count(_handle, levelIndex));
            for (int i = 0; i < n; i++)
            {
                int k = i;
                if (Text((sb, cap) => NativeBridge.wf_get_room_id(_handle, levelIndex, k, sb, cap), IdCap) == roomId) return i;
            }
            return -1;
        }

        private static string Text(Func<StringBuilder, int, int> call, int cap = TextCap)
        {
            var sb = new StringBuilder(cap);
            return call(sb, cap) >= 0 ? sb.ToString() : "";
        }

        private static float ParseFloat(string s) =>
            float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out float v) ? v : 0f;

        private static PropertyType ParseType(string t) => t switch
        {
            "bool" => PropertyType.Bool,
            "int" => PropertyType.Int,
            "float" => PropertyType.Float,
            "vec2" => PropertyType.Vec2,
            // enum option lists aren't exposed by the C API, so enums show as their text value
            _ => PropertyType.String,
        };

        private static bool Check(int status)
        {
            if (status < 0) Debug.LogError("[Wayforge] " + NativeBridge.LastError());
            return status == 0;
        }
    }
}
