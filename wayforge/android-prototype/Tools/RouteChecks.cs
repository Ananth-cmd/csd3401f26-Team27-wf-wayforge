/*!
 * \file RouteChecks.cs
 * \brief Automated tests for the route planner (RoutePlanner.Find)
 *
 * A small console program that builds a tiny 2-floor test building and
 * checks the route planner gives the right answers: shortest route takes the
 * stairs, step-free route takes the lift, blocked and one-way links are
 * respected, and bad data is rejected. Each passing check prints "PASS ...";
 * the first failing check stops the program with an error.
 *
 * Test building (x = position in metres along one line; "---" = corridor):
 *
 *     Floor 1:  stairs1 (x=2) --- end (x=4) ----- lift1 (x=8)
 *                  | stairs                         | lift (+10 m extra)
 *     Floor 0:  stairs0 (x=2) --- start (x=0) --- lift0 (x=8)
 *
 *     Via stairs: 2 + 4 (one floor) + 2 = 8 m.   Via lift: 8 + 10 + 4 + 4 = 26 m.
 *
 * Links: compiled and run by Tools/Check-Source.ps1 together with
 * Assets/WayforgeApp/Scripts/BuildingDefinition.cs, without opening Unity.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - 14 route planner checks: stairs vs lift, step-free, blocked / one-way links, bad data
 *   - Runs outside the Unity Editor so it can be part of a quick source check
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-10-01
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;                            // Console, Exception, Math.
using System.Runtime.CompilerServices;   // RuntimeHelpers (see the comment in Main).
using UnityEngine;                       // Vector3.
using WayforgeApp;                       // BuildingDefinition, RoutePlanner, Waypoint, Connection...

// Runs the actual route planner against Unity's managed library without starting the Editor.
// Bypass only ScriptableObject's native allocation; routing uses serialized fields and managed maths.
static class RouteChecks
{
    static int count;   // number of checks passed
    // If ok is false, stop with an error naming the check; otherwise print PASS and count it.
    static void Check(bool ok, string name) { if (!ok) throw new Exception(name); Console.WriteLine("PASS " + name); count++; }
    // Shortcut to make a waypoint: id, floor number, and x position in metres.
    static Waypoint N(string id, int floor, float x) => new Waypoint { id = id, label = id, floor = floor, position = new Vector3(x, 0, 0) };
    // Shortcut to make a connection from a to b. "Passage p = Passage.Corridor" means p is optional and defaults to Corridor.
    static Connection E(string a, string b, Passage p = Passage.Corridor, float extra = 0) => new Connection { from = a, to = b, passage = p, extraMetres = extra };
    // Main = where the program starts.
    public static void Main()
    {
        // Make a BuildingDefinition without Unity running. Normally Unity creates these;
        // GetUninitializedObject skips that so the test can run as a plain program.
        var b = (BuildingDefinition)RuntimeHelpers.GetUninitializedObject(typeof(BuildingDefinition));
        // Build the test building drawn in the header: 2 floors, 6 waypoints, 6 connections.
        b.floors = new[] { new FloorDefinition(), new FloorDefinition() };
        b.waypoints = new[] { N("start", 0, 0), N("stairs0", 0, 2), N("stairs1", 1, 2), N("lift0", 0, 8), N("lift1", 1, 8), N("end", 1, 4) };
        b.places = new[] { new Place { id = "p", waypointId = "end" } };
        // connections[0]..[5]: the tests below refer to them by these numbers.
        b.connections = new[] { E("start", "stairs0"), E("stairs0", "stairs1", Passage.Stairs), E("stairs1", "end"), E("start", "lift0"), E("lift0", "lift1", Passage.Lift, 10), E("lift1", "end") };
        Check(b.ValidateData() == null, "Valid graph");
        // Normal route: start -> stairs0 -> stairs1 -> end (4 waypoints) using the stairs.
        var shortest = RoutePlanner.Find(b, "start", "end", false);
        Check(shortest != null && shortest.nodes.Count == 4 && shortest.passages.Contains(Passage.Stairs), "Shortest route uses stairs");
        // 2 m + (0 m across + 4 m for one floor) + 2 m = 8 m.
        Check(Math.Abs(shortest.metres - 8) < .001f, "Distance includes floor elevation cost");
        // Step-free route must avoid the stairs and use the lift instead.
        var accessible = RoutePlanner.Find(b, "start", "end", true);
        Check(accessible != null && !accessible.passages.Contains(Passage.Stairs) && accessible.passages.Contains(Passage.Lift), "Accessible route excludes stairs");
        Check(accessible.metres > shortest.metres, "Accessible detour is measured");   // the lift is further away
        Check(RoutePlanner.Find(b, "end", "start", true) != null, "Bidirectional routes");   // works backwards too
        Check(RoutePlanner.Find(b, "start", "start", true).nodes.Count == 1, "Already at destination");
        Check(RoutePlanner.Find(b, "unknown", "end", false) == null, "Unknown start");
        // Close the lift: no step-free route any more, but the stairs still work.
        b.connections[4].blocked = true;
        Check(RoutePlanner.Find(b, "start", "end", true) == null, "Blocked lift makes step-free route unavailable");
        Check(RoutePlanner.Find(b, "start", "end", false) != null, "Blocked lift still permits stairs");
        // Make the stairs one-way (up only): going back down is now impossible.
        b.connections[1].bidirectional = false;
        Check(RoutePlanner.Find(b, "end", "start", false) == null, "One-way links respected");
        // Close the stairs too: floor 1 can't be reached at all.
        b.connections[1].blocked = true;
        Check(RoutePlanner.Find(b, "start", "end", false) == null, "Disconnected graph");
        // Bad data must be caught by ValidateData: a negative cost (then put it back)...
        b.connections[0].extraMetres = -1;
        Check(b.ValidateData() != null, "Negative costs rejected"); b.connections[0].extraMetres = 0;
        // ...and two waypoints with the same id.
        b.waypoints[1].id = "start";
        Check(b.ValidateData() != null, "Duplicate node IDs rejected");
        Console.WriteLine("ROUTE_CHECKS_OK: " + count + " checks passed");
    }
}
