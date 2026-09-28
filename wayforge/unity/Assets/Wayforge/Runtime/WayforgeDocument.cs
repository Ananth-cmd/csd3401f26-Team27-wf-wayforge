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

    // One room: its name and the corners of its outline, in metres
    public class RoomData
    {
        public string id;          // e.g. "r1"
        public string code;        // e.g. "A1"
        public Vector2[] corners;

        // Floor area in square metres
        public float Area
        {
            get
            {
                float sum = 0;
                for (int i = 0; i < corners.Length; i++)
                {
                    Vector2 p = corners[i];
                    Vector2 q = corners[(i + 1) % corners.Length];
                    sum += p.x * q.y - q.x * p.y;
                }
                return Mathf.Abs(sum) * 0.5f;
            }
        }
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
                doc.ReadDoors(handle);
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

            var room = new RoomData { id = "r" + (Rooms.Count + 1), code = "R" + (Rooms.Count + 1), corners = corners };
            Rooms.Add(room);
            return room;
        }

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

        void ReadRooms(IntPtr handle)
        {
            int count = NativeBridge.wf_room_count(handle, 0);
            var outline = new float[512];
            var centre = new float[2];

            for (int i = 0; i < count; i++)
            {
                var id = new StringBuilder(64);
                var code = new StringBuilder(64);
                NativeBridge.wf_get_room_id(handle, 0, i, id, 64);
                NativeBridge.wf_get_room(handle, 0, i, code, 64, centre, out _);

                // The outline comes back as x, y, x, y, ...
                int n = NativeBridge.wf_get_room_polygon(handle, 0, i, outline, outline.Length);
                var corners = new Vector2[Math.Max(0, n / 2)];
                for (int j = 0; j < corners.Length; j++)
                    corners[j] = new Vector2(outline[j * 2], outline[j * 2 + 1]);

                // Rooms found in a picture have no code yet, so number them
                string name = code.Length > 0 ? code.ToString() : "R" + (i + 1);
                Rooms.Add(new RoomData { id = id.ToString(), code = name, corners = corners });
            }
        }

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

        // True if point p lies on the wall line
        static bool IsOnWall(Vector2 p, WallData wall)
        {
            float length = Vector2.Distance(wall.a, wall.b);
            return Mathf.Abs(Vector2.Distance(wall.a, p) + Vector2.Distance(p, wall.b) - length) < 0.05f;
        }
    }
}
