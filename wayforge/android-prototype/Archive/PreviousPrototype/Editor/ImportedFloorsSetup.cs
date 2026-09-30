using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace WayforgeApp.Editor
{
    public static class ImportedFloorsSetup
    {
        public const string Root = "Assets/WayforgeApp/ImportedModels/WayForge";
        public static void Inspect()
        {
            AssetDatabase.Refresh();
            Directory.CreateDirectory(Root + "/Prepared");
            Directory.CreateDirectory("Documentation/Screenshots/ImportedModels");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var mat = AssetDatabase.LoadAssetAtPath<Material>(Root + "/Prepared/Model walls.mat");
            if (!mat) { mat = new Material(Shader.Find("Standard")); AssetDatabase.CreateAsset(mat, Root + "/Prepared/Model walls.mat"); }
            mat.color = BuildingMap.Hex("CBE4DB");
            mat.SetFloat("_Glossiness", 0);
            var floorMat = AssetDatabase.LoadAssetAtPath<Material>(Root + "/Prepared/Model floors.mat");
            if (!floorMat) { floorMat = new Material(Shader.Find("Standard")); AssetDatabase.CreateAsset(floorMat, Root + "/Prepared/Model floors.mat"); }
            floorMat.color = BuildingMap.Hex("658D85"); floorMat.SetFloat("_Glossiness",0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = Color.gray;
            var light = new GameObject("Light").AddComponent<Light>(); light.type = LightType.Directional; light.transform.rotation = Quaternion.Euler(50,-30,0);
            var camera = new GameObject("Preview").AddComponent<Camera>(); camera.orthographic = true; camera.backgroundColor = BuildingMap.Hex("EAF1EF"); camera.clearFlags = CameraClearFlags.SolidColor;
            var rt = new RenderTexture(1024,1024,24); camera.targetTexture = rt;
            for (int level = 1; level <= 3; level++)
            {
                string path = Root + "/Level " + level + ".obj";
                var importer = (ModelImporter)AssetImporter.GetAtPath(path);
                importer.globalScale = .05f; importer.isReadable = true; importer.addCollider = false; importer.SaveAndReimport();
                var root = new GameObject("Level " + level + " - supplied model");
                var model = (GameObject)PrefabUtility.InstantiatePrefab(AssetDatabase.LoadAssetAtPath<GameObject>(path)); model.transform.SetParent(root.transform, false);
                var renderers = model.GetComponentsInChildren<Renderer>();
                Bounds bounds = renderers[0].bounds; foreach(var r in renderers) { bounds.Encapsulate(r.bounds); r.sharedMaterials = r.sharedMaterials.Select(_ => r.bounds.size.y < .3f ? floorMat : mat).ToArray(); }
                model.transform.position -= new Vector3(bounds.center.x,bounds.min.y,bounds.center.z);
                foreach(var component in model.GetComponentsInChildren<Component>()) if(component && PrefabUtility.IsPartOfPrefabInstance(component)) PrefabUtility.RecordPrefabInstancePropertyModifications(component);
                PrefabUtility.SaveAsPrefabAsset(root, Root + "/Prepared/Level " + level + ".prefab");
                Debug.Log("IMPORTED_FLOOR " + level + " size=" + bounds.size);
                foreach(var r in renderers) Debug.Log("MODEL_PART " + level + " " + r.name + " center=" + r.bounds.center.ToString("F3") + " size=" + r.bounds.size.ToString("F3"));
                camera.transform.position = new Vector3(0,80,0); camera.transform.rotation = Quaternion.Euler(90,0,0); camera.orthographicSize = Mathf.Max(bounds.size.x,bounds.size.z)*.56f;
                camera.Render(); RenderTexture.active = rt;
                var png = new Texture2D(1024,1024,TextureFormat.RGB24,false); png.ReadPixels(new Rect(0,0,1024,1024),0,0); png.Apply();
                File.WriteAllBytes("Documentation/Screenshots/ImportedModels/Level-"+level+".png",png.EncodeToPNG()); Object.DestroyImmediate(png);
                Object.DestroyImmediate(root);
            }
            RenderTexture.active = null; camera.targetTexture = null; Object.DestroyImmediate(rt);
            AssetDatabase.SaveAssets(); Debug.Log("MODEL_INSPECTION_OK");
        }
    }
}
