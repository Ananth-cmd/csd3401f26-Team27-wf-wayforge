using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    // Builds the plan in 3D: a floor, the walls, and a beam over each door.
    public static class RoomBuilder
    {
        const float WallHeight = 3f;        // metres
        const float WallThickness = 0.2f;
        const float DoorHeight = 2.1f;
        const string RootName = "Wayforge 3D";

        public static void Build(WayforgeDocument doc)
        {
            // Remove the model from last time so it doesn't pile up
            var old = GameObject.Find(RootName);
            if (old != null) Undo.DestroyObjectImmediate(old);

            var root = new GameObject(RootName);
            var floorColour = MakeMaterial(new Color(0.85f, 0.8f, 0.7f));
            var wallColour = MakeMaterial(new Color(0.95f, 0.95f, 0.95f));
            var doorColour = MakeMaterial(new Color(0.55f, 0.35f, 0.2f));

            // Floor: a thin slab under each room
            foreach (var room in doc.Rooms)
            {
                Vector2 min = room.corners[0], max = min;
                foreach (var c in room.corners)
                {
                    min = Vector2.Min(min, c);
                    max = Vector2.Max(max, c);
                }
                Vector2 centre = (min + max) * 0.5f, size = max - min;
                MakeBox(root, "Floor " + room.code, new Vector3(centre.x, -0.05f, centre.y),
                        new Vector3(size.x, 0.1f, size.y), 0f, floorColour);
            }

            // Walls: one box per wall, from the floor to the ceiling
            foreach (var wall in doc.Walls)
                MakeBoxAlong(root, "Wall", wall.a, wall.b, 0f, WallHeight, wallColour);

            // Doors: the wall has a gap, so put a beam above it from door height to the ceiling
            foreach (var door in doc.Doors)
                MakeBoxAlong(root, "Door", door.a, door.b, DoorHeight, WallHeight, doorColour);

            // Ctrl+Z removes the model, and the Scene view zooms to it
            Undo.RegisterCreatedObjectUndo(root, "Make 3D");
            UnityEditor.Selection.activeGameObject = root;
            if (SceneView.lastActiveSceneView != null) SceneView.lastActiveSceneView.FrameSelected();
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
