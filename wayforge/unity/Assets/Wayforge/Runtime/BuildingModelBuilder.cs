// Builds a 3D model of one level from an IWayforgeDocument: a coloured floor
// per room, walls raised to wallHeight, a marker in every doorway, and room
// labels. Plan (x, y) in metres -> Unity (x, 0, y), so 1 Unity unit = 1 m.
//
// Pure read: it never changes the document. Studio's "View 3D" button calls
// this in the Editor; the Android app can call the same thing at runtime.

using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
    public static class BuildingModelBuilder
    {
        public const float WallHeight = 2.8f;
        public const float MinWallThickness = 0.1f;

        public class Materials
        {
            public Material wall, floor, corridor, stair, exit, untagged, door;
        }

        /// Returns the root GameObject ("Wayforge 3D - name") holding Floors, Walls, Doors and Labels.
        public static GameObject Build(IWayforgeDocument doc, int levelIndex, Materials mats)
        {
            var root = new GameObject($"Wayforge 3D - {doc.BuildingName}");
            var floors = Child(root, "Floors");
            var walls = Child(root, "Walls");
            var doors = Child(root, "Doors");
            var labels = Child(root, "Labels");

            foreach (var room in doc.Rooms(levelIndex))
            {
                if (room.polygon == null || room.polygon.Count < 3) continue;
                var go = new GameObject($"Room {(room.IsTagged ? room.code : room.id)}");
                go.transform.SetParent(floors.transform, false);
                go.AddComponent<MeshFilter>().sharedMesh = FloorMesh(room.polygon, 0.01f);
                go.AddComponent<MeshRenderer>().sharedMaterial = RoomMaterial(room, mats);

                string text = room.IsTagged ? (string.IsNullOrEmpty(room.name) ? room.code : $"{room.code}\n{room.name}")
                                            : (string.IsNullOrEmpty(room.name) ? "" : room.name);
                if (!string.IsNullOrEmpty(text)) Label(labels, text, room.centroid);
            }

            var wallList = doc.Walls(levelIndex);
            foreach (var w in wallList)
            {
                float len = Vector2.Distance(w.a, w.b);
                if (len < 1e-3f) continue;
                float thick = Mathf.Max(w.thickness, MinWallThickness);
                Vector2 mid = (w.a + w.b) * 0.5f;
                Vector2 dir = (w.b - w.a) / len;

                var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
                cube.name = $"Wall {w.id}";
                cube.transform.SetParent(walls.transform, false);
                // extend by the thickness so corners meet instead of leaving notches
                cube.transform.localScale = new Vector3(len + thick, WallHeight, thick);
                cube.transform.localPosition = new Vector3(mid.x, WallHeight * 0.5f, mid.y);
                cube.transform.localRotation = Quaternion.Euler(0f, -Mathf.Atan2(dir.y, dir.x) * Mathf.Rad2Deg, 0f);
                cube.GetComponent<MeshRenderer>().sharedMaterial = mats.wall;
            }

            foreach (var o in doc.Openings(levelIndex))
            {
                Vector2 pos = o.pos;
                if (!string.IsNullOrEmpty(o.wall))   // stub data gives wall + offset instead of a position
                {
                    foreach (var w in wallList)
                        if (w.id == o.wall) { pos = w.a + w.Direction * o.offset; break; }
                }
                var marker = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                marker.name = $"Door {o.id}";
                marker.transform.SetParent(doors.transform, false);
                float r = Mathf.Max(o.width, 0.4f);
                marker.transform.localScale = new Vector3(r, 0.02f, r);   // flat disc on the floor
                marker.transform.localPosition = new Vector3(pos.x, 0.03f, pos.y);
                marker.GetComponent<MeshRenderer>().sharedMaterial = mats.door;
            }

            return root;
        }

        // ---------------------------------------------------------------------------------

        private static GameObject Child(GameObject parent, string name)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            return go;
        }

        private static Material RoomMaterial(WfRoom room, Materials m)
        {
            switch (room.kind)
            {
                case RoomKind.Corridor: return m.corridor;
                case RoomKind.Stair:
                case RoomKind.Lift: return m.stair;
                case RoomKind.Exit: return m.exit;
                default: return room.IsTagged ? m.floor : m.untagged;
            }
        }

        private static Mesh FloorMesh(IReadOnlyList<Vector2> poly, float y)
        {
            var verts = new Vector3[poly.Count];
            for (int i = 0; i < poly.Count; i++) verts[i] = new Vector3(poly[i].x, y, poly[i].y);

            var tris = PolygonUtil.Triangulate(poly);
            // Unity draws the side whose triangles run clockwise as seen by the
            // camera; flip any triangle whose normal points down so floors face up.
            for (int t = 0; t + 2 < tris.Count; t += 3)
            {
                Vector3 n = Vector3.Cross(verts[tris[t + 1]] - verts[tris[t]], verts[tris[t + 2]] - verts[tris[t]]);
                if (n.y < 0) (tris[t + 1], tris[t + 2]) = (tris[t + 2], tris[t + 1]);
            }

            var mesh = new Mesh { name = "Room floor" };
            mesh.vertices = verts;
            mesh.triangles = tris.ToArray();
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        private static void Label(GameObject parent, string text, Vector2 at)
        {
            var go = new GameObject($"Label {text.Split('\n')[0]}");
            go.transform.SetParent(parent.transform, false);
            go.transform.localPosition = new Vector3(at.x, 0.05f, at.y);
            go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);   // lie flat, readable from above
            var tm = go.AddComponent<TextMesh>();
            tm.text = text;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.fontSize = 48;
            tm.characterSize = 0.06f;
            tm.color = Color.black;

            // A TextMesh made from code has no font until one is assigned.
            var font = BuiltinFont();
            if (font != null)
            {
                tm.font = font;
                go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            }
        }

        private static Font _font;
        private static Font BuiltinFont()
        {
            if (_font != null) return _font;
            try { _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); } catch { /* older Unity */ }
            if (_font == null) { try { _font = Resources.GetBuiltinResource<Font>("Arial.ttf"); } catch { } }
            return _font;
        }
    }
}
