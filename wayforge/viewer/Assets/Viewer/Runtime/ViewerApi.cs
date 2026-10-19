/*!
 * \file ViewerApi.cs
 * \brief The viewer's public interface for the web page (JS <-> Unity contract)
 *
 * Lives on the GameObject named "WayforgeViewer", so the page calls it with
 *   unityInstance.SendMessage("WayforgeViewer", "<Method>", "<argument>")
 * (wayforge-viewer.js wraps these calls). Every method takes one string.
 *
 *   LoadBuilding(json)        .wfb text            LoadBuildingUrl(url)
 *   ShowFloor(levelId)        ShowAllFloors()      SetFloorSpacing(metres)
 *   HighlightRoom(ref)        FocusRoom(ref)       ref = room id, code or "L2:r5"; "" clears
 *   ShowRoute(json)           ClearRoute()         route JSON from wf_cli route
 *   SetView("2d" | "3d")      ResetView()          SetCutaway("true" | "false")
 *   ShowLabels("true" | "false")
 *
 * Events back to the page: ready, buildingLoaded, floorChanged, roomClicked,
 * routeShown, error. WebBridge (below) sends them: in a WebGL build through
 * WF_Emit in Plugins/WebGL/WayforgeBridge.jslib; in the editor they are logged
 * and kept in WebBridge.Recent so tests can check them. Contract: docs/viewer.md.
 *
 * Links: drives BuildingView, RouteView and CameraRig.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Page-facing commands, event payloads, room picking
 *   - Unity -> JavaScript event channel (WebBridge)
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Networking;
using UnityEngine.Scripting;

namespace Wayforge.Viewer
{
    // [Preserve]: the page calls these methods by name (SendMessage), which the IL2CPP linker
    // cannot see, so without it they are stripped from WebGL builds.
    public class ViewerApi : MonoBehaviour
    {
        public const string ContractVersion = "1.0";

        [SerializeField] BuildingView building;
        [SerializeField] RouteView route;
        [SerializeField] CameraRig cameraRig;

        string _routeJson;            // kept so the route can be redrawn when the floor spacing changes
        bool _routeAnimate = true;

        void Awake()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // WebGLInput.captureAllKeyboardInput = false;     // leave the keyboard to the page's own inputs
            // (commented out by Katie for a local build: CS0103 'WebGLInput' does not exist on 6000.6.0f1)
#endif
            if (cameraRig != null) cameraRig.Clicked += OnClicked;
        }

        void Start()
        {
            WebBridge.Emit("ready", new Dictionary<string, object> { { "contract", ContractVersion }, { "unity", Application.unityVersion } });
        }

        // --- building ------------------------------------------------------------------------

        [Preserve] public void LoadBuilding(string json)
        {
            BuildingData data;
            try { data = BuildingData.Parse(json); }
            catch (Exception e) { Error("LoadBuilding", e.Message); return; }

            route.Clear();
            _routeJson = null;
            building.Show(data);
            cameraRig.Frame(building.WorldBounds());
            cameraRig.ResetView();
            WebBridge.Emit("buildingLoaded", Summary(data));
        }

        [Preserve] public void LoadBuildingUrl(string url) => StartCoroutine(Download(url));

        IEnumerator Download(string url)
        {
            using (var req = UnityWebRequest.Get(url))
            {
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) { Error("LoadBuildingUrl", $"{url}: {req.error}"); yield break; }
                LoadBuilding(req.downloadHandler.text);
            }
        }

        // --- floors and view -----------------------------------------------------------------

        [Preserve] public void ShowFloor(string levelId)
        {
            if (!RequireBuilding("ShowFloor")) return;
            if (!building.ShowLevel(levelId)) { Error("ShowFloor", $"no floor '{levelId}'"); return; }
            route.SetVisibleLevel(building.VisibleLevel);
            var level = building.Building.FindLevel(levelId);
            Bounds b = building.WorldBounds();
            cameraRig.Frame(b);
            WebBridge.Emit("floorChanged", new Dictionary<string, object> { { "level", level.id }, { "name", level.name } });
        }

        [Preserve] public void ShowAllFloors(string _ = "")
        {
            if (!RequireBuilding("ShowAllFloors")) return;
            building.ShowLevel(null);
            route.SetVisibleLevel(null);
            cameraRig.Frame(building.WorldBounds());
            WebBridge.Emit("floorChanged", new Dictionary<string, object> { { "level", "all" }, { "name", "All floors" } });
        }

        [Preserve] public void SetFloorSpacing(string metres)
        {
            if (!float.TryParse(metres, NumberStyles.Float, CultureInfo.InvariantCulture, out float m)) { Error("SetFloorSpacing", $"not a number: '{metres}'"); return; }
            building.SetFloorSpacing(m);
            RedrawRoute();
            if (building.Building != null) cameraRig.Frame(building.WorldBounds());
        }

        [Preserve] public void SetCutaway(string on) => building.SetCutaway(IsTrue(on));

        [Preserve] public void ShowLabels(string on) => building.SetLabelsVisible(IsTrue(on));

        [Preserve] public void SetView(string mode)
        {
            string m = (mode ?? "").Trim().ToLowerInvariant();
            if (m != "2d" && m != "3d") { Error("SetView", $"mode must be \"2d\" or \"3d\", not '{mode}'"); return; }
            cameraRig.SetTopDown(m == "2d");
        }

        [Preserve] public void ResetView(string _ = "") => cameraRig.ResetView();

        // --- rooms ---------------------------------------------------------------------------

        [Preserve] public void HighlightRoom(string reference)
        {
            if (!RequireBuilding("HighlightRoom")) return;
            if (string.IsNullOrEmpty(reference)) { building.Highlight(null); return; }
            var room = building.Building.FindRoom(reference);
            if (room == null) { Error("HighlightRoom", $"no room '{reference}'"); return; }
            building.Highlight(room);
        }

        // Highlight the room, show its floor if a single floor is shown, and move the camera to it.
        [Preserve] public void FocusRoom(string reference)
        {
            if (!RequireBuilding("FocusRoom")) return;
            var room = building.Building.FindRoom(reference);
            if (room == null) { Error("FocusRoom", $"no room '{reference}'"); return; }
            if (building.VisibleLevel != null && building.VisibleLevel != room.levelId) ShowFloor(room.levelId);
            building.Highlight(room);
            var box = MeshUtil.Bounds(room.polygon);
            cameraRig.Focus(building.RoomPoint(room), Mathf.Max(box.width, box.height) * 0.5f);
        }

        void OnClicked(Vector2 screen)
        {
            if (building.Building == null) return;
            var room = building.RoomUnder(Camera.main.ScreenPointToRay(screen));
            building.Highlight(room);
            if (room == null) return;
            WebBridge.Emit("roomClicked", new Dictionary<string, object>
            {
                { "level", room.levelId }, { "id", room.id }, { "code", room.code }, { "name", room.name },
                { "kind", room.kind }, { "area", room.area }, { "x", room.centroid.x }, { "y", room.centroid.y },
            });
        }

        // --- routes --------------------------------------------------------------------------

        // json: wf_cli route output. Add "animate": false at the top level to switch the moving dot off.
        [Preserve] public void ShowRoute(string json)
        {
            List<RouteView.Step> steps;
            try { steps = RouteView.Parse(json); }
            catch (Exception e) { Error("ShowRoute", e.Message); return; }
            if (steps.Count < 2) { Error("ShowRoute", "a route needs at least 2 steps"); return; }

            object root = null;
            try { root = Json.Parse(json); } catch (FormatException) { }
            _routeAnimate = Json.Bool(root, "animate", true);
            _routeJson = json;
            route.Show(steps, building, _routeAnimate);

            var levels = new List<object>();
            foreach (var s in steps) if (!levels.Contains(s.level)) levels.Add(s.level);
            WebBridge.Emit("routeShown", new Dictionary<string, object> { { "steps", steps.Count }, { "levels", levels } });
        }

        [Preserve] public void ClearRoute(string _ = "")
        {
            _routeJson = null;
            route.Clear();
        }

        void RedrawRoute()
        {
            if (_routeJson == null) return;
            try { route.Show(RouteView.Parse(_routeJson), building, _routeAnimate); }
            catch (FormatException) { route.Clear(); }
        }

        // --- helpers -------------------------------------------------------------------------

        bool RequireBuilding(string command)
        {
            if (building.Building != null) return true;
            Error(command, "no building loaded");
            return false;
        }

        static void Error(string command, string message)
        {
            WebBridge.Emit("error", new Dictionary<string, object> { { "command", command }, { "message", message } });
        }

        static bool IsTrue(string s)
        {
            s = (s ?? "").Trim().ToLowerInvariant();
            return s == "true" || s == "1" || s == "on" || s == "yes";
        }

        static Dictionary<string, object> Summary(BuildingData b)
        {
            var levels = new List<object>();
            foreach (var l in b.levels)
            {
                var rooms = new List<object>();
                foreach (var r in l.rooms)
                    rooms.Add(new Dictionary<string, object>
                    {
                        { "id", r.id }, { "code", r.code }, { "name", r.name }, { "kind", r.kind }, { "area", r.area },
                    });
                levels.Add(new Dictionary<string, object>
                {
                    { "id", l.id }, { "name", l.name }, { "elevation", l.elevation }, { "rooms", rooms },
                });
            }
            return new Dictionary<string, object>
            {
                { "name", b.name }, { "levels", levels }, { "links", b.links.Count },
                { "latitude", b.latitude }, { "longitude", b.longitude }, { "heading", b.heading },
            };
        }
    }

    // Sends events to the hosting page (see the file header).
    public static class WebBridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void WF_Emit(string eventName, string json);
#endif

        // Last events sent (editor / tests only), newest last.
        public static readonly List<(string name, string json)> Recent = new List<(string, string)>();

        public static void Emit(string eventName, object payload)
        {
            string json = Json.Write(payload);
#if UNITY_WEBGL && !UNITY_EDITOR
            WF_Emit(eventName, json);
#else
            Recent.Add((eventName, json));
            if (Recent.Count > 50) Recent.RemoveAt(0);
            Debug.Log($"[viewer] {eventName} {json}");
#endif
        }
    }
}
