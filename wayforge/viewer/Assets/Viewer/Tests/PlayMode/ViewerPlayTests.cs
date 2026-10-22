/*!
 * \file ViewerPlayTests.cs
 * \brief Play-mode test of the page contract through ViewerApi
 *
 * Builds the same objects the scene has (camera + CameraRig, WayforgeViewer
 * with BuildingView / RouteView / ViewerApi), then calls the contract
 * methods the page uses and checks the events in WebBridge.Recent.
 *
 * Run: Test Runner > PlayMode, or
 *   Unity -batchmode -projectPath viewer -runTests -testPlatform PlayMode -testResults results.xml
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Contract test: commands, events, errors, room clicks
 *   - Test building, route and serialized-field helper
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace Wayforge.Viewer.Tests
{
    public class ViewerPlayTests
    {
        GameObject _camera, _viewer;
        ViewerApi _api;
        BuildingView _building;
        RouteView _route;
        Camera _cam;

        [UnitySetUp]
        public IEnumerator SetUp()
        {
            WebBridge.Recent.Clear();
            _camera = new GameObject("Main Camera") { tag = "MainCamera" };
            _cam = _camera.AddComponent<Camera>();
            var rig = _camera.AddComponent<CameraRig>();

            _viewer = TestBuilding.MakeViews(out _building, out _route);
            _viewer.SetActive(false);                                // assign fields before Awake / Start run
            _api = _viewer.AddComponent<ViewerApi>();
            TestBuilding.SetField(_api, "building", _building);
            TestBuilding.SetField(_api, "route", _route);
            TestBuilding.SetField(_api, "cameraRig", rig);
            _viewer.SetActive(true);
            yield return null;                                       // Start() sends "ready"
        }

        [TearDown]
        public void TearDown()
        {
            Object.Destroy(_viewer);
            Object.Destroy(_camera);
        }

        static (string name, object data) Last(string eventName)
        {
            var e = WebBridge.Recent.LastOrDefault(r => r.name == eventName);
            Assert.IsNotNull(e.name, $"no '{eventName}' event");
            return (e.name, Json.Parse(e.json));
        }

        [UnityTest]
        public IEnumerator Contract_CommandsAndEvents()
        {
            Assert.AreEqual(ViewerApi.ContractVersion, Json.Str(Last("ready").data, "contract"));

            _api.LoadBuilding(TestBuilding.Wfb);
            var loaded = Last("buildingLoaded").data;
            Assert.AreEqual("Test block", Json.Str(loaded, "name"));
            Assert.AreEqual(2, Json.Arr(loaded, "levels").Count);
            Assert.AreEqual(2, Json.Num(loaded, "links"));

            _api.ShowFloor("L2");
            Assert.AreEqual("L2", Json.Str(Last("floorChanged").data, "level"));
            Assert.AreEqual("L2", _building.VisibleLevel);
            _api.ShowAllFloors("");
            Assert.AreEqual("all", Json.Str(Last("floorChanged").data, "level"));
            Assert.IsNull(_building.VisibleLevel);

            _api.ShowRoute(TestBuilding.Route);
            Assert.AreEqual(6, Json.Num(Last("routeShown").data, "steps"));
            Assert.IsTrue(_route.HasRoute);
            _api.SetFloorSpacing("3");
            Assert.IsTrue(_route.HasRoute, "route is redrawn for the new spacing");
            _api.ClearRoute("");
            Assert.IsFalse(_route.HasRoute);

            _api.FocusRoom("L2:rB2");
            Assert.AreEqual("rB2", _building.Highlighted.id);
            _api.HighlightRoom("");
            Assert.IsNull(_building.Highlighted);

            _api.SetView("2d");
            yield return null;
            Assert.IsTrue(_cam.orthographic);
            _api.SetView("3d");
            yield return null;
            Assert.IsFalse(_cam.orthographic);
        }

        [UnityTest]
        public IEnumerator Contract_ReportsErrors()
        {
            _api.ShowFloor("L1");
            Assert.AreEqual("no building loaded", Json.Str(Last("error").data, "message"));

            _api.LoadBuilding("{ not json");
            Assert.AreEqual("LoadBuilding", Json.Str(Last("error").data, "command"));

            _api.LoadBuilding(TestBuilding.Wfb);
            int before = WebBridge.Recent.Count(r => r.name == "error");
            _api.ShowFloor("L9");
            _api.HighlightRoom("nope");
            _api.SetView("4d");
            _api.SetFloorSpacing("wide");
            _api.ShowRoute("{\"ok\": false, \"error\": \"no route exists\"}");
            Assert.AreEqual(before + 5, WebBridge.Recent.Count(r => r.name == "error"));
            Assert.AreEqual("no route exists", Json.Str(Last("error").data, "message"));
            yield return null;
        }

        [UnityTest]
        public IEnumerator Contract_ClickReportsRoom()
        {
            _api.LoadBuilding(TestBuilding.Wfb);
            _api.ShowFloor("L1");
            _api.SetView("2d");
            for (int i = 0; i < 90; i++) yield return null;          // let the camera ease into place
            Physics.SyncTransforms();

            Vector3 office = _building.RoomPoint(_building.Building.FindRoom("B1"));
            Vector2 screen = _cam.WorldToScreenPoint(office);
            typeof(ViewerApi).GetMethod("OnClicked", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(_api, new object[] { screen });

            var clicked = Last("roomClicked").data;
            Assert.AreEqual("rB1", Json.Str(clicked, "id"));
            Assert.AreEqual("L1", Json.Str(clicked, "level"));
            Assert.AreEqual("office", Json.Str(clicked, "kind"));
            Assert.AreEqual("rB1", _building.Highlighted.id);
        }
    }

    public static class TestBuilding
    {
        static string Level(string id, float elevation, string suffix) => $@"
        {{ 'id': '{id}', 'name': 'Level {id.Substring(1)}', 'elevation': {elevation.ToString(System.Globalization.CultureInfo.InvariantCulture)}, 'ceilingHeight': 3.0,
          'walls': [
            {{ 'id': 'w1{suffix}', 'a': [0, 0], 'b': [10, 0], 'thickness': 0.2 }},
            {{ 'id': 'w2{suffix}', 'a': [10, 0], 'b': [10, 8], 'thickness': 0.2 }},
            {{ 'id': 'w3{suffix}', 'a': [10, 8], 'b': [0, 8], 'thickness': 0.2 }},
            {{ 'id': 'w4{suffix}', 'a': [0, 8], 'b': [0, 0], 'thickness': 0.2 }},
            {{ 'id': 'w5{suffix}', 'a': [5, 0], 'b': [5, 8], 'thickness': 0.15 }} ],
          'openings': [
            {{ 'id': 'o1{suffix}', 'wall': 'w5{suffix}', 'type': 'door', 'offset': 1.0, 'width': 1.0, 'height': 2.1, 'sill': 0 }},
            {{ 'id': 'o2{suffix}', 'wall': 'w1{suffix}', 'type': 'window', 'offset': 6.5, 'width': 2.0, 'height': 1.2, 'sill': 0.9 }} ],
          'rooms': [
            {{ 'id': 'rS{suffix}', 'code': 'S{suffix}', 'kind': 'stair', 'area': 40,
              'polygon': [[0,0],[5,0],[5,8],[0,8]], 'centroid': [2.5, 4] }},
            {{ 'id': 'rB{suffix}', 'code': 'B{suffix}', 'name': 'Office {suffix}', 'kind': 'office', 'area': 40,
              'polygon': [[5,0],[10,0],[10,8],[5,8]], 'centroid': [7.5, 4] }} ],
          'nodes': [
            {{ 'id': 'n1', 'room': 'rS{suffix}', 'kind': 'stair', 'pos': [2.5, 4] }},
            {{ 'id': 'n2', 'room': 'rB{suffix}', 'kind': 'room', 'pos': [7.5, 4] }},
            {{ 'id': 'n3', 'kind': 'door', 'pos': [5, 1.5] }} ] }}";

        public static readonly string Wfb = (@"{ 'version': 1,
          'building': { 'name': 'Test block', 'latitude': 1.3337, 'longitude': 103.7775, 'heading': 15 },
          'levels': [" + Level("L2", 3.5f, "2") + "," + Level("L1", 0f, "1") + @" ],
          'links': [
            { 'a': 'L1:n1', 'b': 'L2:n1', 'kind': 'stair', 'stepFree': false },
            { 'a': 'L1:n2', 'b': 'L2:n2', 'kind': 'lift', 'stepFree': true } ] }").Replace('\'', '"');

        // Office B1 on L1 -> door -> stair room -> up -> office B2 on L2 (wf_cli route format).
        public static readonly string Route = @"{ 'ok': true, 'from': 'L1:n2', 'to': 'L2:n2', 'stepFree': false,
          'steps': [
            { 'level': 'L1', 'node': 'n2', 'x': 7.5, 'y': 4, 'z': 0, 'kind': 'room' },
            { 'level': 'L1', 'node': 'n3', 'x': 5, 'y': 1.5, 'z': 0, 'kind': 'door' },
            { 'level': 'L1', 'node': 'n1', 'x': 2.5, 'y': 4, 'z': 0, 'kind': 'stair' },
            { 'level': 'L2', 'node': 'n1', 'x': 2.5, 'y': 4, 'z': 3.5, 'kind': 'stair' },
            { 'level': 'L2', 'node': 'n3', 'x': 5, 'y': 1.5, 'z': 3.5, 'kind': 'door' },
            { 'level': 'L2', 'node': 'n2', 'x': 7.5, 'y': 4, 'z': 3.5, 'kind': 'room' } ] }".Replace('\'', '"');

        // Sets a private [SerializeField] the way the scene setup does.
        public static void SetField(object target, string field, object value)
        {
            var f = target.GetType().GetField(field, BindingFlags.NonPublic | BindingFlags.Instance);
            if (f == null) throw new MissingFieldException(target.GetType().Name, field);
            f.SetValue(target, value);
        }

        public static Material Mat() => new Material(Shader.Find("Standard"));

        // BuildingView + RouteView on one object, materials assigned.
        public static GameObject MakeViews(out BuildingView building, out RouteView route)
        {
            var go = new GameObject("WayforgeViewer");
            building = go.AddComponent<BuildingView>();
            route = go.AddComponent<RouteView>();
            foreach (var f in new[] { "wallMaterial", "floorMaterial", "stairMaterial", "liftMaterial", "exteriorWallMaterial",
                                      "glassMaterial", "frameMaterial", "doorMaterial", "roofMaterial", "groundMaterial" })
                SetField(building, f, Mat());
            SetField(route, "lineMaterial", Mat());
            SetField(route, "markerMaterial", Mat());
            return go;
        }

        class MissingFieldException : System.Exception
        {
            public MissingFieldException(string type, string field) : base($"{type} has no field '{field}'") { }
        }
    }
}
