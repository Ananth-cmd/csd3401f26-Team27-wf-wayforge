// BlockMaker.cs - "Make 3D": turns every room of the plan into one solid block in the scene.
// M1 version: the block is the room's bounding box raised to a fixed height, which is exact
// for square and rectangular rooms. Plan (x, y) in metres -> Unity (x, 0, z), 1 unit = 1 m.
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public static class BlockMaker
    {
        const float Height = 3f;               // metres
        const string RootName = "Wayforge 3D";

        public static int Build(WayforgeDocument doc)
        {
            // replace the previous result instead of piling up copies
            var old = GameObject.Find(RootName);
            if (old != null) Undo.DestroyObjectImmediate(old);

            var root = new GameObject(RootName);
            int made = 0;
            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length < 3) continue;

                Vector2 min = room.corners[0], max = min;
                foreach (var c in room.corners) { min = Vector2.Min(min, c); max = Vector2.Max(max, c); }
                Vector2 size = max - min, centre = (min + max) * 0.5f;

                var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
                block.name = "Room " + (string.IsNullOrEmpty(room.code) ? room.id : room.code);
                block.transform.SetParent(root.transform);
                block.transform.position = new Vector3(centre.x, Height / 2f, centre.y);
                block.transform.localScale = new Vector3(size.x, Height, size.y);
                made++;
            }

            Undo.RegisterCreatedObjectUndo(root, "Make 3D");
            UnityEditor.Selection.activeGameObject = root;
            if (SceneView.lastActiveSceneView != null) SceneView.lastActiveSceneView.FrameSelected();
            return made;
        }
    }
}
