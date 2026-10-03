/*!
 * \file BuildingDefinition.cs
 * \brief Building data (floors, waypoints, connections, places) and the route planner
 *
 * This file holds two things:
 *   1. The DATA describing a building: its floors, the walkable points
 *      ("waypoints"), the links between them ("connections"), and the
 *      places a user can search for (rooms, toilets...). The actual numbers
 *      live in Models/WayForge/Prepared/Navigation.asset, which Unity fills
 *      using the classes below.
 *   2. The ROUTE PLANNER (RoutePlanner.Find, at the bottom): finds the
 *      shortest route between two waypoints, optionally avoiding stairs.
 *
 * Links: CanvasNavigator.cs calls RoutePlanner.Find when the user asks for
 * directions; BuildingMap.cs draws the Route it returns; Tools/RouteChecks.cs
 * tests RoutePlanner.Find; Editor/Checks/ModelRouteCheck.cs checks the
 * connections against the 3D floor models.
 *
 * C# quick guide for readers new to the language:
 *   - "using X;"            = like #include / import: lets this file use library X.
 *   - "namespace X { }"     = a name folder so our classes don't clash with others.
 *   - "class"               = a blueprint for an object (fields = its data, methods = its functions).
 *   - "public"              = usable from other files; no keyword means private (this file/class only).
 *   - "sealed"              = nobody can make a sub-class of it.
 *   - "static"              = belongs to the class itself, no object needed (call it as ClassName.Method()).
 *   - "[Something]"         = an attribute: a label that tells Unity how to treat the next item.
 *   - "x => expression"     = a short function; "Method() => value;" means "Method returns value".
 *   - "a ? b : c"           = if a then b else c.
 *   - "var x = ..."         = let the compiler work out x's type.
 *   - "null"                = "nothing here" (no object).
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Building data model (floors, waypoints, connections, places) with validation
 *   - Dijkstra route planner with step-free, blocked and one-way link support
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-10-01
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;                       // Array, Serializable and other basic .NET types.
using System.Collections.Generic;   // List, Dictionary and HashSet collections.
using UnityEngine;                  // Unity types: ScriptableObject, Vector3, Mathf, GameObject...

namespace WayforgeApp
{
    // [CreateAssetMenu] adds "Wayforge App/Building" to Unity's right-click > Create menu,
    // so a designer can make a new building data file without writing code.
    [CreateAssetMenu(menuName = "Wayforge App/Building", fileName = "Building")]
    // ScriptableObject = a Unity data file (.asset) that stores the fields below. Navigation.asset is one of these.
    public sealed class BuildingDefinition : ScriptableObject
    {
        public string buildingName = "SIT";                                    // name shown in the app, also used in saved-place keys
        public bool illustrative = true;                                       // true = sample data, not a real survey
        // "X[]" is an array (fixed-size list). Array.Empty<X>() starts each one as an empty list instead of null.
        public FloorDefinition[] floors = Array.Empty<FloorDefinition>();      // one entry per floor, ground floor first
        public Waypoint[] waypoints = Array.Empty<Waypoint>();                 // walkable points the route can pass through
        public Connection[] connections = Array.Empty<Connection>();           // which waypoints you can walk between
        public Place[] places = Array.Empty<Place>();                          // searchable destinations, each sitting on a waypoint

        // Checks the data makes sense. Returns null if everything is fine,
        // otherwise a message describing the first problem found.
        public string ValidateData()
        {
            // "||" means OR: any one of these being true is a problem.
            if (floors == null || floors.Length == 0) return "Add at least one floor.";
            if (waypoints == null || waypoints.Length == 0) return "Add navigation waypoints.";
            if (connections == null || places == null) return "Connections and places must not be null.";
            // HashSet = a list with no duplicates. ids.Add(x) returns false if x was already in it.
            var ids = new HashSet<string>();
            // "foreach (var n in waypoints)" = run the block once for every waypoint, calling it n.
            foreach (var n in waypoints)
            {
                // Every waypoint needs a unique, non-blank id ("!" means NOT).
                if (n == null || string.IsNullOrWhiteSpace(n.id) || !ids.Add(n.id)) return "Waypoint IDs must be non-empty and unique.";
                // Its floor number must point at a real floor (floors are numbered 0, 1, 2...).
                if (n.floor < 0 || n.floor >= floors.Length) return "Waypoint floor is out of range: " + n.id;
                // Its position must be a real number (not infinity or "not a number").
                if (!float.IsFinite(n.position.x) || !float.IsFinite(n.position.y) || !float.IsFinite(n.position.z)) return "Invalid waypoint position.";
            }
            foreach (var f in floors) if (f == null) return "A floor is missing.";
            // Every connection must join two different, existing waypoints and have a non-negative extra cost.
            foreach (var e in connections)
                if (e == null || !ids.Contains(e.from) || !ids.Contains(e.to) || e.from == e.to || !float.IsFinite(e.extraMetres) || e.extraMetres < 0)
                    return "Invalid connection endpoints or cost.";
            // Every place needs a unique id and must sit on an existing waypoint.
            var placeIds = new HashSet<string>();
            foreach (var p in places)
                if (p == null || string.IsNullOrWhiteSpace(p.id) || !placeIds.Add(p.id) || !ids.Contains(p.waypointId)) return "Invalid place ID or waypoint.";
            return null;   // no problems found
        }
        // Find the waypoint with this id (null if there is none).
        // "n => n.id == id" is a tiny function: "given a waypoint n, is its id the one we want?"
        public Waypoint Node(string id) => Array.Find(waypoints, n => n.id == id);
        // Which floor a place is on = the floor of the waypoint it sits on.
        public int FloorOf(Place p) => Node(p.waypointId).floor;
    }
    // [Serializable] lets Unity save these small classes inside the .asset file and show them in the Inspector.
    // One floor of the building.
    [Serializable] public sealed class FloorDefinition
    {
        public string name = "Level 1";
        // [Tooltip] = help text shown when hovering over the field in Unity's Inspector.
        [Tooltip("A static model prefab, with no authoring-tool scripts or native plugin dependencies.")]
        public GameObject model;   // the 3D model of this floor
    }
    // A point a person can walk to, e.g. a room door, a corridor corner, the stairs.
    [Serializable] public sealed class Waypoint
    {
        public string id;          // unique name, e.g. "L1-stairs"
        public string label;       // text shown to the user, e.g. "Demo stairs"
        public int floor;          // which floor (0 = first entry in floors)
        [Tooltip("Position in the floor prefab's local coordinates. One Unity unit is one metre.")]
        public Vector3 position;   // x, y, z position in metres
    }
    // "enum" = a fixed list of named options. A connection is one of these three kinds.
    public enum Passage { Corridor, Stairs, Lift }
    // A walkable link between two waypoints.
    [Serializable] public sealed class Connection
    {
        public string from, to;               // ids of the two waypoints it joins
        public Passage passage;               // corridor, stairs or lift
        public bool bidirectional = true;     // false = one-way (only from -> to)
        public bool blocked;                  // true = temporarily closed, the planner skips it
        // [Min(0)] stops a negative number being typed in the Inspector.
        [Min(0)] public float extraMetres;    // extra cost on top of the straight distance (e.g. waiting for a lift)
    }
    // Something the user can search for and pick as a start or destination.
    [Serializable] public sealed class Place
    {
        public string id, name, code, waypointId;   // waypointId = the waypoint where this place is
        public string category = "Rooms";           // used by the search filter buttons
        // [TextArea] shows a multi-line text box in the Inspector.
        [TextArea] public string description;
        public bool startingPoint = true;           // false = can't be chosen as "where am I now"
    }

    // The answer from the route planner: the waypoints to walk through, in order.
    public sealed class Route
    {
        // List<X> = a list that can grow. "readonly" = the list itself is never replaced (items can still be added).
        public readonly List<Waypoint> nodes = new List<Waypoint>();    // start ... destination
        public readonly List<Passage> passages = new List<Passage>();   // how each leg is travelled (one fewer than nodes)
        public float metres;                                            // total route cost in metres
        // Walking time estimate at 65 metres per minute, rounded up, at least 1 minute.
        public int Minutes => Mathf.Max(1, Mathf.CeilToInt(metres / 65f));
    }

    // "static class" = a holder for functions; you never create a RoutePlanner object.
    public static class RoutePlanner
    {
        // Dijkstra over explicitly surveyed walkable links. Never connects room centres through walls.
        //
        // Dijkstra's algorithm in plain words: start at the start point with cost 0 and
        // everything else at "infinity". Repeatedly pick the unvisited point with the lowest
        // cost so far, and see if going through it gives any neighbour a cheaper cost.
        // When the destination is picked, its cost is the shortest possible.
        //
        // stepFree = true skips every Stairs connection (for wheelchair users).
        // Returns null if the data is invalid, an id is unknown, or no route exists.
        public static Route Find(BuildingDefinition building, string start, string end, bool stepFree)
        {
            if (building.ValidateData() != null || building.Node(start) == null || building.Node(end) == null) return null;
            // Dictionary<K, V> = a lookup table from a key K to a value V (here: waypoint id -> something).
            var costs = new Dictionary<string, float>();       // cheapest cost found so far to reach each waypoint
            var previous = new Dictionary<string, string>();   // the waypoint we came from on that cheapest route
            var modes = new Dictionary<string, Passage>();     // how we got there (corridor / stairs / lift)
            var open = new HashSet<string>();                  // waypoints not yet finalised
            // Every waypoint starts at "infinity" (not reached yet) and unvisited.
            foreach (var n in building.waypoints) { costs[n.id] = float.PositiveInfinity; open.Add(n.id); }
            costs[start] = 0;
            while (open.Count > 0)
            {
                // Pick the unvisited waypoint with the lowest cost.
                string current = null;
                float best = float.PositiveInfinity;
                foreach (var id in open) if (costs[id] < best) { best = costs[id]; current = id; }
                if (current == null) break;          // everything left is unreachable
                open.Remove(current);                // its cost is now final
                if (current == end) break;           // reached the destination: done
                // Look at every connection that leaves the current waypoint.
                foreach (var edge in building.connections)
                {
                    // "continue" = skip to the next connection. Closed links, and stairs in step-free mode, are skipped.
                    if (edge.blocked || (stepFree && edge.passage == Passage.Stairs)) continue;
                    // The waypoint on the other end: "to" if we're at "from"; "from" if we're at "to" and the link is two-way;
                    // otherwise null (this connection doesn't touch current, or is one-way the wrong way).
                    string next = edge.from == current ? edge.to : edge.bidirectional && edge.to == current ? edge.from : null;
                    if (next == null || !open.Contains(next)) continue;
                    var a = building.Node(current); var b = building.Node(next);
                    // Cost of this leg = straight-line distance + any extra cost on the connection...
                    float length = Vector3.Distance(a.position, b.position) + edge.extraMetres;
                    // ...plus 4 metres per floor climbed or descended (Mathf.Abs = ignore the minus sign).
                    if (a.floor != b.floor) length += Mathf.Abs(a.floor - b.floor) * 4f;
                    // Total cost to reach "next" this way (every leg costs at least 1 cm).
                    float candidate = best + Mathf.Max(.01f, length);
                    if (candidate >= costs[next]) continue;   // not better than what we already have
                    // Cheaper route found: remember the cost, where we came from, and how.
                    costs[next] = candidate; previous[next] = current; modes[next] = edge.passage;
                }
            }
            if (float.IsPositiveInfinity(costs[end])) return null;   // destination never reached: no route
            // Build the answer by walking backwards from the destination to the start using "previous".
            var result = new Route { metres = costs[end] };
            string cursor = end;
            result.nodes.Add(building.Node(cursor));
            while (cursor != start)
            {
                result.passages.Add(modes[cursor]); cursor = previous[cursor]; result.nodes.Add(building.Node(cursor));
            }
            // The lists were filled destination-first, so flip them to read start -> destination.
            result.nodes.Reverse(); result.passages.Reverse();
            return result;
        }
    }
}
