using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using UnityEngine;

namespace WayforgeApp
{
    // The building made by our converter. Wayforge Studio's "Send to app" saves it as
    // Resources/WayforgeBuilding.json (a .wfb file). This opens it with our C++ core
    // (libwayforge.so / wayforge.dll), builds the 3D floor from its walls, and routes with our A*.
    public static class WayforgeBuilding
    {
        const string Lib = "wayforge";
        [DllImport(Lib)] static extern IntPtr wf_open_plan(string path);
        [DllImport(Lib)] static extern int wf_build_graph(IntPtr doc);
        [DllImport(Lib)] static extern int wf_wall_count(IntPtr doc, int level);
        [DllImport(Lib)] static extern int wf_get_walls(IntPtr doc, int level, float[] outBuf, int maxFloats);
        [DllImport(Lib)] static extern int wf_opening_count(IntPtr doc, int level);
        [DllImport(Lib)] static extern int wf_get_openings(IntPtr doc, int level, float[] outBuf, int maxFloats);
        [DllImport(Lib)] static extern int wf_room_count(IntPtr doc, int level);
        [DllImport(Lib)] static extern int wf_get_room(IntPtr doc, int level, int i, StringBuilder codeOut, int codeCap, float[] centroidOut, out float confidence);
        [DllImport(Lib)] static extern int wf_get_room_id(IntPtr doc, int level, int i, StringBuilder outBuf, int cap);
        [DllImport(Lib)] static extern int wf_get_property(IntPtr doc, int level, int elementKind, string elementId, string prop, StringBuilder outBuf, int cap);
        [DllImport(Lib)] static extern int wf_node_for_room(IntPtr doc, string room, StringBuilder refOut, int cap);
        [DllImport(Lib)] static extern int wf_route(IntPtr doc, string fromRef, string toRef, int stepFreeOnly, float[] outBuf, int maxFloats, out float totalCost);

        static IntPtr doc;                 // kept open so every route is asked for on it
        static BuildingDefinition loaded;

        // The converter's building if the Studio has sent one, otherwise the fallback (the demo)
        public static BuildingDefinition LoadOr(BuildingDefinition fallback)
        {
            var file = Resources.Load<TextAsset>("WayforgeBuilding");
            if (!file) return fallback;
            try
            {
                // The C++ core reads files, so copy the text into the app's storage first (works on Android too)
                string path = Path.Combine(Application.persistentDataPath, "building.wfb");
                File.WriteAllText(path, file.text);
                doc = wf_open_plan(path);
                if (doc == IntPtr.Zero) return fallback;
                wf_build_graph(doc);

                // Every room with a node in our graph becomes a place; its waypoint id is that node, e.g. "L1:n100001"
                var waypoints = new List<Waypoint>(); var places = new List<Place>(); var centre = new float[2];
                for (int i = 0; i < wf_room_count(doc, 0); i++)
                {
                    var id = new StringBuilder(64); var code = new StringBuilder(64); var name = new StringBuilder(128); var node = new StringBuilder(64);
                    wf_get_room_id(doc, 0, i, id, 64);
                    wf_get_room(doc, 0, i, code, 64, centre, out _);
                    wf_get_property(doc, 0, 2, id.ToString(), "name", name, 128);
                    if (wf_node_for_room(doc, id.ToString(), node, 64) < 0) continue;   // corridors have no room node
                    string label = name.Length > 0 ? name.ToString() : code.ToString();
                    waypoints.Add(new Waypoint { id = node.ToString(), label = label, floor = 0, position = new Vector3(centre[0], .12f, centre[1]) });
                    places.Add(new Place { id = node.ToString(), name = label, code = code.ToString(), waypointId = node.ToString(), description = "Found by the Wayforge converter." });
                }
                loaded = ScriptableObject.CreateInstance<BuildingDefinition>();
                loaded.illustrative = false;
                loaded.floors = new[] { new FloorDefinition { name = "Level 1", model = BuildFloor() } };
                loaded.waypoints = waypoints.ToArray();
                loaded.places = places.ToArray();
                return loaded;
            }
            catch (Exception e) { Debug.LogError("Wayforge building not loaded, showing the demo: " + e.Message); return fallback; }
        }

