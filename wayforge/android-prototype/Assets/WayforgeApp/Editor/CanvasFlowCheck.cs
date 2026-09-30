using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

namespace WayforgeApp.Editor
{
    [InitializeOnLoad]
    public static class CanvasFlowCheck
    {
        const string Flag = "Wayforge.CanvasCheck";
        static CanvasNavigator app;
        static Camera camera;
        static RenderTexture target;
        static double ready;
        static int phase, checks;
        static bool failed;
        static CanvasFlowCheck()
        {
            if (!SessionState.GetBool(Flag, false)) return;
            ready = EditorApplication.timeSinceStartup + 4;
            EditorApplication.update += Tick;
            Application.logMessageReceived += (message, trace, kind) => { if (kind == LogType.Exception || kind == LogType.Error || kind == LogType.Assert) failed = true; };
        }
        public static void Run()
        {
            PrototypeSetup.Setup(); PrototypeSetup.Validate();
            EditorSceneManager.OpenScene(CanvasDesigner.Scene);
            SessionState.SetBool(Flag, true); EditorApplication.isPlaying = true;
        }
        static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
            checks++; Debug.Log("CANVAS_PASS: " + message);
        }
        static void Click(string name)
        {
            var b = app.screens[(int)app.CurrentScreen].GetComponentsInChildren<Button>().First(x => x.name == name);
            Require(b.interactable && b.targetGraphic.raycastTarget && b.onClick.GetPersistentEventCount() > 0, "Saved button connection: " + name);
            b.onClick.Invoke();
        }
        static void Select(string query)
        {
            app.searchInput.text = query;
            var rows = app.searchResults.GetComponentsInChildren<PlaceCard>();
            Require(rows.Length == 1, "Typed search finds one place: " + query);
            rows[0].button.onClick.Invoke();
        }
        static void Capture(string name)
        {
            Canvas.ForceUpdateCanvases(); camera.Render();
            var previous = RenderTexture.active; RenderTexture.active = target;
            var png = new Texture2D(390, 844, TextureFormat.RGB24, false);
            png.ReadPixels(new Rect(0, 0, 390, 844), 0, 0); png.Apply();
            Directory.CreateDirectory("Documentation/Screenshots/Designer");
            File.WriteAllBytes("Documentation/Screenshots/Designer/" + name + ".png", png.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(png); RenderTexture.active = previous;
        }
        static void Tick()
        {
            if (!EditorApplication.isPlaying || EditorApplication.timeSinceStartup < ready) return;
            try
            {
                if (!app)
                {
                    app = UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>();
                    Require(app && !UnityEngine.Object.FindFirstObjectByType<NavigationApp>(), "Saved Canvas app starts without legacy UI");
                    target = new RenderTexture(390, 844, 24); target.Create();
                    camera = new GameObject("Screenshot camera").AddComponent<Camera>();
                    camera.targetTexture = target; camera.cullingMask = 1 << 5; camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.white;
                    var canvas = UnityEngine.Object.FindFirstObjectByType<Canvas>();
                    canvas.renderMode = RenderMode.ScreenSpaceCamera; canvas.worldCamera = camera; canvas.planeDistance = 1;
                    var mapCamera = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None).First(c => c.name.StartsWith("Building preview")); mapCamera.cullingMask = 1;
                    ready = EditorApplication.timeSinceStartup + 2; return;
                }
                switch (phase++)
                {
                    case 0:
                        Require(app.screens.Length == 9 && !app.findRouteButton.interactable, "Nine saved screens and incomplete journey disabled");
                        var button = app.screens[0].GetComponentsInChildren<Button>().First(b => b.name == "From card");
                        var rect = (RectTransform)button.transform;
                        var point = RectTransformUtility.WorldToScreenPoint(camera, rect.TransformPoint(rect.rect.center));
                        var results = new List<RaycastResult>();
                        EventSystem.current.RaycastAll(new PointerEventData(EventSystem.current) { position = point }, results);
                        Require(results.Count > 0 && results[0].gameObject.GetComponentInParent<Button>() == button, "Pointer hits the visible starting-location card");
                        Capture("01-home"); Click("From card"); Select("L1-01");
                        Require(app.CurrentScreen == AppScreen.Confirm && app.StartPlace == null, "Location requires explicit confirmation"); break;
                    case 1:
                        Capture("02-confirm"); Click("Confirm location"); Click("To card"); Select("board");
                        Require(app.findRouteButton.interactable, "Both inputs enable route planning"); Click("Find route");
                        app.stepFreeToggle.isOn = false;
                        Require(app.CurrentRoute != null && app.CurrentRoute.passages.Contains(Passage.Stairs), "Shortest route uses stairs"); break;
                    case 2:
                        Capture("03-route"); app.stepFreeToggle.isOn = true;
                        Require(app.CurrentRoute.passages.Contains(Passage.Lift) && !app.CurrentRoute.passages.Contains(Passage.Stairs), "Inspector-wired toggle calculates step-free route");
                        Click("Start navigation"); break;
                    case 3:
                        Capture("04-guide"); Click("Lost - update location"); Click("Back");
                        Require(app.CurrentScreen == AppScreen.Guide, "Cancelling location recovery retains guidance");
                        Click("Lost - update location"); Select("L1-01"); Click("Confirm location");
                        Require(app.CurrentScreen == AppScreen.Route, "Confirmed recovery recalculates route"); Click("Start navigation");
                        int safety = 0; while (app.CurrentScreen == AppScreen.Guide && safety++ < 100) Click("Confirm next landmark");
                        Require(app.CurrentScreen == AppScreen.Arrival && app.map.Floor == 2, "Checkpoint flow reaches destination floor and arrival"); break;
                    case 4:
                        Capture("05-arrival"); Click("Finish journey");
                        Require(app.StartPlace.id == "L3-02" && app.Destination == null, "Completed journey becomes new start");
                        Click("To card"); Select("L3-02"); Click("Find route"); Click("Start navigation");
                        Require(app.CurrentScreen == AppScreen.Arrival, "Same-location route arrives immediately");
                        app.Home(); Click("To card"); app.searchInput.text = "no-such-room";
                        Require(app.searchEmpty.gameObject.activeSelf, "Unknown search has helpful empty state");
                        Click("Back"); Click("Settings"); break;
                    case 5:
                        Capture("06-settings"); app.Home();
                        var headline = app.screens[0].GetComponentsInChildren<Text>().First(t => t.name == "Headline - edit me");
                        headline.text = "Designer edited title"; app.Settings(); app.Home();
                        Require(headline.text == "Designer edited title", "Behaviour preserves manually edited static text");
                        Require(!failed, "No runtime errors");
                        Debug.Log("CANVAS_FLOW_OK: " + checks + " checks passed");
                        SessionState.SetBool(Flag, false); EditorApplication.Exit(0); return;
                }
                ready = EditorApplication.timeSinceStartup + 1;
            }
            catch (Exception e)
            {
                Debug.LogException(e); SessionState.SetBool(Flag, false); EditorApplication.Exit(1);
            }
        }
    }
}

