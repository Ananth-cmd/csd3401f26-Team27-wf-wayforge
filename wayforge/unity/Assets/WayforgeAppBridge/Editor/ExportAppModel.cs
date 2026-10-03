/*!
 * \file ExportAppModel.cs
 * \brief exports the 3D model from Studio so the app can use it
 *
 * adds Wayforge App > Export generated 3D model for Android app.
 * it copies the "Wayforge 3D" model that Make 3D builds, strips out
 * any scripts, saves the meshes + materials as real asset files, makes
 * a prefab and packs it all into a .unitypackage. then you import that
 * package into the android-prototype project.
 *
 * \author Katie
 *
 * Contribution: Katie
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-10-03
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace WayforgeAppBridge
{
    public static class ExportAppModel
    {
        // shows up in the top menu
        [MenuItem("Wayforge App/Export generated 3D model for Android app")]
        public static void Export()
        {
            // use the model Make 3D made, or whatever is selected
            var source = GameObject.Find("Wayforge 3D") ?? Selection.activeGameObject;
            if (!source) { EditorUtility.DisplayDialog("Export model", "First use your existing Wayforge tool to convert a picture and generate the 3D model, or select a model root.", "OK"); return; }
            // ask where to save the package
            string output = EditorUtility.SaveFilePanel("Export app model", "", "WayforgeBuilding", "unitypackage");
            if (string.IsNullOrEmpty(output)) return;
            // new folder each time (date + random bit) so exports dont overwrite each other
            string folder = "Assets/WayforgeAppExports/Building-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
            Directory.CreateDirectory(folder); AssetDatabase.Refresh();
            // work on a copy so the Studio model isnt touched
            var clone = UnityEngine.Object.Instantiate(source); clone.name = "Wayforge Building";
            try
            {
                // put it at 0,0,0
                clone.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
                    // the app doesnt have our dll or studio scripts so remove all scripts, cameras and lights
                foreach (var component in clone.GetComponentsInChildren<MonoBehaviour>(true)) if (component) UnityEngine.Object.DestroyImmediate(component);
                foreach (var camera in clone.GetComponentsInChildren<Camera>(true)) UnityEngine.Object.DestroyImmediate(camera);
                foreach (var light in clone.GetComponentsInChildren<Light>(true)) UnityEngine.Object.DestroyImmediate(light);
                // Make 3D creates meshes + materials only in memory. they have to be saved as
                // asset files or the prefab would have missing meshes. the dictionaries stop
                // the same mesh/material being saved twice
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
                // colliders use the same meshes so point them at the saved copies too
                foreach (var collider in clone.GetComponentsInChildren<MeshCollider>(true))
                    if (collider.sharedMesh && meshes.TryGetValue(collider.sharedMesh, out var copy)) collider.sharedMesh = copy;
                // same thing for materials
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
                // save the copy as a prefab, then pack it + everything it uses into the package
                string prefabPath = folder + "/WayforgeBuilding.prefab";
                PrefabUtility.SaveAsPrefabAsset(clone, prefabPath);
                AssetDatabase.SaveAssets();
                AssetDatabase.ExportPackage(prefabPath, output, ExportPackageOptions.IncludeDependencies);
                Debug.Log("Wayforge app model exported to " + output + ". Import this package in the separate android-prototype project.");
            }
            // delete the copy at the end even if something failed
            finally { UnityEngine.Object.DestroyImmediate(clone); }
        }
    }
}
