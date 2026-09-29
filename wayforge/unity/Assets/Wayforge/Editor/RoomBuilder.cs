using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    // Builds the plan in 3D: one object per room (a coloured floor in the room's shape and a label),
    // then the walls, and a beam over each door.
    //
    //   Wayforge 3D
    //     Rooms / Room A1 (classroom) / Floor, Label
    //     Walls / Wall ...
    //     Doors / Door ...
    public static class RoomBuilder
    {
        const float WallHeight = 3f;        // metres
        const float WallThickness = 0.2f;
        const float DoorHeight = 2.1f;
        const float FloorHeight = 0.02f;    // just above y = 0 so it doesn't flicker against a ground plane
        const float LabelHeight = 0.05f;
        const string RootName = "Wayforge 3D";

        public static void Build(WayforgeDocument doc)
        {
            // Remove the model from last time so it doesn't pile up
            var old = GameObject.Find(RootName);
            if (old != null) Undo.DestroyObjectImmediate(old);

            var root = new GameObject(RootName);
            var rooms = MakeGroup(root, "Rooms");
            var walls = MakeGroup(root, "Walls");
            var doors = MakeGroup(root, "Doors");

            var wallColour = MakeMaterial(new Color(0.95f, 0.95f, 0.95f));
            var doorColour = MakeMaterial(new Color(0.55f, 0.35f, 0.2f));
            var floorColours = new Dictionary<Color, Material>();

            // Rooms: a floor in the room's real shape, in the room's colour, with its name on it
            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length < 3) continue;

                var roomObject = new GameObject("Room " + room.Label);
                roomObject.transform.SetParent(rooms.transform, false);

                if (!floorColours.TryGetValue(room.Colour, out var colour))
                    floorColours[room.Colour] = colour = MakeMaterial(room.Colour);

                var floor = new GameObject("Floor");
                floor.transform.SetParent(roomObject.transform, false);
                floor.AddComponent<MeshFilter>().sharedMesh = FloorMesh(room);
                floor.AddComponent<MeshRenderer>().sharedMaterial = colour;
                floor.AddComponent<MeshCollider>();   // so the room can be clicked in the Scene view

                MakeLabel(roomObject, room);
            }

            // Walls: one box per wall, from the floor to the ceiling
            foreach (var wall in doc.Walls)
                MakeBoxAlong(walls, "Wall", wall.a, wall.b, 0f, WallHeight, wallColour);

            // Doors: the wall has a gap, so put a beam above it from door height to the ceiling
            foreach (var door in doc.Doors)
                MakeBoxAlong(doors, "Door", door.a, door.b, DoorHeight, WallHeight, doorColour);

            // Ctrl+Z removes the model, and the Scene view zooms to it
            Undo.RegisterCreatedObjectUndo(root, "Make 3D");
            Selection.activeGameObject = root;
            if (SceneView.lastActiveSceneView != null) SceneView.lastActiveSceneView.FrameSelected();
        }

        static GameObject MakeGroup(GameObject parent, string name)
        {
            var group = new GameObject(name);
            group.transform.SetParent(parent.transform, false);
            return group;
        }

        // A flat mesh in the shape of the room outline. The plan's (x, y) becomes Unity's (x, z).
        static Mesh FloorMesh(RoomData room)
        {
            var vertices = new Vector3[room.corners.Length];
            for (int i = 0; i < vertices.Length; i++)
                vertices[i] = new Vector3(room.corners[i].x, FloorHeight, room.corners[i].y);

            // Triangles come counter-clockwise in the plan; Unity shows the clockwise side, so flip each one to face up
            int[] plan = room.Triangles;
            var triangles = new int[plan.Length];
            for (int t = 0; t + 2 < plan.Length; t += 3)
            {
                triangles[t] = plan[t];
                triangles[t + 1] = plan[t + 2];
                triangles[t + 2] = plan[t + 1];
            }

            var mesh = new Mesh { name = "Floor " + room.code, vertices = vertices, triangles = triangles };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        // The room's code (and type) lying flat on the floor, readable from above
        static void MakeLabel(GameObject parent, RoomData room)
        {
            var label = new GameObject("Label");
            label.transform.SetParent(parent.transform, false);
            label.transform.position = new Vector3(room.Centre.x, LabelHeight, room.Centre.y);
            label.transform.rotation = Quaternion.Euler(90f, 0f, 0f);

            // Bigger rooms get bigger text: about an eighth of the room's size, between 0.25 m and 1 m tall
            float textHeight = Mathf.Clamp(Mathf.Sqrt(room.Area) * 0.12f, 0.25f, 1f);
            var text = label.AddComponent<TextMesh>();
            text.text = room.kind == "unknown" ? room.code : room.code + "\n" + room.kind;
            text.fontSize = 64;
            text.characterSize = textHeight * 10f / text.fontSize;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = new Color(0.1f, 0.1f, 0.1f);
        }

        // A box that runs along the line from a to b, between two heights.
        // The plan's (x, y) becomes Unity's (x, z).
        static void MakeBoxAlong(GameObject parent, string name, Vector2 a, Vector2 b, float bottom, float top, Material colour)
        {
            float length = Vector2.Distance(a, b);
            if (length < 0.01f) return;

            Vector2 mid = (a + b) * 0.5f;
            float angle = -Mathf.Atan2(b.y - a.y, b.x - a.x) * Mathf.Rad2Deg;   // turn the box to face along the line
            MakeBox(parent, name, new Vector3(mid.x, (bottom + top) / 2f, mid.y),
                    new Vector3(length + WallThickness, top - bottom, WallThickness), angle, colour);
        }

        static void MakeBox(GameObject parent, string name, Vector3 position, Vector3 size, float angle, Material colour)
        {
            var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.name = name;
            box.transform.SetParent(parent.transform);
            box.transform.position = position;
            box.transform.rotation = Quaternion.Euler(0f, angle, 0f);
            box.transform.localScale = size;
            box.GetComponent<MeshRenderer>().sharedMaterial = colour;
        }

        static Material MakeMaterial(Color colour)
        {
            return new Material(Shader.Find("Standard")) { color = colour };
        }
    }
}
