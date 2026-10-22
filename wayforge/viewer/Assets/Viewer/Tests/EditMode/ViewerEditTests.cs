/*!
 * \file ViewerEditTests.cs
 * \brief Edit-mode tests: JSON, .wfb parsing, meshes, building view, routes
 *
 * Run: Window > General > Test Runner > EditMode, or
 *   Unity -batchmode -projectPath viewer -runTests -testPlatform EditMode -testResults results.xml
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Parser, geometry, view-state and route checks
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;

namespace Wayforge.Viewer.Tests
{
    public class ViewerEditTests
    {
        readonly List<UnityEngine.Object> _made = new List<UnityEngine.Object>();

        [TearDown]
        public void TearDown()
        {
            foreach (var o in _made) if (o != null) UnityEngine.Object.DestroyImmediate(o);
            _made.Clear();
        }

        GameObject Views(out BuildingView building, out RouteView route)
        {
            var go = TestBuilding.MakeViews(out building, out route);
            _made.Add(go);
            return go;
        }

        // --- JSON ----------------------------------------------------------------------------

        [Test]
        public void Json_ReadsAllValueKinds()
        {
            var o = Json.Parse("{\"a\": [1, -2.5e1, \"x\\n\\u00e9\", true, false, null], \"b\": {\"c\": \"d\"}}");
            var a = Json.Arr(o, "a");
            Assert.AreEqual(6, a.Count);
            Assert.AreEqual(1.0, a[0]);
            Assert.AreEqual(-25.0, a[1]);
            Assert.AreEqual("x\né", a[2]);
            Assert.AreEqual(true, a[3]);
            Assert.AreEqual(false, a[4]);
            Assert.IsNull(a[5]);
            Assert.AreEqual("d", Json.Str(Json.Obj(o, "b"), "c"));
            Assert.AreEqual(7f, Json.Num(o, "missing", 7f));
        }

        [Test]
        public void Json_WriteParsesBack()
        {
            var value = new Dictionary<string, object> { { "s", "a\"b\\c" }, { "n", 1.5f }, { "l", new List<object> { 1, "two", null } } };
            var back = Json.Parse(Json.Write(value));
            Assert.AreEqual("a\"b\\c", Json.Str(back, "s"));
            Assert.AreEqual(1.5f, Json.Num(back, "n"));
            Assert.AreEqual(3, Json.Arr(back, "l").Count);
        }

        [TestCase("{")]
        [TestCase("[1, 2")]
        [TestCase("{\"a\" 1}")]
        [TestCase("\"open")]
        [TestCase("{} extra")]
        public void Json_RejectsBadText(string text)
        {
            Assert.Throws<FormatException>(() => Json.Parse(text));
        }

        // --- .wfb ----------------------------------------------------------------------------

        [Test]
        public void Building_ParsesWfb()
        {
            var b = BuildingData.Parse(TestBuilding.Wfb);
            Assert.AreEqual("Test block", b.name);
            Assert.AreEqual(1.3337f, b.latitude, 1e-4f);
            Assert.AreEqual(2, b.levels.Count);
            Assert.AreEqual("L1", b.levels[0].id, "levels are sorted by elevation");
            Assert.AreEqual(3.5f, b.levels[1].elevation);
            Assert.AreEqual(5, b.levels[0].walls.Count);
            Assert.AreEqual(2, b.levels[0].openings.Count);
            Assert.AreEqual(2, b.links.Count);

            Assert.AreEqual("rB1", b.FindRoom("B1").id, "by code");
            Assert.AreEqual("rB2", b.FindRoom("rB2").id, "by id");
            Assert.AreEqual("rS2", b.FindRoom("L2:rS2").id, "by level:id");
            Assert.IsNull(b.FindRoom("L1:rS2"), "wrong level");
            Assert.IsNull(b.FindRoom("nope"));

            Assert.IsTrue(b.TryFindNode("L2:n1", out var level, out var node));
            Assert.AreEqual("L2", level.id);
            Assert.AreEqual(new Vector2(2.5f, 4f), node.pos);
            Assert.IsFalse(b.TryFindNode("L9:n1", out _, out _));
        }

        [Test]
        public void Building_RejectsNonWfb()
        {
            Assert.Throws<FormatException>(() => BuildingData.Parse("{\"walls\": []}"));
            Assert.Throws<FormatException>(() => BuildingData.Parse("[1, 2]"));
        }

        // --- geometry ------------------------------------------------------------------------

        [Test]
        public void Triangulate_LShapeKeepsArea()
        {
            var l = new[] { new Vector2(0, 0), new Vector2(4, 0), new Vector2(4, 1), new Vector2(1, 1), new Vector2(1, 3), new Vector2(0, 3) };
            int[] tris = MeshUtil.Triangulate(l);
            Assert.AreEqual(12, tris.Length, "6 corners -> 4 triangles");
            float area = 0f;
            for (int i = 0; i < tris.Length; i += 3)
                area += Mathf.Abs(MeshUtil.SignedArea(new[] { l[tris[i]], l[tris[i + 1]], l[tris[i + 2]] }));
            Assert.AreEqual(6f, area, 1e-4f);
            Assert.AreEqual(6f, MeshUtil.SignedArea(l), 1e-4f);
            Array.Reverse(l);
            Assert.AreEqual(12, MeshUtil.Triangulate(l).Length, "clockwise input works too");
        }

        [Test]
        public void MeshBuilder_FacesPointOutwards()
        {
            var mb = new MeshBuilder();
            mb.AddBox(Vector3.zero, Vector3.one);
            var m = mb.ToMesh("box");
            var v = m.vertices; var t = m.triangles; var n = m.normals;
            Assert.AreEqual(36, t.Length);
            for (int i = 0; i < t.Length; i += 3)
            {
                Vector3 face = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]);
                Assert.Greater(Vector3.Dot(face, n[t[i]]), 0f, "triangle winding matches its normal");
                Vector3 centre = (v[t[i]] + v[t[i + 1]] + v[t[i + 2]]) / 3f;
                Assert.Greater(Vector3.Dot(n[t[i]], centre - new Vector3(0.5f, 0.5f, 0.5f)), 0f, "normal points away from the box centre");
            }
            UnityEngine.Object.DestroyImmediate(m);
        }

        // --- building view -------------------------------------------------------------------

        [Test]
        public void View_BuildsEveryFloor()
        {
            Views(out var view, out _);
            view.Show(BuildingData.Parse(TestBuilding.Wfb));

            Assert.AreEqual(4, view.GetComponentsInChildren<RoomTag>().Length, "2 rooms on each of 2 floors");
            var walls = view.GetComponentsInChildren<MeshFilter>().Where(f => f.name == "Walls").ToArray();
            Assert.AreEqual(2, walls.Length);
            Assert.That(walls.All(w => w.sharedMesh.vertexCount > 0));
            Assert.AreEqual(3.5f - 0.15f, walls[0].sharedMesh.bounds.max.y, 1e-3f, "L1 walls reach the L2 slab");
            Assert.IsNotNull(view.transform.Find("Building/Stairs and lifts/Stairs"));
            Assert.IsNotNull(view.transform.Find("Building/Stairs and lifts/Lifts"));
            Assert.AreEqual(4, view.GetComponentsInChildren<TextMesh>().Length, "every room has a code label");
        }

        [Test]
        public void View_WindowsDoorsRoofAndGround()
        {
            Views(out var view, out _);
            view.Show(BuildingData.Parse(TestBuilding.Wfb));
            MeshFilter Part(string level, string name) => view.transform.Find($"Building/Level {level}/{name}").GetComponent<MeshFilter>();

            Assert.Greater(Part("L1", "Exterior walls").sharedMesh.vertexCount, 0, "outer box walls are exterior");
            Assert.Greater(Part("L1", "Walls").sharedMesh.vertexCount, 0, "the dividing wall is interior");
            var glass = Part("L1", "Glass").sharedMesh;
            Assert.Greater(glass.vertexCount, 0, "the window gets a glass pane");
            Assert.AreEqual(0.9f, glass.bounds.min.y, 1e-3f, "pane starts at the sill");
            Assert.Greater(Part("L1", "Frames").sharedMesh.vertexCount, 0);
            Assert.Greater(Part("L1", "Doors").sharedMesh.vertexCount, 0, "the door gets a leaf");
            Assert.IsNotNull(view.transform.Find("Building/Ground"));

            var roof = Part("L2", "Roof").gameObject;
            Assert.IsTrue(roof.activeSelf, "roofs show in the full view");
            view.SetCutaway(true);
            Assert.IsFalse(roof.activeSelf, "and hide in cut-away");
            view.SetCutaway(false);
            view.SetRoof(false);
            Assert.IsFalse(roof.activeSelf);
        }

        [Test]
        public void View_OpeningsCutTheWalls()
        {
            Views(out var view, out _);
            view.Show(BuildingData.Parse(TestBuilding.Wfb));
            int withOpenings = view.GetComponentsInChildren<MeshFilter>().First(f => f.name == "Walls").sharedMesh.vertexCount;

            var plain = BuildingData.Parse(TestBuilding.Wfb);
            foreach (var l in plain.levels) l.openings.Clear();
            view.Show(plain);
            int without = view.GetComponentsInChildren<MeshFilter>().First(f => f.name == "Walls").sharedMesh.vertexCount;
            Assert.Greater(withOpenings, without, "a door adds a lintel and splits its wall, a window adds sill + lintel");
        }

        [Test]
        public void View_FloorsSpacingCutawayAndHighlight()
        {
            Views(out var view, out _);
            var b = BuildingData.Parse(TestBuilding.Wfb);
            view.Show(b);

            Assert.IsTrue(view.ShowLevel("L2"));
            Assert.IsFalse(view.transform.Find("Building/Level L1").gameObject.activeSelf);
            Assert.IsTrue(view.transform.Find("Building/Level L2").gameObject.activeSelf);
            Assert.IsFalse(view.ShowLevel("L9"));
            Assert.IsTrue(view.ShowLevel(null));
            Assert.IsTrue(view.transform.Find("Building/Level L1").gameObject.activeSelf);

            Assert.AreEqual(3.5f, view.LevelHeight("L2"), 1e-4f);
            view.SetFloorSpacing(2f);
            Assert.AreEqual(5.5f, view.LevelHeight("L2"), 1e-4f, "exploded view adds the spacing per floor");
            view.SetFloorSpacing(0f);

            view.SetCutaway(true);
            var walls = view.transform.Find("Building/Level L1/Walls").GetComponent<MeshFilter>().sharedMesh;
            Assert.AreEqual(BuildingView.CutawayHeight, walls.bounds.max.y, 1e-3f);
            view.SetCutaway(false);

            var office = b.FindRoom("B1");
            var floor = view.GetComponentsInChildren<RoomTag>().First(t => t.room == office).GetComponent<Renderer>();
            Color before = floor.sharedMaterial.color;
            view.Highlight(office);
            Assert.AreEqual(BuildingView.HighlightColour, floor.sharedMaterial.color);
            view.Highlight(null);
            Assert.AreEqual(before, floor.sharedMaterial.color);
        }

        [Test]
        public void View_PicksRoomUnderARay()
        {
            Views(out var view, out _);
            view.Show(BuildingData.Parse(TestBuilding.Wfb));
            Physics.SyncTransforms();
            // Straight down over office B on L2 (east half, 3.5 m up).
            var room = view.RoomUnder(new Ray(new Vector3(7.5f, 50f, 4f), Vector3.down));
            Assert.IsNotNull(room);
            Assert.AreEqual("rB2", room.id, "the top floor is hit first");
            Assert.IsNull(view.RoomUnder(new Ray(new Vector3(50f, 50f, 50f), Vector3.down)));
        }

        // --- routes --------------------------------------------------------------------------

        [Test]
        public void Route_ParsesWfCliOutput()
        {
            var steps = RouteView.Parse(TestBuilding.Route);
            Assert.AreEqual(6, steps.Count);
            Assert.AreEqual("L2", steps[3].level);
            Assert.AreEqual(new Vector2(5f, 1.5f), steps[1].plan);

            Assert.AreEqual(2, RouteView.Parse("[{\"level\":\"L1\",\"x\":0,\"y\":0},{\"level\":\"L1\",\"x\":1,\"y\":0}]").Count, "bare step array");
            var e = Assert.Throws<FormatException>(() => RouteView.Parse("{\"ok\": false, \"error\": \"no step-free route exists\"}"));
            Assert.AreEqual("no step-free route exists", e.Message);
            Assert.Throws<FormatException>(() => RouteView.Parse("{\"directions\": []}"));
        }

        [Test]
        public void Route_DrawsPerFloorAndFollowsVisibility()
        {
            Views(out var view, out var route);
            view.Show(BuildingData.Parse(TestBuilding.Wfb));
            route.Show(RouteView.Parse(TestBuilding.Route), view, animate: false);

            var lines = route.GetComponentsInChildren<LineRenderer>(true);
            Assert.AreEqual(3, lines.Length, "L1 run, L2 run, and the stair link between them");
            var l2 = lines.First(l => l.name == "Route L2");
            Assert.AreEqual(3.5f + 0.3f, l2.GetPosition(0).y, 1e-3f, "drawn 0.3 m above the L2 floor");

            route.SetVisibleLevel("L1");
            Assert.IsTrue(lines.First(l => l.name == "Route L1").gameObject.activeSelf);
            Assert.IsFalse(l2.gameObject.activeSelf);
            Assert.IsFalse(lines.First(l => l.name == "Between floors").gameObject.activeSelf);

            route.Clear();
            Assert.IsFalse(route.HasRoute);
            Assert.AreEqual(0, route.GetComponentsInChildren<LineRenderer>(true).Length);
        }
    }
}
