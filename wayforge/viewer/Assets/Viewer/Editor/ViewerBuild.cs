/*!
 * \file ViewerBuild.cs
 * \brief Scene setup, WebGL player settings and the WebGL build for the viewer
 *
 * Menu: Wayforge > Set Up Viewer Scene, Wayforge > Build WebGL Viewer.
 * Command line (no editor window):
 *   Unity -batchmode -quit -projectPath viewer -executeMethod Wayforge.Viewer.EditorTools.ViewerBuild.BuildFromCommandLine [-buildPath <dir>]
 *
 * SetUpScene() creates the materials and Scenes/Viewer.unity (camera with
 * CameraRig, light, and the "WayforgeViewer" object the page talks to), so
 * the scene can always be regenerated from code; it runs automatically when
 * the project is opened without a scene (they are not in git). ConfigurePlayer() sets the
 * WebGL options that keep the download small (gzip with decompression
 * fallback, IL2CPP size optimisation, high stripping, engine code stripping)
 * and selects the Wayforge page template. Build() writes the player to
 * Build/WebGL (or -buildPath) plus viewer-build.js, which tells the page
 * scripts the generated file names.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Reproducible scene / material setup, WebGL size settings, scripted build
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Wayforge.Viewer.EditorTools
{
    [InitializeOnLoad]
    public static class ViewerBuild
    {
        const string Root = "Assets/Viewer";
        const string ScenePath = Root + "/Scenes/Viewer.unity";
        const string MaterialDir = Root + "/Materials";
        const string DefaultBuildDir = "Build/WebGL";

        // The scene and materials are not in git; create them the first time the project is opened.
        static ViewerBuild()
        {
            EditorApplication.delayCall += () =>
            {
                if (!File.Exists(ScenePath) && !EditorApplication.isPlayingOrWillChangePlaymode) SetUpScene();
            };
        }

        // --- scene ---------------------------------------------------------------------------

        [MenuItem("Wayforge/Set Up Viewer Scene")]
        public static void SetUpScene()
        {
            Directory.CreateDirectory(MaterialDir);
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));

            var standard = Shader.Find("Standard");
            var wall = MakeMaterial("Wall", standard, new Color(0.66f, 0.68f, 0.72f));
            var floor = MakeMaterial("Floor", standard, Color.white);
            var stair = MakeMaterial("Stair", standard, new Color(0.96f, 0.62f, 0.28f));
            var lift = MakeMaterial("Lift", standard, new Color(0.45f, 0.5f, 0.95f));
            var marker = MakeMaterial("Marker", standard, Color.white);
            var line = MakeMaterial("RouteLine", Shader.Find("Unlit/Color"), new Color(1f, 0.42f, 0.08f));
            var label = MakeMaterial("Label", AssetDatabase.LoadAssetAtPath<Shader>(Root + "/Shaders/Label.shader"), Color.white);
            var exterior = MakeMaterial("ExteriorWall", standard, new Color(0.80f, 0.74f, 0.64f));
            var frame = MakeMaterial("Frame", standard, new Color(0.24f, 0.26f, 0.29f));
            var door = MakeMaterial("Door", standard, new Color(0.55f, 0.38f, 0.24f));
            var roof = MakeMaterial("Roof", standard, new Color(0.42f, 0.44f, 0.47f));
            var ground = MakeMaterial("Ground", standard, new Color(0.52f, 0.58f, 0.48f));
            var glass = MakeMaterial("Glass", standard, new Color(0.62f, 0.80f, 0.92f, 0.35f));
            MakeTransparent(glass);
            glass.SetFloat("_Glossiness", 0.9f);
            foreach (var m in new[] { wall, floor, stair, lift, marker, exterior, frame, door, roof, ground }) m.SetFloat("_Glossiness", 0.1f);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            RenderSettings.skybox = null;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.46f, 0.47f, 0.50f);
            RenderSettings.ambientEquatorColor = new Color(0.36f, 0.37f, 0.39f);
            RenderSettings.ambientGroundColor = new Color(0.24f, 0.24f, 0.25f);

            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camGo.AddComponent<Camera>();
            cam.clearFlags = CameraClearFlags.SolidColor;
            cam.backgroundColor = new Color(0.66f, 0.78f, 0.90f);   // sky
            cam.fieldOfView = 45f;
            var rig = camGo.AddComponent<CameraRig>();

            var lightGo = new GameObject("Sun");
            var light = lightGo.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 0.65f;
            light.shadows = LightShadows.Soft;
            light.shadowStrength = 0.55f;
            QualitySettings.shadowDistance = 250f;
            lightGo.transform.rotation = Quaternion.Euler(55f, -35f, 0f);

            var viewerGo = new GameObject("WayforgeViewer");       // name used by SendMessage from the page
            var building = viewerGo.AddComponent<BuildingView>();
            var route = viewerGo.AddComponent<RouteView>();
            var api = viewerGo.AddComponent<ViewerApi>();

            Set(building, "wallMaterial", wall);
            Set(building, "floorMaterial", floor);
            Set(building, "stairMaterial", stair);
            Set(building, "liftMaterial", lift);
            Set(building, "exteriorWallMaterial", exterior);
            Set(building, "glassMaterial", glass);
            Set(building, "frameMaterial", frame);
            Set(building, "doorMaterial", door);
            Set(building, "roofMaterial", roof);
            Set(building, "groundMaterial", ground);
            Set(building, "labelFont", Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"));
            Set(building, "labelMaterial", label);
            Set(route, "lineMaterial", line);
            Set(route, "markerMaterial", marker);
            Set(api, "building", building);
            Set(api, "route", route);
            Set(api, "cameraRig", rig);

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            ConfigurePlayer();
            AssetDatabase.SaveAssets();
            Debug.Log("[viewer] scene set up: " + ScenePath);
        }

        // Standard shader in Transparent mode (the keywords and blend state its inspector would set).
        static void MakeTransparent(Material m)
        {
            m.SetFloat("_Mode", 3f);
            m.SetInt("_SrcBlend", (int)BlendMode.One);
            m.SetInt("_DstBlend", (int)BlendMode.OneMinusSrcAlpha);
            m.SetInt("_ZWrite", 0);
            m.DisableKeyword("_ALPHATEST_ON");
            m.DisableKeyword("_ALPHABLEND_ON");
            m.EnableKeyword("_ALPHAPREMULTIPLY_ON");
            m.renderQueue = (int)RenderQueue.Transparent;
            EditorUtility.SetDirty(m);
        }

        static Material MakeMaterial(string name, Shader shader, Color colour)
        {
            string path = $"{MaterialDir}/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                mat = new Material(shader) { name = name };
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = shader;
            mat.color = colour;
            EditorUtility.SetDirty(mat);
            return mat;
        }

        static void Set(UnityEngine.Object target, string field, UnityEngine.Object value)
        {
            var so = new SerializedObject(target);
            var prop = so.FindProperty(field);
            if (prop == null) throw new InvalidOperationException($"{target.GetType().Name} has no field '{field}'");
            prop.objectReferenceValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        // --- player settings -----------------------------------------------------------------

        public static void ConfigurePlayer()
        {
            PlayerSettings.companyName = "Wayforge";
            PlayerSettings.productName = "Wayforge Viewer";
            PlayerSettings.bundleVersion = "1.0";
            PlayerSettings.runInBackground = true;

            PlayerSettings.WebGL.template = "PROJECT:Wayforge";
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
            PlayerSettings.WebGL.decompressionFallback = true;     // works on any static host, no server config needed
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.nameFilesAsHashes = false;
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;

            var web = NamedBuildTarget.WebGL;
            PlayerSettings.SetManagedStrippingLevel(web, ManagedStrippingLevel.High);
            PlayerSettings.SetIl2CppCodeGeneration(web, Il2CppCodeGeneration.OptimizeSize);
            PlayerSettings.stripEngineCode = true;
        }

        // --- build ---------------------------------------------------------------------------

        [MenuItem("Wayforge/Build WebGL Viewer")]
        public static void BuildMenu() => Build(DefaultBuildDir);

        public static void BuildFromCommandLine()
        {
            var args = Environment.GetCommandLineArgs();
            int i = Array.IndexOf(args, "-buildPath");
            string dir = i >= 0 && i + 1 < args.Length ? args[i + 1] : DefaultBuildDir;
            bool ok = Build(dir);
            EditorApplication.Exit(ok ? 0 : 1);
        }

        public static bool Build(string outputDir)
        {
            if (!BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL))
            {
                Debug.LogError("[viewer] WebGL Build Support is not installed for this Unity version (Unity Hub > Installs > Add modules).");
                return false;
            }
            SetUpScene();

            var options = new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = outputDir,
                target = BuildTarget.WebGL,
                targetGroup = BuildTargetGroup.WebGL,
                options = BuildOptions.None,
            };
            BuildReport report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
            {
                Debug.LogError($"[viewer] build failed: {report.summary.result}, {report.summary.totalErrors} error(s)");
                return false;
            }
            WriteBuildInfo(outputDir);
            Debug.Log($"[viewer] build done: {Path.GetFullPath(outputDir)} ({report.summary.totalSize / (1024f * 1024f):0.0} MB)");
            return true;
        }

        // viewer-build.js: the generated file names, so index.html / test.html / wayforge-viewer.js need no build tags.
        static void WriteBuildInfo(string outputDir)
        {
            string buildDir = Path.Combine(outputDir, "Build");
            string Find(string marker)
            {
                var file = Directory.GetFiles(buildDir).Select(Path.GetFileName).FirstOrDefault(f => f.Contains(marker));
                if (file == null) throw new FileNotFoundException($"no '{marker}' file in {buildDir}");
                return "Build/" + file;
            }
            string js =
                "// Generated by ViewerBuild.cs after each WebGL build. Do not edit.\n" +
                "window.WAYFORGE_VIEWER_BUILD = {\n" +
                $"  loaderUrl: \"{Find(".loader.js")}\",\n" +
                $"  dataUrl: \"{Find(".data")}\",\n" +
                $"  frameworkUrl: \"{Find(".framework.js")}\",\n" +
                $"  codeUrl: \"{Find(".wasm")}\",\n" +
                $"  companyName: \"{PlayerSettings.companyName}\",\n" +
                $"  productName: \"{PlayerSettings.productName}\",\n" +
                $"  productVersion: \"{PlayerSettings.bundleVersion}\"\n" +
                "};\n";
            File.WriteAllText(Path.Combine(outputDir, "viewer-build.js"), js);
        }
    }
}
