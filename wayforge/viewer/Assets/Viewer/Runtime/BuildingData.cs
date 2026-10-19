/*!
 * \file BuildingData.cs
 * \brief .wfb building model for the viewer
 *
 * Plain C# copy of the parts of the .wfb format the viewer draws: levels
 * (elevation, ceiling height), walls, openings, rooms, navigation nodes and
 * the links between levels. Coordinates stay in plan metres (x right,
 * y up / north); BuildingView maps plan (x, y) at elevation z to Unity
 * (x, z, y). See docs/fileformat.md for the full format.
 *
 * Links: filled by BuildingData.Parse() from the JSON text the page sends
 * (ViewerApi.LoadBuilding), read by BuildingView and RouteView.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - .wfb model and parser for the WebGL viewer (no native core in the browser)
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Wayforge.Viewer
{
    public class WallData
    {
        public string id;
        public Vector2 a, b;
        public float thickness = 0.15f;
        public float Length => Vector2.Distance(a, b);
        public Vector2 Direction => (b - a).normalized;
    }

    public class OpeningData
    {
        public string id, wall, type = "door";      // type: door, window, opening
        public float offset, width, height = 2.1f, sill;
    }

    public class RoomData
    {
        public string id, code = "", name = "", kind = "unknown";
        public Vector2[] polygon = Array.Empty<Vector2>();
        public Vector2 centroid;
        public float area;
        public string levelId;

        // Text shown on the room: code, else name, else the kind for special rooms.
        public string Label
        {
            get
            {
                if (!string.IsNullOrEmpty(code)) return code;
                if (!string.IsNullOrEmpty(name)) return name;
                return kind == "unknown" || kind == "corridor" ? "" : kind;
            }
        }
    }

    public class NodeData
    {
        public string id, room = "", kind = "corridor";
        public Vector2 pos;
    }

    public class LinkData
    {
        public string a, b, kind = "stair";          // a / b: "LEVEL:NODE"
        public bool stepFree;
    }

    public class LevelData
    {
        public string id, name;
        public float elevation, ceilingHeight = 3f;
        public readonly List<WallData> walls = new List<WallData>();
        public readonly List<OpeningData> openings = new List<OpeningData>();
        public readonly List<RoomData> rooms = new List<RoomData>();
        public readonly List<NodeData> nodes = new List<NodeData>();

        public NodeData FindNode(string nodeId) => nodes.Find(n => n.id == nodeId);
        public RoomData FindRoom(string roomId) => rooms.Find(r => r.id == roomId);
    }

    public class BuildingData
    {
        public string name = "";
        public float latitude, longitude, heading;
        public readonly List<LevelData> levels = new List<LevelData>();
        public readonly List<LinkData> links = new List<LinkData>();

        public LevelData FindLevel(string levelId) => levels.Find(l => l.id == levelId);

        // Room by id, code or "LEVEL:ROOMID" (same rules as wf_cli). Null if not found.
        public RoomData FindRoom(string reference)
        {
            if (string.IsNullOrEmpty(reference)) return null;
            int colon = reference.IndexOf(':');
            string levelId = colon >= 0 ? reference.Substring(0, colon) : null;
            string key = colon >= 0 ? reference.Substring(colon + 1) : reference;
            foreach (var l in levels)
            {
                if (levelId != null && l.id != levelId) continue;
                foreach (var r in l.rooms)
                    if (r.id == key || (!string.IsNullOrEmpty(r.code) && r.code == key)) return r;
            }
            return null;
        }

        // Node for a "LEVEL:NODE" reference, with its level. False if either is missing.
        public bool TryFindNode(string reference, out LevelData level, out NodeData node)
        {
            level = null; node = null;
            int colon = reference?.IndexOf(':') ?? -1;
            if (colon < 0) return false;
            level = FindLevel(reference.Substring(0, colon));
            node = level?.FindNode(reference.Substring(colon + 1));
            return node != null;
        }

        // --- parsing --------------------------------------------------------------------------

        public static BuildingData Parse(string json)
        {
            var root = Json.Parse(json) as Dictionary<string, object>;
            if (root == null) throw new FormatException("a building file must be a JSON object");
            var levels = Json.Arr(root, "levels");
            if (levels == null) throw new FormatException("not a .wfb building: no \"levels\"");

            var b = new BuildingData();
            var info = Json.Obj(root, "building");
            b.name = Json.Str(info, "name");
            b.latitude = Json.Num(info, "latitude");
            b.longitude = Json.Num(info, "longitude");
            b.heading = Json.Num(info, "heading");

            foreach (var lo in levels)
            {
                var l = new LevelData
                {
                    id = Json.Str(lo, "id", "L" + (b.levels.Count + 1)),
                    name = Json.Str(lo, "name"),
                    elevation = Json.Num(lo, "elevation"),
                    ceilingHeight = Json.Num(lo, "ceilingHeight", 3f),
                };
                if (string.IsNullOrEmpty(l.name)) l.name = l.id;

                foreach (var wo in Json.Arr(lo, "walls") ?? new List<object>())
                    l.walls.Add(new WallData
                    {
                        id = Json.Str(wo, "id"),
                        a = Point(Json.Arr(wo, "a")),
                        b = Point(Json.Arr(wo, "b")),
                        thickness = Json.Num(wo, "thickness", 0.15f),
                    });

                foreach (var oo in Json.Arr(lo, "openings") ?? new List<object>())
                    l.openings.Add(new OpeningData
                    {
                        id = Json.Str(oo, "id"),
                        wall = Json.Str(oo, "wall"),
                        type = Json.Str(oo, "type", "door"),
                        offset = Json.Num(oo, "offset"),
                        width = Json.Num(oo, "width", 0.9f),
                        height = Json.Num(oo, "height", 2.1f),
                        sill = Json.Num(oo, "sill"),
                    });

                foreach (var ro in Json.Arr(lo, "rooms") ?? new List<object>())
                {
                    var poly = new List<Vector2>();
                    foreach (var p in Json.Arr(ro, "polygon") ?? new List<object>()) poly.Add(Point(p as List<object>));
                    if (poly.Count > 1 && (poly[0] - poly[poly.Count - 1]).sqrMagnitude < 1e-8f) poly.RemoveAt(poly.Count - 1);
                    var room = new RoomData
                    {
                        id = Json.Str(ro, "id"),
                        code = Json.Str(ro, "code"),
                        name = Json.Str(ro, "name"),
                        kind = Json.Str(ro, "kind", "unknown"),
                        polygon = poly.ToArray(),
                        area = Json.Num(ro, "area"),
                        levelId = l.id,
                    };
                    var c = Json.Arr(ro, "centroid");
                    room.centroid = c != null ? Point(c) : MeshUtil.Centroid(room.polygon);
                    l.rooms.Add(room);
                }

                foreach (var no in Json.Arr(lo, "nodes") ?? new List<object>())
                    l.nodes.Add(new NodeData
                    {
                        id = Json.Str(no, "id"),
                        room = Json.Str(no, "room"),
                        kind = Json.Str(no, "kind", "corridor"),
                        pos = Point(Json.Arr(no, "pos")),
                    });

                b.levels.Add(l);
            }
            b.levels.Sort((x, y) => x.elevation.CompareTo(y.elevation));

            foreach (var ko in Json.Arr(root, "links") ?? new List<object>())
                b.links.Add(new LinkData
                {
                    a = Json.Str(ko, "a"),
                    b = Json.Str(ko, "b"),
                    kind = Json.Str(ko, "kind", "stair"),
                    stepFree = Json.Bool(ko, "stepFree"),
                });
            return b;
        }

        static Vector2 Point(List<object> xy)
        {
            if (xy == null || xy.Count < 2 || !(xy[0] is double x) || !(xy[1] is double y)) return Vector2.zero;
            return new Vector2((float)x, (float)y);
        }
    }
}
