/*!
 * \file WayforgeDocument.cs
 * \brief Holds the walls, doors and rooms of one floor plan in Unity
 *
 * Asks the C++ core (through NativeBridge) to open a .wfb file or read a
 * floor plan picture, then copies the walls, doors and rooms into plain C#
 * lists that the Studio window and RoomBuilder can use. Rooms can also be
 * added by hand with AddRectangle.
 *
 * Used by: StudioWindow (shows the plan in 2D), RoomBuilder (makes it 3D).
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - WallData, DoorData, RoomData and WayforgeDocument
 *   - Reading walls, rooms and doors out of the core
 *   - Splitting a wall around each door so the 3D model has a gap
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
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
    // One wall: a line from a to b, in metres
    public class WallData
    {
        public Vector2 a, b;
    }

    // One door: the gap in a wall from a to b, in metres
    public class DoorData
    {
        public Vector2 a, b;
    }

    // One room: its name, type and the corners of its outline, in metres
    public class RoomData
    {
        // Same order as RoomKind in core/Engine/wf_doc/Types.hpp
        public static readonly string[] Kinds =
            { "unknown", "classroom", "lab", "office", "toilet", "corridor", "stair", "lift", "lobby", "food", "storage", "exit" };

        public string id;          // e.g. "r1"
        public string code;        // e.g. "A1"
        public string name = "";   // e.g. "Lecture Theatre 3"
        public string kind = "unknown";
        public int colourIndex;    // picks this room's colour, so neighbours look different

        Vector2[] _corners;
        int[] _triangles;
        // Setting new corners clears the saved triangles so they are worked out again
        public Vector2[] corners
        {
            get => _corners;
            set { _corners = value; _triangles = null; }
        }

        // The outline split into triangles (3 corner indices each), for drawing filled floors
        public int[] Triangles => _triangles ??= PlanGeometry.Triangulate(_corners);

        public Vector2 Centre => PlanGeometry.Centroid(_corners);

        // Floor area in square metres
        public float Area => Mathf.Abs(PlanGeometry.SignedArea(_corners));

        // Special rooms have a fixed colour, every other room gets its own
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

        // "A1 (classroom)", or just "A1" while the type is unknown
        public string Label => kind == "unknown" ? code : $"{code} ({kind})";
    }

    // Holds the walls, doors and rooms of one plan
    public class WayforgeDocument
    {
        public string Path { get; private set; }
        public List<WallData> Walls { get; } = new List<WallData>();
        public List<RoomData> Rooms { get; } = new List<RoomData>();
        public List<DoorData> Doors { get; } = new List<DoorData>();

        // Opens a .wfb file with the C++ core
        public static WayforgeDocument Load(string path)
        {
            return FromCore(NativeBridge.wf_open_plan(path), path);
        }

        // Turns a floor plan picture into a plan with the C++ core.
        // The core finds the walls, doors and rooms. 1 pixel = 2 cm.
        public static WayforgeDocument ImportImage(string imagePath)
        {
            return FromCore(NativeBridge.wf_convert_image(imagePath, 0f), imagePath);
        }

        // Copies the walls, doors and rooms out of the core, then closes it
        static WayforgeDocument FromCore(IntPtr handle, string path)
        {
            if (handle == IntPtr.Zero)
                throw new IOException("Could not open " + System.IO.Path.GetFileName(path) + ": " + NativeBridge.LastError());

            var doc = new WayforgeDocument { Path = path };
            try
            {
                doc.ReadWalls(handle);
                doc.ReadRooms(handle);
                doc.ReadDoors(handle);   // after the walls, because each door cuts a wall
            }
            finally
            {
                NativeBridge.wf_close(handle);   // always close it, the C++ side owns that memory
            }
            return doc;
        }

        // Adds a rectangle room (and its 4 walls) from two opposite corners
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

        // Copies every wall on level 0 out of the core
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

        // Copies every room on level 0 out of the core: id, code, name, type and outline
        void ReadRooms(IntPtr handle)
        {
            int count = NativeBridge.wf_room_count(handle, 0);
            var outline = new float[512];   // room for 256 corners
            var centre = new float[2];

            for (int i = 0; i < count; i++)
            {
                var id = new StringBuilder(64);
                var code = new StringBuilder(64);
                NativeBridge.wf_get_room_id(handle, 0, i, id, 64);
                NativeBridge.wf_get_room(handle, 0, i, code, 64, centre, out _);

                // The outline comes back as x, y, x, y, ...
                int n = NativeBridge.wf_get_room_polygon(handle, 0, i, outline, outline.Length);
                var corners = new List<Vector2>();
                for (int j = 0; j + 1 < n; j += 2)
                    corners.Add(new Vector2(outline[j], outline[j + 1]));
                if (corners.Count > 1 && (corners[0] - corners[corners.Count - 1]).sqrMagnitude < 1e-8f)
                    corners.RemoveAt(corners.Count - 1);   // outline repeats its first corner at the end

                var name = new StringBuilder(128);
                NativeBridge.wf_get_property(handle, 0, 2, id.ToString(), "name", name, 128);   // 2 = room

                int kind = NativeBridge.wf_get_room_kind(handle, 0, i);

                // Rooms found in a picture have no code yet, so number them
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

        // Copies every door on level 0 out of the core and cuts it into its wall
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

        // Adds a door of the given width centred on a wall. The wall is split in two around the gap.
        public void AddDoor(Vector2 centre, float width)
        {
            for (int i = 0; i < Walls.Count; i++)
            {
                WallData wall = Walls[i];
                if (!IsOnWall(centre, wall)) continue;

                Vector2 along = (wall.b - wall.a).normalized;
                Vector2 a = centre - along * width / 2f;    // door end closer to wall.a
                Vector2 b = centre + along * width / 2f;

                Walls[i] = new WallData { a = wall.a, b = a };            // piece before the door
                Walls.Insert(i + 1, new WallData { a = b, b = wall.b });  // piece after the door
                Doors.Add(new DoorData { a = a, b = b });
                return;
            }
        }

        // True if point p lies on the wall line (within 5 cm)
        static bool IsOnWall(Vector2 p, WallData wall)
        {
            float length = Vector2.Distance(wall.a, wall.b);
            return Mathf.Abs(Vector2.Distance(wall.a, p) + Vector2.Distance(p, wall.b) - length) < 0.05f;
        }
    }
}
