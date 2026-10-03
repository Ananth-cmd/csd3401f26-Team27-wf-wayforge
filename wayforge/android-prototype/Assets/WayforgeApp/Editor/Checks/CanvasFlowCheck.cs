/*!
 * \file CanvasFlowCheck.cs
 * \brief Automatic test that plays the app and clicks through a whole journey
 *
 * Runs in the Unity editor. It sets up the prototype scene, enters play mode,
 * then goes through the app one step at a time like a user would: pick a
 * start, confirm it, pick a destination, find a route, switch to step-free,
 * follow the guidance, get lost and recover, arrive, and open settings. Each
 * step has a check that throws if something is wrong. It saves a screenshot of
 * each main screen and exits with 0 if everything passed or 1 if anything
 * failed, so it can run from the command line.
 *
 * Links: PrototypeSetup builds and validates the scene; CanvasNavigator is the
 * app being tested; PlaceCard is what the search results are made of.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan
 *   - Starting the check and surviving the play mode reload
 *   - The click, search and check helpers
 *   - The step by step journey and the screenshots
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-10-04
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

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
    //InitializeOnLoad runs the static constructor again after every reload, entering play mode reloads
    [InitializeOnLoad]
    public static class CanvasFlowCheck
    {
        //SessionState remembers we are in a check run, normal variables are wiped by the reload
        const string Flag = "Wayforge.CanvasCheck";
        static CanvasNavigator app;
        static Camera camera;
        static RenderTexture target;
        //time we wait for before the next step
        static double ready;
        //phase is which step we are on, checks counts the passes
        static int phase, checks;
        static bool failed;
        //only carries on if Run started this, so opening the editor normally does nothing
        static CanvasFlowCheck()
        {
            if (!SessionState.GetBool(Flag, false)) return;
            ready = EditorApplication.timeSinceStartup + 4;
            EditorApplication.update += Tick;
            //any error or exception in the console counts as a fail
            Application.logMessageReceived += (message, trace, kind) => { if (kind == LogType.Exception || kind == LogType.Error || kind == LogType.Assert) failed = true; };
        }
        //start here (menu or command line), sets up the scene then enters play mode
        public static void Run()
        {
            PrototypeSetup.Setup(); PrototypeSetup.Validate();
            EditorSceneManager.OpenScene(PrototypeSetup.ScenePath);
            SessionState.SetBool(Flag, true); EditorApplication.isPlaying = true;
        }
        //throws if the check is false (caught in Tick), otherwise counts it as a pass
        static void Require(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
            checks++; Debug.Log("CANVAS_PASS: " + message);
        }
        //finds a button by name on the current screen and presses it, first checks it is really hooked up in the inspector
        static void Click(string name)
        {
            var b = app.screens[(int)app.CurrentScreen].GetComponentsInChildren<Button>().First(x => x.name == name);
            Require(b.interactable && b.targetGraphic.raycastTarget && b.onClick.GetPersistentEventCount() > 0, "Saved button connection: " + name);
            b.onClick.Invoke();
        }
        //types in the search box, expects exactly one result, taps it
        static void Select(string query)
        {
            app.searchInput.text = query;
            var rows = app.searchResults.GetComponentsInChildren<PlaceCard>();
            Require(rows.Length == 1, "Typed search finds one place: " + query);
            rows[0].button.onClick.Invoke();
        }
        //draws the UI into the render texture, reads the pixels back and saves a png
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
        //runs every editor update, first time sets up the camera, after that does one step per call with a wait in between
        static void Tick()
        {
            if (!EditorApplication.isPlaying || EditorApplication.timeSinceStartup < ready) return;
            try
            {
                if (!app)
                {
                    app = UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>();
                    Require(app && UnityEngine.Object.FindObjectsByType<CanvasNavigator>(FindObjectsSortMode.None).Length == 1, "Scene starts with one app controller");
                    target = new RenderTexture(390, 844, 24); target.Create();
                    //layer 5 is the UI layer, so this camera only sees the UI
                    camera = new GameObject("Screenshot camera").AddComponent<Camera>();
                    camera.targetTexture = target; camera.cullingMask = 1 << 5; camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.white;
                    var canvas = UnityEngine.Object.FindFirstObjectByType<Canvas>();
                    canvas.renderMode = RenderMode.ScreenSpaceCamera; canvas.worldCamera = camera; canvas.planeDistance = 1;
                    //the map has its own camera, set to the default layer so it only draws the map
                    var mapCamera = UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None).First(c => c.targetTexture == app.map.Texture); mapCamera.cullingMask = 1;
                    ready = EditorApplication.timeSinceStartup + 2; return;
                }
                switch (phase++)
                {
                    case 0:
                        Require(app.screens.Length == 9 && !app.findRouteButton.interactable, "Nine saved screens and incomplete journey disabled");
                        var button = app.screens[0].GetComponentsInChildren<Button>().First(b => b.name == "From card");
                        var rect = (RectTransform)button.transform;
                        //fires a real pointer ray at the middle of the card to check nothing is covering it
                        var point = RectTransformUtility.WorldToScreenPoint(camera, rect.TransformPoint(rect.rect.center));
                        var results = new List<RaycastResult>();
                        EventSystem.current.RaycastAll(new PointerEventData(EventSystem.current) { position = point }, results);
                        Require(results.Count > 0 && results[0].gameObject.GetComponentInParent<Button>() == button, "Pointer hits the visible starting-location card");
                        Capture("01-home"); Click("From card"); Select("L1-01");
                        Require(app.CurrentScreen == AppScreen.Confirm && app.StartPlace == null, "Location requires explicit confirmation"); break;
                    case 1:
                        Capture("02-confirm"); Click("Confirm location"); Click("To card"); Select("L3-02");
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
                        //keeps tapping next landmark until arrival, safety stops it looping forever
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
                        //edits a title by hand, then leaves and comes back to check the app doesnt overwrite it
                        var headline = app.screens[0].GetComponentsInChildren<Text>().First(t => t.name == "Headline");
                        headline.text = "Designer edited title"; app.Settings(); app.Home();
                        Require(headline.text == "Designer edited title", "Behaviour preserves manually edited static text");
                        Require(!failed, "No runtime errors");
                        //exit code 0 means all passed, used by the command line run
                        Debug.Log("CANVAS_FLOW_OK: " + checks + " checks passed");
                        SessionState.SetBool(Flag, false); EditorApplication.Exit(0); return;
                }
                ready = EditorApplication.timeSinceStartup + 1;
            }
            //any failed Require lands here, exit code 1 means the check failed
            catch (Exception e)
            {
                Debug.LogException(e); SessionState.SetBool(Flag, false); EditorApplication.Exit(1);
            }
        }
    }
}