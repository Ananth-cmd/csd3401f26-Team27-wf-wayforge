/*!
 * \file WayforgeDocument.cs
 * \brief holds the walls, doors and rooms of one plan
 *
 * asks the C++ core (through NativeBridge) to open a .wfb or read a
 * floor plan pic, then copies everything into normal C# lists so
 * StudioWindow and RoomBuilder can use them.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - WallData, DoorData, RoomData and WayforgeDocument
 *   - reading walls, rooms and doors out of the core
 *   - splitting walls around doors so the 3D model has a gap
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-09-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace Wayforge
{
    // 1 wall, line from a to b in metres
    public class WallData
    {
        public Vector2 a, b;
    }

    // 1 door, the gap in a wall from a to b in metres
    public class DoorData
    {
        public Vector2 a, b;
    }

    // 1 room, its name, type and outline corners in metres
    public class RoomData
    {
        // same order as RoomKind in core/Engine/wf_doc/Types.hpp
        public static readonly string[] Kinds =
            { "unknown", "classroom", "lab", "office", "toilet", "corridor", "stair", "lift", "lobby", "food", "storage", "exit" };

        public string id;          // eg "r1"
        public string code;        // eg "A1"
        public string name = "";   // eg "Lecture Theatre 3"
        public string kind = "unknown";
        public int colourIndex;    // picks the colour so rooms next to each other look different

        Vector2[] _corners;
        int[] _triangles;
        // new corners = clear the old triangles so they get redone
        public Vector2[] corners
        {
            get => _corners;
            set { _corners = value; _triangles = null; }
        }

        // outline split into triangles (3 corner indices each) for filling the floor
        public int[] Triangles => _triangles ??= PlanGeometry.Triangulate(_corners);

        public Vector2 Centre => PlanGeometry.Centroid(_corners);

        // floor area in m^2
        public float Area => Mathf.Abs(PlanGeometry.SignedArea(_corners));

        // special rooms have a fixed colour, the rest get their own
        public Color Colour
        {
            get
            {
                switch (kind)
                {
                    case "corridor": return new Color(0.78f, 0.78f, 0.8f);
                    case "stair":
                    case "lift":     return new Color(0.95f, 0.6f, 0.25f);
                    case "toilet":   return new Color(0.4f, 0.8f, 0.85f);
                    case "exit":     return new Color(0.35f, 0.8f, 0.4f);
                    default:         return Color.HSVToRGB((colourIndex * 0.618034f) % 1f, 0.45f, 0.95f);   // spreads the colours out
                }
            }
        }

        // "A1 (classroom)", or just "A1" if no type yet
        public string Label => kind == "unknown" ? code : $"{code} ({kind})";
    }

    // walls, doors and rooms of 1 plan
    public class WayforgeDocument
    {
        public string Path { get; private set; }
        public List<WallData> Walls { get; } = new List<WallData>();
        public List<RoomData> Rooms { get; } = new List<RoomData>();
        public List<DoorData> Doors { get; } = new List<DoorData>();

        // open a .wfb with the C++ core
        public static WayforgeDocument Load(string path)
        {
            return FromCore(NativeBridge.wf_open_plan(path), path);
        }

        // floor plan pic -> plan using the C++ core.
        // core finds the walls, doors and rooms. 1 pixel = 2cm
        public static WayforgeDocument ImportImage(string imagePath)
        {
            return FromCore(NativeBridge.wf_convert_image(imagePath, 0f), imagePath);
        }

        // copy everything out of the core then close it
        static WayforgeDocument FromCore(IntPtr handle, string path)
        {
            if (handle == IntPtr.Zero)
                throw new IOException("Could not open " + System.IO.Path.GetFileName(path) + ": " + NativeBridge.LastError());

            var doc = new WayforgeDocument { Path = path };
            try
            {
                doc.ReadWalls(handle);
                doc.ReadRooms(handle);
                doc.ReadDoors(handle);   // after walls cus each door cuts a wall
            }
            finally
            {
                NativeBridge.wf_close(handle);   // always close it, C++ side owns the memory
            }
            return doc;
        }

        // adds a rectangle room + its 4 walls from 2 opposite corners
        public RoomData AddRectangle(Vector2 cornerA, Vector2 cornerB)
        {
            Vector2 min = Vector2.Min(cornerA, cornerB);
            Vector2 max = Vector2.Max(cornerA, cornerB);
            var corners = new[] { min, new Vector2(max.x, min.y), max, new Vector2(min.x, max.y) };

            for (int i = 0; i < 4; i++)
                Walls.Add(new WallData { a = corners[i], b = corners[(i + 1) % 4] });

            var room = new RoomData { id = "r" + (Rooms.Count + 1), code = "R" + (Rooms.Count + 1), corners = corners, colourIndex = Rooms.Count };
            Rooms.Add(room);
            return room;
        }

        // copy all walls on level 0
        void ReadWalls(IntPtr handle)
        {
            int count = NativeBridge.wf_wall_count(handle, 0);
            if (count <= 0) return;

            // 5 numbers per wall: ax, ay, bx, by, thickness
            var numbers = new float[count * 5];
            NativeBridge.wf_get_walls(handle, 0, numbers, numbers.Length);

            for (int i = 0; i < count; i++)
            {
                Walls.Add(new WallData
                {
                    a = new Vector2(numbers[i * 5], numbers[i * 5 + 1]),
                    b = new Vector2(numbers[i * 5 + 2], numbers[i * 5 + 3]),
                });
            }
        }

        // copy all rooms on level 0: id, code, name, type, outline
        void ReadRooms(IntPtr handle)
        {
            int count = NativeBridge.wf_room_count(handle, 0);
            var outline = new float[512];   // enough for 256 corners
            var centre = new float[2];

            for (int i = 0; i < count; i++)
            {
                var id = new StringBuilder(64);
                var code = new StringBuilder(64);
                NativeBridge.wf_get_room_id(handle, 0, i, id, 64);
                NativeBridge.wf_get_room(handle, 0, i, code, 64, centre, out _);

                // outline comes back as x, y, x, y ...
                int n = NativeBridge.wf_get_room_polygon(handle, 0, i, outline, outline.Length);
                var corners = new List<Vector2>();
                for (int j = 0; j + 1 < n; j += 2)
                    corners.Add(new Vector2(outline[j], outline[j + 1]));
                if (corners.Count > 1 && (corners[0] - corners[corners.Count - 1]).sqrMagnitude < 1e-8f)
                    corners.RemoveAt(corners.Count - 1);   // last corner is the same as the first so remove it

                var name = new StringBuilder(128);
                NativeBridge.wf_get_property(handle, 0, 2, id.ToString(), "name", name, 128);   // 2 = room

                int kind = NativeBridge.wf_get_room_kind(handle, 0, i);

                // rooms from a pic dont have a code yet so just number them
                Rooms.Add(new RoomData
                {
                    id = id.ToString(),
                    code = code.Length > 0 ? code.ToString() : "R" + (i + 1),
                    name = name.ToString(),
                    kind = kind >= 0 && kind < RoomData.Kinds.Length ? RoomData.Kinds[kind] : "unknown",
                    corners = corners.ToArray(),
                    colourIndex = i,
                });
            }
        }

        // copy all doors on level 0 and cut them into their walls
        void ReadDoors(IntPtr handle)
        {
            int count = NativeBridge.wf_opening_count(handle, 0);
            if (count <= 0) return;

            // 4 numbers per door: x, y, width, type
            var numbers = new float[count * 4];
            NativeBridge.wf_get_openings(handle, 0, numbers, numbers.Length);

            for (int i = 0; i < count; i++)
            {
                var centre = new Vector2(numbers[i * 4], numbers[i * 4 + 1]);
                AddDoor(centre, numbers[i * 4 + 2]);
            }
        }

        // adds a door centred on a wall, the wall gets split in 2 around the gap
        public void AddDoor(Vector2 centre, float width)
        {
            for (int i = 0; i < Walls.Count; i++)
            {
                WallData wall = Walls[i];
                if (!IsOnWall(centre, wall)) continue;

                Vector2 along = (wall.b - wall.a).normalized;
                Vector2 a = centre - along * width / 2f;    // door end nearer wall.a
                Vector2 b = centre + along * width / 2f;

                Walls[i] = new WallData { a = wall.a, b = a };            // part before the door
                Walls.Insert(i + 1, new WallData { a = b, b = wall.b });  // part after the door
                Doors.Add(new DoorData { a = a, b = b });
                return;
            }
        }

        // true if p is on the wall (within 5cm)
        static bool IsOnWall(Vector2 p, WallData wall)
        {
            float length = Vector2.Distance(wall.a, wall.b);
            return Mathf.Abs(Vector2.Distance(wall.a, p) + Vector2.Distance(p, wall.b) - length) < 0.05f;
        }
    }
}
