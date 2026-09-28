// "View 3D" in Studio: builds the current level as a 3D model in the open
// scene (via BuildingModelBuilder), replacing any earlier preview, then
// selects it and frames it in the Scene view. Ctrl+Z removes it again.
//
// Materials are saved once under Assets/Wayforge/Generated/Materials so they
// survive saving and reopening the scene.

using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Wayforge.Editor
{
    public static class Model3DPreview
    {
        private const string RootPrefix = "Wayforge 3D - ";
        private const string MaterialFolder = "Assets/Wayforge/Generated/Materials";

        public static GameObject Show(IWayforgeDocument doc, int levelIndex)
        {
            RemoveExisting();

            var root = BuildingModelBuilder.Build(doc, levelIndex, LoadMaterials());
            Undo.RegisterCreatedObjectUndo(root, "View 3D");
            EditorSceneManager.MarkSceneDirty(root.scene);

            UnityEditor.Selection.activeGameObject = root;   // full name: Wayforge.Editor has its own Selection struct
            var sceneView = SceneView.lastActiveSceneView ?? EditorWindow.GetWindow<SceneView>();
            sceneView.Focus();
            // tilt the camera so walls and floors both read, then fit the model
            sceneView.rotation = Quaternion.Euler(55f, -30f, 0f);
            sceneView.FrameSelected();
            return root;
        }

        private static void RemoveExisting()
        {
            var scene = EditorSceneManager.GetActiveScene();
            foreach (var go in scene.GetRootGameObjects())
                if (go.name.StartsWith(RootPrefix))
                    Undo.DestroyObjectImmediate(go);
        }

        private static BuildingModelBuilder.Materials LoadMaterials() => new BuildingModelBuilder.Materials
        {
            wall = Mat("Wall", new Color(0.93f, 0.93f, 0.95f)),
            floor = Mat("Floor", new Color(0.62f, 0.78f, 0.95f)),
            corridor = Mat("Corridor", new Color(0.85f, 0.85f, 0.80f)),
            stair = Mat("Stair", new Color(0.78f, 0.70f, 0.95f)),
            exit = Mat("Exit", new Color(0.55f, 0.85f, 0.55f)),
            untagged = Mat("Untagged", new Color(0.95f, 0.72f, 0.72f)),
            door = Mat("Door", new Color(0.95f, 0.80f, 0.20f)),
        };

        private static Material Mat(string name, Color color)
        {
            string path = $"{MaterialFolder}/Wayforge_{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat != null) return mat;

            // built-in pipeline uses Standard; fall back to URP Lit if the project switches later
            var shader = Shader.Find("Standard") ?? Shader.Find("Universal Render Pipeline/Lit");
            mat = new Material(shader) { color = color };
            EnsureFolder(MaterialFolder);
            AssetDatabase.CreateAsset(mat, path);
            return mat;
        }

        // AssetDatabase.CreateAsset needs every parent folder to be known to Unity,
        // so create them through AssetDatabase rather than System.IO.
        private static void EnsureFolder(string folder)
        {
            if (AssetDatabase.IsValidFolder(folder)) return;
            string parent = Path.GetDirectoryName(folder).Replace('\\', '/');
            EnsureFolder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(folder));
        }
    }
}
