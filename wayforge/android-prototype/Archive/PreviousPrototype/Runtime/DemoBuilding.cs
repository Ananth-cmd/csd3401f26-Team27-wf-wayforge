using System.Collections.Generic;
using UnityEngine;

namespace WayforgeApp
{
    public static class DemoBuilding
    {
        public static BuildingDefinition Create()
        {
            var b = ScriptableObject.CreateInstance<BuildingDefinition>();
            b.floors = new[] { new FloorDefinition { name = "Level 1" }, new FloorDefinition { name = "Level 2" }, new FloorDefinition { name = "Level 3" } };
            var nodes = new List<Waypoint>(); var edges = new List<Connection>(); var places = new List<Place>();
            for (int f = 0; f < 3; f++)
            {
                string pre = "L" + (f + 1);
                AddNode(nodes, pre + "-west", "West corridor", f, -8, 0);
                AddNode(nodes, pre + "-middle", "Central corridor", f, 0, 0);
                AddNode(nodes, pre + "-east", "East corridor", f, 8, 0);
                AddNode(nodes, pre + "-stairs", "Staircase", f, -11, 0);
                AddNode(nodes, pre + "-lift", "Lift lobby", f, 11, 0);
                Link(edges, pre + "-stairs", pre + "-west"); Link(edges, pre + "-west", pre + "-middle");
                Link(edges, pre + "-middle", pre + "-east"); Link(edges, pre + "-east", pre + "-lift");
                for (int r = 0; r < 3; r++)
                {
                    string id = pre + "-0" + (r + 1);
                    string name = f == 0 ? new[] { "Main entrance", "Reception", "Visitor lounge" }[r] : f == 1 ? new[] { "Pantry", "Restrooms", "Game Room" }[r] : new[] { "Project studio", "Board Room", "Meeting room" }[r];
                    string category = name == "Pantry" ? "Food" : name == "Restrooms" || f == 0 ? "Facilities" : "Rooms";
                    AddNode(nodes, id, name, f, (r - 1) * 8, -4);
                    Link(edges, id, pre + new[] { "-west", "-middle", "-east" }[r]);
                    places.Add(new Place { id = id, name = name, code = id, waypointId = id, category = category, description = "Enter through the doorway off the central corridor. This is an illustrative location for the app demo." });
                }
                if (f > 0)
                {
                    Link(edges, "L" + f + "-stairs", pre + "-stairs", Passage.Stairs);
                    Link(edges, "L" + f + "-lift", pre + "-lift", Passage.Lift, 12);
                }
            }
            b.waypoints = nodes.ToArray(); b.connections = edges.ToArray(); b.places = places.ToArray();
            return b;
        }
        static void AddNode(List<Waypoint> list, string id, string label, int floor, float x, float z)
            => list.Add(new Waypoint { id = id, label = label, floor = floor, position = new Vector3(x, .12f, z) });
        static void Link(List<Connection> list, string a, string b, Passage mode = Passage.Corridor, float extra = 0)
            => list.Add(new Connection { from = a, to = b, passage = mode, extraMetres = extra });

        public static GameObject MakeFloor(int index, Material floor, Material wall, Material accent)
        {
            var root = new GameObject("Illustrative floor " + (index + 1));
            Box(root, "Foundation", new Vector3(0, -.2f, 0), new Vector3(26, .35f, 14), floor);
            Box(root, "North wall", new Vector3(0, .65f, 7), new Vector3(26, 1.3f, .18f), wall);
            Box(root, "South wall", new Vector3(0, .65f, -7), new Vector3(26, 1.3f, .18f), wall);
            Box(root, "West wall", new Vector3(-13, .65f, 0), new Vector3(.18f, 1.3f, 14), wall);
            Box(root, "East wall", new Vector3(13, .65f, 0), new Vector3(.18f, 1.3f, 14), wall);
            for (int r = 0; r < 3; r++)
            {
                float x = (r - 1) * 8;
                foreach (int side in new[] { -1, 1 })
                {
                    Box(root, "Room floor", new Vector3(x, .01f, side * 4.5f), new Vector3(7.7f, .05f, 4.8f), r == 1 ? accent : floor);
                    // Two wall pieces leave a real doorway on the route into each room.
                    Box(root, "Door wall left", new Vector3(x - 2.45f, .65f, side * 2), new Vector3(2.9f, 1.3f, .15f), wall);
                    Box(root, "Door wall right", new Vector3(x + 2.45f, .65f, side * 2), new Vector3(2.9f, 1.3f, .15f), wall);
                    if (r < 2) Box(root, "Partition", new Vector3(x + 4, .65f, side * 4.5f), new Vector3(.15f, 1.3f, 5), wall);
                }
            }
            return root;
        }
        static void Box(GameObject parent, string name, Vector3 pos, Vector3 size, Material mat)
        {
            var obj = GameObject.CreatePrimitive(PrimitiveType.Cube); obj.name = name;
            obj.transform.SetParent(parent.transform, false); obj.transform.localPosition = pos; obj.transform.localScale = size;
            obj.GetComponent<Renderer>().sharedMaterial = mat;
        }
    }
}
