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
        public const string ScenePath = "Assets/WayforgeApp/Scenes/Main.unity";

        [MenuItem("Wayforge App/Open prototype")]
        public static void Open()
        {
            Setup();
            if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) EditorSceneManager.OpenScene(ScenePath);
        }
        public static void Setup()
        {
            if (!File.Exists(ScenePath)) throw new FileNotFoundException("Open the saved Main scene.", ScenePath);
            CanvasShaderBuildGuard.EnsureIncluded();
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
            var building = AssetDatabase.LoadAssetAtPath<BuildingDefinition>("Assets/WayforgeApp/Models/WayForge/Prepared/Navigation.asset");
            if (!building) throw new Exception("The building data is missing.");
            string error = building.ValidateData();
            if (error != null) throw new Exception(error);
            Debug.Log("Building data is valid.");
        }
    }
}
