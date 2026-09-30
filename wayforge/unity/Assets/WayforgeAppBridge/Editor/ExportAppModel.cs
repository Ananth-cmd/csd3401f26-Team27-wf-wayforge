// Independent output bridge. Does not reference or modify the converter or Wayforge Studio.
using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace WayforgeAppBridge
{
    public static class ExportAppModel
    {
        [MenuItem("Wayforge App/Export generated 3D model for Android app")]
        public static void Export()
        {
            var source = GameObject.Find("Wayforge 3D") ?? Selection.activeGameObject;
            if (!source) { EditorUtility.DisplayDialog("Export model", "First use your existing Wayforge tool to convert a picture and generate the 3D model, or select a model root.", "OK"); return; }
            string output = EditorUtility.SaveFilePanel("Export app model", "", "WayforgeBuilding", "unitypackage");
            if (string.IsNullOrEmpty(output)) return;
            string folder = "Assets/WayforgeAppExports/Building-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
            Directory.CreateDirectory(folder); AssetDatabase.Refresh();
            var clone = UnityEngine.Object.Instantiate(source); clone.name = "Wayforge Building";
            try
            {
                clone.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                // Export static geometry only; the mobile app has no dependency on desktop scripts or DLLs.
                foreach (var component in clone.GetComponentsInChildren<MonoBehaviour>(true)) if (component) UnityEngine.Object.DestroyImmediate(component);
                foreach (var camera in clone.GetComponentsInChildren<Camera>(true)) UnityEngine.Object.DestroyImmediate(camera);
                foreach (var light in clone.GetComponentsInChildren<Light>(true)) UnityEngine.Object.DestroyImmediate(light);
                var meshes = new Dictionary<Mesh, Mesh>(); var materials = new Dictionary<Material, Material>(); int index = 0;
                foreach (var filter in clone.GetComponentsInChildren<MeshFilter>(true))
                {
                    var mesh = filter.sharedMesh; if (!mesh || EditorUtility.IsPersistent(mesh)) continue;
                    if (!meshes.TryGetValue(mesh, out var copy))
                    {
                        copy = UnityEngine.Object.Instantiate(mesh); meshes[mesh] = copy;
                        AssetDatabase.CreateAsset(copy, folder + "/Mesh-" + index++ + ".asset");
                    }
                    filter.sharedMesh = copy;
                }
                foreach (var collider in clone.GetComponentsInChildren<MeshCollider>(true))
                    if (collider.sharedMesh && meshes.TryGetValue(collider.sharedMesh, out var copy)) collider.sharedMesh = copy;
                foreach (var renderer in clone.GetComponentsInChildren<Renderer>(true))
                {
                    var shared = renderer.sharedMaterials;
                    for (int i = 0; i < shared.Length; i++)
                    {
                        var original = shared[i]; if (!original || EditorUtility.IsPersistent(original)) continue;
                        if (!materials.TryGetValue(original, out var material))
                        {
                            material = new Material(original); materials[original] = material;
                            AssetDatabase.CreateAsset(material, folder + "/Material-" + index++ + ".mat");
                        }
                        shared[i] = material;
                    }
                    renderer.sharedMaterials = shared;
                }
                string prefabPath = folder + "/WayforgeBuilding.prefab";
                PrefabUtility.SaveAsPrefabAsset(clone, prefabPath);
                AssetDatabase.SaveAssets();
                AssetDatabase.ExportPackage(prefabPath, output, ExportPackageOptions.IncludeDependencies);
                Debug.Log("Wayforge app model exported to " + output + ". Import this package in the separate android-prototype project.");
            }
            finally { UnityEngine.Object.DestroyImmediate(clone); }
        }
    }
}