        public static bool IsLoaded(BuildingDefinition building) => building != null && building == loaded;

        // Our A*: returns the route as points (x, y, elevation) and turns them into the app's Route
        public static Route FindRoute(BuildingDefinition building, string start, string end, bool stepFree)
        {
            var buffer = new float[3 * 1024];
            int n = wf_route(doc, start, end, stepFree ? 1 : 0, buffer, buffer.Length, out float metres);
            if (n < 3) return null;
            var route = new Route { metres = metres };
            for (int i = 0; i + 2 < n; i += 3)
            {
                var point = new Vector3(buffer[i], .12f, buffer[i + 1]);
                int count = route.nodes.Count;   // skip points on a straight line: same path, fewer steps
                if (count >= 2 && Vector3.Angle(route.nodes[count - 1].position - route.nodes[count - 2].position, point - route.nodes[count - 1].position) < 25f)
                    route.nodes.RemoveAt(count - 1);
                route.nodes.Add(new Waypoint { label = "the next turn", position = point });
            }
            route.nodes[0] = building.Node(start);                      // show the chosen places' names
            route.nodes[route.nodes.Count - 1] = building.Node(end);
            for (int i = 1; i < route.nodes.Count; i++) route.passages.Add(Passage.Corridor);
            return route;
        }

        // The 3D floor: a slab under the plan and a low wall along every wall line, with a gap at each door
        static GameObject BuildFloor()
        {
            var root = new GameObject("Wayforge floor"); root.SetActive(false);   // a template: the map makes its own copy
            var numbers = new float[wf_wall_count(doc, 0) * 5];
            var walls = new List<(Vector3 a, Vector3 b)>();
            int wallFloats = wf_get_walls(doc, 0, numbers, numbers.Length);
            for (int i = 0; i + 4 < wallFloats; i += 5)
                walls.Add((new Vector3(numbers[i], 0, numbers[i + 1]), new Vector3(numbers[i + 2], 0, numbers[i + 3])));

            var doors = new float[wf_opening_count(doc, 0) * 4];   // x, y, width, type
            int doorFloats = wf_get_openings(doc, 0, doors, doors.Length);
            for (int d = 0; d + 3 < doorFloats; d += 4)
            {
                var centre = new Vector3(doors[d], 0, doors[d + 1]);
                int i = walls.FindIndex(w => Mathf.Abs(Vector3.Distance(w.a, centre) + Vector3.Distance(centre, w.b) - Vector3.Distance(w.a, w.b)) < .05f);
                if (i < 0) continue;
                var (a, b) = walls[i]; var half = (b - a).normalized * doors[d + 2] / 2;
                walls[i] = (a, centre - half); walls.Insert(i + 1, (centre + half, b));   // split the wall around the door
            }

            var bounds = new Bounds(walls[0].a, Vector3.zero);
            foreach (var (a, b) in walls)
            {
                bounds.Encapsulate(a); bounds.Encapsulate(b);
                if (Vector3.Distance(a, b) < .01f) continue;
                Box(root, (a + b) / 2 + Vector3.up * .65f, new Vector3(Vector3.Distance(a, b) + .15f, 1.3f, .15f), Quaternion.LookRotation(b - a) * Quaternion.Euler(0, 90, 0), "E7F0ED");
            }
            Box(root, bounds.center + Vector3.down * .05f, new Vector3(bounds.size.x + 1, .1f, bounds.size.z + 1), Quaternion.identity, "B7D2CC");
            return root;
        }

        static void Box(GameObject parent, Vector3 position, Vector3 size, Quaternion rotation, string colour)
        {
            var box = GameObject.CreatePrimitive(PrimitiveType.Cube);
            box.transform.SetParent(parent.transform, false);
            box.transform.localPosition = position; box.transform.localRotation = rotation; box.transform.localScale = size;
            box.GetComponent<Renderer>().material.color = BuildingMap.Hex(colour);
        }
    }
}
