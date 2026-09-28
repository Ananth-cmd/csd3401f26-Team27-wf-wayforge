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

    // Holds the walls and rooms of one plan
    public class WayforgeDocument
    {
        public string Path { get; private set; }
        public List<WallData> Walls { get; } = new List<WallData>();
        public List<RoomData> Rooms { get; } = new List<RoomData>();

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

        // Opens a .wfb file with the C++ core and copies its walls and rooms
        public static WayforgeDocument Load(string path)
        {
            IntPtr handle = NativeBridge.wf_open_plan(path);
            if (handle == IntPtr.Zero)
                throw new IOException("Could not open " + System.IO.Path.GetFileName(path) + ": " + NativeBridge.LastError());

            var doc = new WayforgeDocument { Path = path };
            try
            {
                doc.ReadWalls(handle);
                doc.ReadRooms(handle);
            }
            finally
            {
                NativeBridge.wf_close(handle);   // always close it, the C++ side owns that memory
            }
            return doc;
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

                Rooms.Add(new RoomData { id = id.ToString(), code = code.ToString(), corners = corners });
            }
        }
    }
}
