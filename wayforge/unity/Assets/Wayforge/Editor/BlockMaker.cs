using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    // Turns every room of the plan into a block in the scene.
    public static class BlockMaker
    {
        const float Height = 3f;                  // block height in metres
        const string RootName = "Wayforge 3D";    // parent object that holds all the blocks

        // Makes the blocks and returns how many were made.
        public static int Build(WayforgeDocument doc)
        {
            // Remove the blocks from last time so they don't pile up
            var old = GameObject.Find(RootName);
            if (old != null) Undo.DestroyObjectImmediate(old);

            var root = new GameObject(RootName);
            int made = 0;

            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length < 3) continue;

                // Find the room's width, depth and centre
                Vector2 min = room.corners[0], max = min;
                foreach (var c in room.corners)
                {
                    min = Vector2.Min(min, c);
                    max = Vector2.Max(max, c);
                }
                Vector2 size = max - min;
                Vector2 centre = (min + max) * 0.5f;

                // A cube stretched to the room's size. The plan's y becomes Unity's z.
                var block = GameObject.CreatePrimitive(PrimitiveType.Cube);
                block.name = "Room " + (string.IsNullOrEmpty(room.code) ? room.id : room.code);
                block.transform.SetParent(root.transform);
                block.transform.position = new Vector3(centre.x, Height / 2f, centre.y);
                block.transform.localScale = new Vector3(size.x, Height, size.y);
                made++;
            }

            // Ctrl+Z removes the blocks, and the Scene view zooms to them
            Undo.RegisterCreatedObjectUndo(root, "Make 3D");
            UnityEditor.Selection.activeGameObject = root;
            if (SceneView.lastActiveSceneView != null) SceneView.lastActiveSceneView.FrameSelected();

            return made;
        }
    }
}
