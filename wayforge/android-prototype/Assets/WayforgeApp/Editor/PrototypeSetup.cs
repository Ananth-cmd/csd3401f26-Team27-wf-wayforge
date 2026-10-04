/*!
 * \file PrototypeSetup.cs
 * \brief Sets up, validates and builds the Wayforge Unity prototype.
 *
 * This file contains Unity Editor tools used to prepare the Wayforge prototype.
 * It sets the main scene, app name, Android settings, screen orientation,
 * scripting backend and version number.
 *
 * It also provides menu options to open the prototype, validate the building
 * data and build the Android APK. The validation checks that the prepared
 * Navigation asset exists and that the building data is valid before building.
 *
 * Links: Uses BuildingDefinition, CanvasShaderBuildGuard, PlayerSettings and
 * Unity's BuildPipeline to prepare and build the prototype.
 *
 * \author kervin ong guan cheng (kervinguancheng.ong@digipen.edu)
 *
 * Contribution: kervin ong guan cheng 100%
 * - Prototype setup and PlayerSettings configuration
 * - Android build setup
 * - Building data validation
 * - Unity Editor menu options
 * - APK build process
 *
 * AI declaration: Claude is used to help debug and test the code and comments.
 *
 * \date 2026-10-04
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

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
        // Main prototype scene used by the application.
        public const string ScenePath = "Assets/WayforgeApp/Scenes/Main.unity";

        // Opens the prototype scene from the Unity menu.
        [MenuItem("Wayforge App/Open prototype")]
        public static void Open()
        {
            // Apply the required prototype settings first.
            Setup();

            // Save any modified scene before opening the main prototype scene.
            if (EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) EditorSceneManager.OpenScene(ScenePath);
        }

        // Configures the Unity project for the Wayforge prototype.
        public static void Setup()
        {
            // Stop if the main scene cannot be found.
            if (!File.Exists(ScenePath)) throw new FileNotFoundException("Open the saved Main scene.", ScenePath);

            // Make sure the required canvas shader is included.
            CanvasShaderBuildGuard.EnsureIncluded();

            // Set the main prototype scene as the build scene.
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            // Basic application information.
            PlayerSettings.companyName = "Wayforge";
            PlayerSettings.productName = "PATH · SIT";

            // Set the Android application identifier.
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.Android, "com.wayforge.path.prototype");

            // Keep the prototype in portrait mode.
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;

            // Default screen size used by the prototype.
            PlayerSettings.defaultScreenWidth = 390; PlayerSettings.defaultScreenHeight = 844;

            // Set the minimum Android version supported.
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel26;

            // Build for 64-bit ARM Android devices.
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;

            // Use IL2CPP as the Android scripting backend.
            PlayerSettings.SetScriptingBackend(UnityEditor.Build.NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);

            // Prevent Unity engine code from being stripped.
            PlayerSettings.stripEngineCode = false;

            // Set the prototype version and Android build number.
            PlayerSettings.bundleVersion = "0.4.0";
            PlayerSettings.Android.bundleVersionCode = 5;

            // Save and refresh the Unity assets after changing settings.
            AssetDatabase.SaveAssets(); AssetDatabase.Refresh();
        }

        // Builds the Wayforge prototype as an Android APK.
        [MenuItem("Wayforge App/Build Android APK")]
        public static void BuildAndroid()
        {
            // Prepare the project and validate the building data before building.
            Setup(); Validate();

            // Create the Builds folder if it does not exist.
            Directory.CreateDirectory("Builds");

            // Start the Android build.
            var result = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = "Builds/Wayforge-SIT-Models-v0.4.apk",
                target = BuildTarget.Android,
                options = BuildOptions.Development | BuildOptions.CleanBuildCache
            });

            // Stop if Unity reports that the build failed.
            if (result.summary.result != BuildResult.Succeeded) throw new Exception("Android build failed: " + result.summary.result);

            // Print the final APK path to the Unity Console.
            Debug.Log("WAYFORGE_APK_OK " + Path.GetFullPath("Builds/Wayforge-SIT-Models-v0.4.apk"));
        }

        // Checks that the prepared building data exists and is valid.
        [MenuItem("Wayforge App/Validate prototype")]
        public static void Validate()
        {
            // Load the prepared navigation/building data.
            var building = AssetDatabase.LoadAssetAtPath<BuildingDefinition>("Assets/WayforgeApp/Models/WayForge/Prepared/Navigation.asset");

            // Stop if the building data is missing.
            if (!building) throw new Exception("The building data is missing.");

            // Run the building's own validation check.
            string error = building.ValidateData();

            // Stop if any validation error is found.
            if (error != null) throw new Exception(error);

            // Confirm successful validation in the Unity Console.
            Debug.Log("Building data is valid.");
        }
    }
}
