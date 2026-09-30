using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UIElements;

namespace WayforgeApp.Editor
{
    [InitializeOnLoad]
    public static class PrototypeVisualCheck
    {
        const string Flag = "Wayforge.VisualCheck";
        static NavigationApp app;
        static RenderTexture target;
        static double readyAt;
        static int phase;
        static bool failed;
        static readonly BindingFlags Private = BindingFlags.NonPublic | BindingFlags.Instance;
        static PrototypeVisualCheck()
        {
            if (SessionState.GetBool(Flag, false))
            {
                readyAt = EditorApplication.timeSinceStartup + 5;
                EditorApplication.update += Tick;
                Application.logMessageReceived += (condition, trace, kind) => { if (kind == LogType.Exception || kind == LogType.Error || kind == LogType.Assert) failed = true; };
            }
        }
        public static void Run()
        {
            PrototypeSetup.Setup(); PrototypeSetup.Validate();
            SessionState.SetBool(Flag, true);
            EditorSceneManager.OpenScene("Assets/WayforgeApp/Scenes/Navigation.unity");
            EditorApplication.isPlaying = true;
        }
        static void Set(string field, object value) => typeof(NavigationApp).GetField(field, Private).SetValue(app, value);
        static T Get<T>(string field) => (T)typeof(NavigationApp).GetField(field, Private).GetValue(app);
        static void Show(string screen) => typeof(NavigationApp).GetMethod("Show", Private).Invoke(app, new object[] { screen });
        static VisualElement Root => app.GetComponent<UIDocument>().rootVisualElement;
        static void Type(string query) => Root.Q<TextField>().value = query;
        static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
            Debug.Log("FLOW_PASS: " + message);
        }
        static void Advance()
        {
            var route = Get<Route>("route"); int step = Get<int>("step");
            var a = route.nodes[step]; var b = route.nodes[step + 1];
            Click(a.floor != b.floor ? "I'm on " + Get<BuildingDefinition>("building").floors[b.floor].name + " →" : "I'm at " + b.label + " →");
        }
        static void Click(string text)
        {
            var b = app.GetComponent<UIDocument>().rootVisualElement.Query<Button>().ToList().FirstOrDefault(x => x.text == text || x.Query<Label>().ToList().Any(l => l.text == text));
            if (b == null || !b.enabledInHierarchy) throw new Exception("Missing or disabled button: " + text);
            // Exercise the button's real Clickable callback without relying on Game-view keyboard focus in batch mode.
            var simulate = typeof(Clickable).GetMethod("SimulateSingleClick", BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance);
            simulate.Invoke(b.clickable, new object[] { null, 0 });
        }
        static void Capture(string name)
        {
            var before = RenderTexture.active; RenderTexture.active = target;
            var png = new Texture2D(target.width, target.height, TextureFormat.RGB24, false);
            png.ReadPixels(new Rect(0, 0, target.width, target.height), 0, 0); png.Apply();
            Directory.CreateDirectory("Documentation/Screenshots"); File.WriteAllBytes("Documentation/Screenshots/" + name + ".png", png.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(png); RenderTexture.active = before;
        }
        static void Tick()
        {
            if (!EditorApplication.isPlaying || EditorApplication.timeSinceStartup < readyAt) return;
            try
            {
                if (!app)
                {
                    app = UnityEngine.Object.FindFirstObjectByType<NavigationApp>();
                    if (!app) throw new Exception("App did not start.");
                    target = new RenderTexture(390, 844, 24); target.Create();
                    app.GetComponent<UIDocument>().panelSettings.targetTexture = target;
                    readyAt = EditorApplication.timeSinceStartup + 3; return;
                }
                var building = Get<BuildingDefinition>("building");
                switch (phase++)
                {
                    case 0:
                        Require(building.buildingName == "SIT", "SIT branding");
                        Require(!Root.Q<Button>(className: "primary").enabledSelf, "Incomplete journey disabled");
                        Capture("01-explore"); Click("Enter your destination");
                        Type("  board  "); Click("Board Room");
                        Require(Get<string>("screen") == "Explore" && Get<Place>("selected").name == "Board Room", "Typed destination selected");
                        Require(!Root.Q<Button>(className: "primary").enabledSelf, "Start still required");
                        Click("Enter your current location"); Type("main"); Click("Main entrance"); break;
                    case 1:
                        Require(Get<Place>("start") == null, "Unconfirmed location is not applied");
                        Capture("03-confirm-start"); Click("");
                        Require(Get<string>("screen") == "Manual", "Confirmation Back returns to search");
                        Type("L1-01"); Click("Main entrance"); Click("Yes, I'm here →");
                        Require(Get<string>("screen") == "Explore" && Get<Place>("start").code == "L1-01", "Confirmed start returns to planner");
                        Click("Find route →"); Click("Shortest"); break;
                    case 2:
                        Require(Get<Route>("route").passages.Contains(Passage.Stairs), "Shortest route uses stairs");
                        Capture("04-shortest-route"); Click("Step-free"); break;
                    case 3:
                        Require(!Get<Route>("route").passages.Contains(Passage.Stairs), "Step-free excludes stairs");
                        Capture("05-step-free-route"); Click("Start navigation →"); break;
                    case 4:
                        Capture("06-guide"); Advance();
                        int previousStep = Get<int>("step");
                        Click(Get<bool>("topDown") ? "3D" : "2D"); Click(Get<bool>("topDown") ? "3D" : "2D");
                        Require(Get<int>("step") == previousStep, "Map view toggle preserves progress");
                        Click("I'm lost / update my location"); Type("reception"); Click("Reception"); Click("Yes, I'm here →");
                        Require(Get<string>("screen") == "Route" && Get<Route>("route").nodes[0].id == "L1-02", "Recovery reroutes from confirmed location");
                        Click("Start navigation →"); break;
                    case 5:
                        while (Get<string>("screen") == "Guide") Advance();
                        Require(Get<string>("screen") == "Arrived", "Every landmark and floor leads to arrival"); break;
                    case 6:
                        Capture("07-arrived");
                        bool saved = Root.Query<Button>().ToList().Any(b => b.text == "Remove from saved places");
                        Click(saved ? "Remove from saved places" : "Save this place");
                        Click(saved ? "Save this place" : "Remove from saved places");
                        Click("Done · Explore");
                        Require(Get<Place>("start").name == "Board Room" && Get<Place>("selected") == null, "Arrival sets new current location");
                        Click("Enter your destination"); Type("board"); Click("Board Room"); Click("Find route →");
                        Require(Get<Route>("route").nodes.Count == 1, "Same start and destination");
                        Click("Start navigation →"); Require(Get<string>("screen") == "Arrived", "Already-here arrival");
                        Click("Done · Explore"); Click("Enter your destination"); Type("no-such-room"); break;
                    case 7:
                        Require(Root.Query<Label>().ToList().Any(l => l.text == "No matching places"), "Unmatched input handled");
                        Capture("08-empty-search"); Type("main"); Click("Main entrance"); Click("Find route →");
                        // Test unavailable routing without inventing links through walls.
                        foreach (var edge in building.connections) edge.blocked = true;
                        Click("Step-free"); Require(Get<Route>("route") == null, "Unavailable route handled");
                        Require(!Root.Query<Button>().ToList().Any(b => b.text == "Start navigation →"), "Cannot start unavailable route");
                        foreach (var edge in building.connections) edge.blocked = false;
                        Click("Shortest"); Require(Get<Route>("route") != null, "Route recovers after reopening links");
                        Click("Main entrance"); Type("pantry"); Click("Pantry");
                        Require(Get<Place>("selected").name == "Pantry" && Get<string>("screen") == "Route", "Destination can be changed from route");
                        Show("Settings"); break;
                    case 8:
                        Capture("09-settings");
                        Click("Current location"); Type("reception"); Click("Reception"); Click("Yes, I'm here →");
                        Require(Get<string>("screen") == "Settings", "Settings location edit returns correctly");
                        Show("Explore"); break;
                    case 9:
                        Capture("10-planner-ready");
                        SessionState.SetBool(Flag, false); EditorApplication.update -= Tick;
                        Debug.Log(failed ? "WAYFORGE_VISUAL_FAILED: runtime errors occurred" : "WAYFORGE_VISUAL_OK: typed inputs, route edits, recovery, floor changes, arrival, saved buttons and empty/unavailable states passed");
                        EditorApplication.Exit(failed ? 1 : 0); return;
                }
                readyAt = EditorApplication.timeSinceStartup + 2;
            }
            catch (Exception e)
            {
                SessionState.SetBool(Flag, false); Debug.LogException(e); EditorApplication.Exit(1);
            }
        }
    }
}

