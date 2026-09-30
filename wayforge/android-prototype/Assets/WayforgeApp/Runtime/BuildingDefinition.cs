using System;
using System.Collections.Generic;
using UnityEngine;

namespace WayforgeApp
{
    [CreateAssetMenu(menuName = "Wayforge App/Building", fileName = "Building")]
    public sealed class BuildingDefinition : ScriptableObject
    {
        public string buildingName = "SIT";
        public bool illustrative = true;
        public FloorDefinition[] floors = Array.Empty<FloorDefinition>();
        public Waypoint[] waypoints = Array.Empty<Waypoint>();
        public Connection[] connections = Array.Empty<Connection>();
        public Place[] places = Array.Empty<Place>();

        public string ValidateData()
        {
            if (floors == null || floors.Length == 0) return "Add at least one floor.";
            if (waypoints == null || waypoints.Length == 0) return "Add navigation waypoints.";
            if (connections == null || places == null) return "Connections and places must not be null.";
            var ids = new HashSet<string>();
            foreach (var n in waypoints)
            {
                if (n == null || string.IsNullOrWhiteSpace(n.id) || !ids.Add(n.id)) return "Waypoint IDs must be non-empty and unique.";
                if (n.floor < 0 || n.floor >= floors.Length) return "Waypoint floor is out of range: " + n.id;
                if (!float.IsFinite(n.position.x) || !float.IsFinite(n.position.y) || !float.IsFinite(n.position.z)) return "Invalid waypoint position.";
            }
            foreach (var f in floors) if (f == null) return "A floor is missing.";
            foreach (var e in connections)
                if (e == null || !ids.Contains(e.from) || !ids.Contains(e.to) || e.from == e.to || !float.IsFinite(e.extraMetres) || e.extraMetres < 0)
                    return "Invalid connection endpoints or cost.";
            var placeIds = new HashSet<string>();
            foreach (var p in places)
                if (p == null || string.IsNullOrWhiteSpace(p.id) || !placeIds.Add(p.id) || !ids.Contains(p.waypointId)) return "Invalid place ID or waypoint.";
            return null;
        }
        public Waypoint Node(string id) => Array.Find(waypoints, n => n.id == id);
        public int FloorOf(Place p) => Node(p.waypointId).floor;
    }
    [Serializable] public sealed class FloorDefinition
    {
        public string name = "Level 1";
        [Tooltip("A static model prefab, with no authoring-tool scripts or native plugin dependencies.")]
        public GameObject model;
    }
    [Serializable] public sealed class Waypoint
    {
        public string id;
        public string label;
        public int floor;
        [Tooltip("Position in the floor prefab's local coordinates. One Unity unit is one metre.")]
        public Vector3 position;
    }
    public enum Passage { Corridor, Stairs, Lift }
    [Serializable] public sealed class Connection
    {
        public string from, to;
        public Passage passage;
        public bool bidirectional = true;
        public bool blocked;
        [Min(0)] public float extraMetres;
    }
    [Serializable] public sealed class Place
    {
        public string id, name, code, waypointId;
        public string category = "Rooms";
        [TextArea] public string description;
        public bool startingPoint = true;
    }

    public sealed class Route
    {
        public readonly List<Waypoint> nodes = new List<Waypoint>();
        public readonly List<Passage> passages = new List<Passage>();
        public float metres;
        public int Minutes => Mathf.Max(1, Mathf.CeilToInt(metres / 65f));
    }

    public static class RoutePlanner
    {
        // Dijkstra over explicitly surveyed walkable links. Never connects room centres through walls.
        public static Route Find(BuildingDefinition building, string start, string end, bool stepFree)
        {
            if (building.ValidateData() != null || building.Node(start) == null || building.Node(end) == null) return null;
            // A building from our converter is routed by our C++ A* (wf_graph); the demo keeps this Dijkstra.
            if (WayforgeBuilding.IsLoaded(building)) return WayforgeBuilding.FindRoute(building, start, end, stepFree);
            var costs = new Dictionary<string, float>();
            var previous = new Dictionary<string, string>();
            var modes = new Dictionary<string, Passage>();
            var open = new HashSet<string>();
            foreach (var n in building.waypoints) { costs[n.id] = float.PositiveInfinity; open.Add(n.id); }
            costs[start] = 0;
            while (open.Count > 0)
            {
                string current = null;
                float best = float.PositiveInfinity;
                foreach (var id in open) if (costs[id] < best) { best = costs[id]; current = id; }
                if (current == null) break;
                open.Remove(current);
                if (current == end) break;
                foreach (var edge in building.connections)
                {
                    if (edge.blocked || (stepFree && edge.passage == Passage.Stairs)) continue;
                    string next = edge.from == current ? edge.to : edge.bidirectional && edge.to == current ? edge.from : null;
                    if (next == null || !open.Contains(next)) continue;
                    var a = building.Node(current); var b = building.Node(next);
                    float length = Vector3.Distance(a.position, b.position) + edge.extraMetres;
                    if (a.floor != b.floor) length += Mathf.Abs(a.floor - b.floor) * 4f;
                    float candidate = best + Mathf.Max(.01f, length);
                    if (candidate >= costs[next]) continue;
                    costs[next] = candidate; previous[next] = current; modes[next] = edge.passage;
                }
            }
            if (float.IsPositiveInfinity(costs[end])) return null;
            var result = new Route { metres = costs[end] };
            string cursor = end;
            result.nodes.Add(building.Node(cursor));
            while (cursor != start)
            {
                result.passages.Add(modes[cursor]); cursor = previous[cursor]; result.nodes.Add(building.Node(cursor));
            }
            result.nodes.Reverse(); result.passages.Reverse();
            return result;
        }
    }
}
