// WayforgeDocument.cs - reads one .wfb file through NativeBridge (Kervin's bridge) and keeps
// a simple C# copy of its walls and rooms. The file itself is loaded by the C++ core
// (wf_doc, Shrinivasan's part); this class only asks for the numbers and stores them.
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

namespace Wayforge
{
    public class WallData
    {
        public Vector2 a, b;          // end points, in metres
    }

    public class RoomData
    {
        public string id;             // "r1"
        public string code;           // "A1"
        public Vector2[] corners;     // outline, in metres

        // Area of the outline (shoelace formula), in square metres.
        public float Area
        {
            get
            {
                float sum = 0;
                for (int i = 0; i < corners.Length; i++)
                {
                    Vector2 p = corners[i], q = corners[(i + 1) % corners.Length];
                    sum += p.x * q.y - q.x * p.y;
                }
                return Mathf.Abs(sum) * 0.5f;
            }
        }
    }

    public class WayforgeDocument
    {
        public string Path { get; private set; }
        public List<WallData> Walls { get; } = new List<WallData>();
        public List<RoomData> Rooms { get; } = new List<RoomData>();

        // Adds a rectangular room (and its 4 walls) from two opposite corners, in metres.
        // Used when the user draws a square over an imported image.
        public RoomData AddRectangle(Vector2 cornerA, Vector2 cornerB)
        {
            Vector2 min = Vector2.Min(cornerA, cornerB), max = Vector2.Max(cornerA, cornerB);
            var corners = new[] { min, new Vector2(max.x, min.y), max, new Vector2(min.x, max.y) };   // counter-clockwise
            for (int i = 0; i < 4; i++)
                Walls.Add(new WallData { a = corners[i], b = corners[(i + 1) % 4] });

            var room = new RoomData { id = "r" + (Rooms.Count + 1), code = "R" + (Rooms.Count + 1), corners = corners };
            Rooms.Add(room);
            return room;
        }

        // Opens the file in the C++ core, copies level 0 into Walls and Rooms, then closes it.
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
                NativeBridge.wf_close(handle);   // the C++ side owns this memory, so always give it back
            }
            return doc;
        }

        private void ReadWalls(IntPtr handle)
        {
            int count = NativeBridge.wf_wall_count(handle, 0);
            if (count <= 0) return;

            var numbers = new float[count * 5];              // ax ay bx by thickness, per wall
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

        private void ReadRooms(IntPtr handle)
        {
            int count = NativeBridge.wf_room_count(handle, 0);
            var outline = new float[512];
            var centroid = new float[2];

            for (int i = 0; i < count; i++)
            {
                var id = new StringBuilder(64);
                var code = new StringBuilder(64);
                NativeBridge.wf_get_room_id(handle, 0, i, id, 64);
                NativeBridge.wf_get_room(handle, 0, i, code, 64, centroid, out _);

                int n = NativeBridge.wf_get_room_polygon(handle, 0, i, outline, outline.Length);   // x y pairs
                var corners = new Vector2[Math.Max(0, n / 2)];
                for (int j = 0; j < corners.Length; j++)
                    corners[j] = new Vector2(outline[j * 2], outline[j * 2 + 1]);

                Rooms.Add(new RoomData { id = id.ToString(), code = code.ToString(), corners = corners });
            }
        }
    }
}
