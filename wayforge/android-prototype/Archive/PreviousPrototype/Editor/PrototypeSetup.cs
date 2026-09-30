using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace WayforgeApp.Editor
{
    
    public static class PrototypeSetup
    {
        public const string ScenePath = CanvasDesigner.Scene;

        [MenuItem("Wayforge App/Open prototype")]
        public static void Open()
        {
            Setup();
            if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) EditorSceneManager.OpenScene(ScenePath);
        }
        public static void Setup()
        {
            Directory.CreateDirectory("Assets/WayforgeApp/Scenes");
            Directory.CreateDirectory("Assets/WayforgeApp/Resources");
            CanvasDesigner.CreateOnce();
            CanvasShaderBuildGuard.EnsureIncluded();
            const string matPath = "Assets/WayforgeApp/Resources/MapMaterial.mat";
            if (!AssetDatabase.LoadAssetAtPath<Material>(matPath)) AssetDatabase.CreateAsset(new Material(Shader.Find("Standard")), matPath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            PlayerSettings.companyName = "Wayforge";
            PlayerSettings.productName = "PATH · SIT";
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.wayforge.path.prototype");
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.defaultScreenWidth = 390; PlayerSettings.defaultScreenHeight = 844;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel26;
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.stripEngineCode = false;
            PlayerSettings.bundleVersion = "0.4.0";
            PlayerSettings.Android.bundleVersionCode = 5;
            AssetDatabase.SaveAssets(); AssetDatabase.Refresh();
        }
        [MenuItem("Wayforge App/Build Android APK")]
        public static void BuildAndroid()
        {
            Setup(); Validate();
            Directory.CreateDirectory("Builds");
            var result = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath }, locationPathName = "Builds/Wayforge-SIT-Models-v0.4.apk",
                target = BuildTarget.Android, options = BuildOptions.Development | BuildOptions.CleanBuildCache
            });
            if (result.summary.result != BuildResult.Succeeded) throw new Exception("Android build failed: " + result.summary.result);
            Debug.Log("WAYFORGE_APK_OK " + Path.GetFullPath("Builds/Wayforge-SIT-Models-v0.4.apk"));
        }
        [MenuItem("Wayforge App/Validate prototype")]
        public static void Validate()
        {
            var b = DemoBuilding.Create();
            Check(b.ValidateData() == null, "Demo data is valid");
            var shortest = RoutePlanner.Find(b, "L1-01", "L3-02", false);
            var accessible = RoutePlanner.Find(b, "L1-01", "L3-02", true);
            Check(shortest != null && shortest.passages.Contains(Passage.Stairs), "Shortest route uses stairs");
            Check(accessible != null && !accessible.passages.Contains(Passage.Stairs) && accessible.passages.Contains(Passage.Lift), "Step-free route avoids stairs");
            Check(accessible.metres > shortest.metres, "Different routes have computed distances");
            Check(RoutePlanner.Find(b, "L1-01", "L1-01", false).nodes.Count == 1, "Already at destination");
            Check(RoutePlanner.Find(b, "missing", "L1-01", false) == null, "Unknown start is rejected");
            foreach (var e in b.connections.Where(e => e.passage == Passage.Lift)) e.blocked = true;
            Check(RoutePlanner.Find(b, "L1-01", "L3-02", true) == null, "No step-free route when lifts are blocked");
            Check(RoutePlanner.Find(b, "L1-01", "L3-02", false) != null, "Stairs remain available");
            foreach (var e in b.connections) e.blocked = true;
            Check(RoutePlanner.Find(b, "L1-01", "L3-02", false) == null, "Disconnected destination is rejected");
            b.waypoints[1].id = b.waypoints[0].id;
            Check(b.ValidateData() != null, "Duplicate waypoint IDs are rejected");
            UnityEngine.Object.DestroyImmediate(b);
            var custom = Resources.Load<BuildingDefinition>("Building");
            if (custom) Check(custom.ValidateData() == null, custom.ValidateData() ?? "Imported building is valid");
            foreach (string icon in new[] { "search", "locate", "chevron", "pin", "map", "saved", "settings", "back", "close", "arrow", "check", "walk" })
                Check(Resources.Load<Texture2D>("Icons/" + icon) != null, "Figma icon: " + icon);
            Debug.Log("WAYFORGE_VALIDATION_OK: routing and local Figma assets passed.");
        }
        static void Check(bool ok, string message) { if (!ok) throw new Exception("Validation failed: " + message); Debug.Log("PASS: " + message); }

        [MenuItem("Wayforge App/Use selected model as building")]
        public static void UseSelectedModel()
        {
            var model = Selection.activeObject as GameObject;
            if (!model || !EditorUtility.IsPersistent(model)) throw new InvalidOperationException("Select an imported model prefab in the Project window.");
            const string path = "Assets/WayforgeApp/Resources/Building.asset";
            if (AssetDatabase.LoadAssetAtPath<BuildingDefinition>(path)) throw new InvalidOperationException("A Building asset already exists. Edit its floors in the Inspector to add or replace a model.");
            var b = ScriptableObject.CreateInstance<BuildingDefinition>();
            b.buildingName = model.name; b.illustrative = false;
            b.floors = new[] { new FloorDefinition { name = "Level 1", model = model } };
            var rooms = model.GetComponentsInChildren<Transform>(true).Where(t => t.name.StartsWith("Room ", StringComparison.Ordinal)).ToArray();
            if (rooms.Length == 0) rooms = new[] { model.transform };
            b.waypoints = rooms.Select((t, i) =>
            {
                var renderer = t.GetComponentsInChildren<MeshRenderer>().FirstOrDefault(r => r.name == "Floor") ?? t.GetComponentInChildren<MeshRenderer>();
                Vector3 centre = renderer ? model.transform.InverseTransformPoint(renderer.bounds.center) : Vector3.zero;
                centre.y += .15f;
                return new Waypoint { id = "room-" + i, label = t.name, floor = 0, position = centre };
            }).ToArray();
            b.places = b.waypoints.Select((n, i) => new Place { id = n.id, name = n.label.Replace("Room ", ""), code = "R" + (i + 1), waypointId = n.id, description = "Room from your converted floor plan." }).ToArray();
            AssetDatabase.CreateAsset(b, path); AssetDatabase.SaveAssets(); Selection.activeObject = b;
            Debug.Log("Model integrated. Add surveyed corridor/doorway waypoints and connections in the Building Inspector to enable routing. No links through walls are guessed.");
        }
    }
}

