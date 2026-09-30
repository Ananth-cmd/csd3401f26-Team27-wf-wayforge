using System;
using System.Runtime.CompilerServices;
using UnityEngine;
using WayforgeApp;

// Runs the actual route planner against Unity's managed library without starting the Editor.
// Bypass only ScriptableObject's native allocation; routing uses serialized fields and managed maths.
static class RouteChecks
{
    static int count;
    static void Check(bool ok, string name) { if (!ok) throw new Exception(name); Console.WriteLine("PASS " + name); count++; }
    static Waypoint N(string id, int floor, float x) => new Waypoint { id = id, label = id, floor = floor, position = new Vector3(x, 0, 0) };
    static Connection E(string a, string b, Passage p = Passage.Corridor, float extra = 0) => new Connection { from = a, to = b, passage = p, extraMetres = extra };
    public static void Main()
    {
        var b = (BuildingDefinition)RuntimeHelpers.GetUninitializedObject(typeof(BuildingDefinition));
        b.floors = new[] { new FloorDefinition(), new FloorDefinition() };
        b.waypoints = new[] { N("start", 0, 0), N("stairs0", 0, 2), N("stairs1", 1, 2), N("lift0", 0, 8), N("lift1", 1, 8), N("end", 1, 4) };
        b.places = new[] { new Place { id = "p", waypointId = "end" } };
        b.connections = new[] { E("start", "stairs0"), E("stairs0", "stairs1", Passage.Stairs), E("stairs1", "end"), E("start", "lift0"), E("lift0", "lift1", Passage.Lift, 10), E("lift1", "end") };
        Check(b.ValidateData() == null, "Valid graph");
        var shortest = RoutePlanner.Find(b, "start", "end", false);
        Check(shortest != null && shortest.nodes.Count == 4 && shortest.passages.Contains(Passage.Stairs), "Shortest route uses stairs");
        Check(Math.Abs(shortest.metres - 8) < .001f, "Distance includes floor elevation cost");
        var accessible = RoutePlanner.Find(b, "start", "end", true);
        Check(accessible != null && !accessible.passages.Contains(Passage.Stairs) && accessible.passages.Contains(Passage.Lift), "Accessible route excludes stairs");
        Check(accessible.metres > shortest.metres, "Accessible detour is measured");
        Check(RoutePlanner.Find(b, "end", "start", true) != null, "Bidirectional routes");
        Check(RoutePlanner.Find(b, "start", "start", true).nodes.Count == 1, "Already at destination");
        Check(RoutePlanner.Find(b, "unknown", "end", false) == null, "Unknown start");
        b.connections[4].blocked = true;
        Check(RoutePlanner.Find(b, "start", "end", true) == null, "Blocked lift makes step-free route unavailable");
        Check(RoutePlanner.Find(b, "start", "end", false) != null, "Blocked lift still permits stairs");
        b.connections[1].bidirectional = false;
        Check(RoutePlanner.Find(b, "end", "start", false) == null, "One-way links respected");
        b.connections[1].blocked = true;
        Check(RoutePlanner.Find(b, "start", "end", false) == null, "Disconnected graph");
        b.connections[0].extraMetres = -1;
        Check(b.ValidateData() != null, "Negative costs rejected"); b.connections[0].extraMetres = 0;
        b.waypoints[1].id = "start";
        Check(b.ValidateData() != null, "Duplicate node IDs rejected");
        Console.WriteLine("ROUTE_CHECKS_OK: " + count + " checks passed");
    }
}
