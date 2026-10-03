/*!
 * \file RoomBuilder.cs
 * \brief builds the plan as a 3D model in the scene
 *
 * used by the Make 3D button. each room gets a coloured floor in its
 * real shape + its name, walls are 3m tall boxes, and each door gets a
 * beam above the gap. 1 unity unit = 1m. ctrl+z removes it.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - room floors, walls, door beams and labels in 3D
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-09-30
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    // builds the plan in 3D. each room gets a coloured floor + label,
    // then the walls, then a beam over each door
    public static class RoomBuilder
    {
        const float WallHeight = 3f;        // metres
        const float WallThickness = 0.2f;
        const float DoorHeight = 2.1f;
        const float FloorHeight = 0.02f;    // slightly above 0 so it doesnt flicker with the ground
        const float LabelHeight = 0.05f;
        const string RootName = "Wayforge 3D";

        // make the whole 3D model
        public static void Build(WayforgeDocument doc)
        {
            // delete the old one first so they dont stack
            var old = GameObject.Find(RootName);
            if (old != null) Undo.DestroyObjectImmediate(old);

            var root = new GameObject(RootName);
            var rooms = MakeGroup(root, "Rooms");
            var walls = MakeGroup(root, "Walls");
            var doors = MakeGroup(root, "Doors");

            var wallColour = MakeMaterial(new Color(0.95f, 0.95f, 0.95f));
            var doorColour = MakeMaterial(new Color(0.55f, 0.35f, 0.2f));
            var floorColours = new Dictionary<Color, Material>();

            // rooms: floor in the real shape + colour, with the name on it
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
                floor.AddComponent<MeshCollider>();   // so u can click it in the scene view

                MakeLabel(roomObject, room);
            }

            // walls: 1 box per wall, floor to ceiling
            foreach (var wall in doc.Walls)
                MakeBoxAlong(walls, "Wall", wall.a, wall.b, 0f, WallHeight, wallColour);

            // doors: wall already has a gap so just add a beam above it
            foreach (var door in doc.Doors)
                MakeBoxAlong(doors, "Door", door.a, door.b, DoorHeight, WallHeight, doorColour);

            // ctrl+z removes it, and zoom the scene view to it
            Undo.RegisterCreatedObjectUndo(root, "Make 3D");
            Selection.activeGameObject = root;
            if (SceneView.lastActiveSceneView != null) SceneView.lastActiveSceneView.FrameSelected();
        }

        // empty parent to keep the hierarchy tidy
        static GameObject MakeGroup(GameObject parent, string name)
        {
            var group = new GameObject(name);
            group.transform.SetParent(parent.transform, false);
            return group;
        }

        // flat mesh in the room shape. plan (x, y) -> unity (x, z)
        static Mesh FloorMesh(RoomData room)
        {
            var vertices = new Vector3[room.corners.Length];
            for (int i = 0; i < vertices.Length; i++)
                vertices[i] = new Vector3(room.corners[i].x, FloorHeight, room.corners[i].y);

            // triangles are anticlockwise but unity shows the clockwise side, so flip them to face up
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

        // room code (+ type) lying flat on the floor so u can read it from above
        static void MakeLabel(GameObject parent, RoomData room)
        {
            var label = new GameObject("Label");
            label.transform.SetParent(parent.transform, false);
            label.transform.position = new Vector3(room.Centre.x, LabelHeight, room.Centre.y);
            label.transform.rotation = Quaternion.Euler(90f, 0f, 0f);

            // bigger room = bigger text, between 0.25m and 1m
            float textHeight = Mathf.Clamp(Mathf.Sqrt(room.Area) * 0.12f, 0.25f, 1f);
            var text = label.AddComponent<TextMesh>();
            text.text = room.kind == "unknown" ? room.code : room.code + "\n" + room.kind;
            text.fontSize = 64;
            text.characterSize = textHeight * 10f / text.fontSize;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = new Color(0.1f, 0.1f, 0.1f);
        }

        // box along the line a to b, between 2 heights.
        // plan (x, y) -> unity (x, z)
        static void MakeBoxAlong(GameObject parent, string name, Vector2 a, Vector2 b, float bottom, float top, Material colour)
        {
            float length = Vector2.Distance(a, b);
            if (length < 0.01f) return;

            Vector2 mid = (a + b) * 0.5f;
            float angle = -Mathf.Atan2(b.y - a.y, b.x - a.x) * Mathf.Rad2Deg;   // rotate it to face along the line
            MakeBox(parent, name, new Vector3(mid.x, (bottom + top) / 2f, mid.y),
                    new Vector3(length + WallThickness, top - bottom, WallThickness), angle, colour);
        }

        // 1 cube, moved, rotated and stretched
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

        // plain coloured material
        static Material MakeMaterial(Color colour)
        {
            return new Material(Shader.Find("Standard")) { color = colour };
        }
    }
}
