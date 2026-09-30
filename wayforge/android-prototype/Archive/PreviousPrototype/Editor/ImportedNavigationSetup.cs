using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;

namespace WayforgeApp.Editor
{
    // One-time demo authoring. Only the resulting editable data/prefabs ship in the app.
    public static class ImportedNavigationSetup
    {
        static readonly Vector2Int[] Directions = { Vector2Int.up, Vector2Int.right, Vector2Int.down, Vector2Int.left };
        static Vector3 Position(Vector2Int cell) => new Vector3(cell.x * .5f, .16f, cell.y * .5f);
        public static void RunChecks()
        {
            EditorSceneManager.OpenScene(CanvasDesigner.Scene);
            var app=UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>();
            var data=app.building;
            if(!AssetDatabase.GetAssetPath(data).StartsWith(ImportedFloorsSetup.Root)) throw new Exception("Scene does not use imported building data.");
            var serialized=new SerializedObject(app.map); var floors=serialized.FindProperty("floors"); int samples=0;
            for(int f=0;f<3;f++)
            {
                var floor=(GameObject)floors.GetArrayElementAtIndex(f).objectReferenceValue;
                if(PrefabUtility.GetCorrespondingObjectFromSource(floor)!=data.floors[f].model) throw new Exception("Wrong floor prefab.");
                var bounds=floor.GetComponentsInChildren<Renderer>(true).Select(r=>r.bounds).ToArray();
                var walls=bounds.Where(b=>b.size.y>.3f).ToArray(); var ground=bounds.Where(b=>b.size.y<.3f).ToArray();
                foreach(var edge in data.connections.Where(e=>e.passage==Passage.Corridor && data.Node(e.from).floor==f))
                {
                    var a=data.Node(edge.from).position; var b=data.Node(edge.to).position;
                    int steps=Mathf.CeilToInt(Vector3.Distance(a,b)/.1f);
                    for(int s=0;s<=steps;s++)
                    {
                        var p=Vector3.Lerp(a,b,(float)s/steps); samples++;
                        if(walls.Any(w=>p.x>w.min.x-.25f && p.x<w.max.x+.25f && p.z>w.min.z-.25f && p.z<w.max.z+.25f)) throw new Exception("Route touches a wall: "+edge.from+" → "+edge.to);
                        if(!ground.Any(g=>p.x>g.min.x && p.x<g.max.x && p.z>g.min.z && p.z<g.max.z)) throw new Exception("Route leaves floor geometry.");
                    }
                }
                int index=1; foreach(var node in data.waypoints.Where(n=>n.floor==f && n.id.Contains("-turn-"))) node.label="Corridor checkpoint "+index++;
            }
            EditorUtility.SetDirty(data); AssetDatabase.SaveAssets();
            Debug.Log("MODEL_ROUTE_CLEARANCE_OK: "+samples+" path samples avoid walls and remain over floor geometry.");
            CanvasFlowCheck.Run();
        }
        public static void Apply()
        {
            const string root = ImportedFloorsSetup.Root;
            string dataPath = root + "/Prepared/Navigation.asset";
            if (AssetDatabase.LoadAssetAtPath<BuildingDefinition>(dataPath)) throw new Exception("Imported navigation already exists. Edit its data and scene rather than rebuilding over manual changes.");
            ImportedFloorsSetup.Inspect();
            Directory.CreateDirectory("Documentation/Backups");
            File.Copy(CanvasDesigner.Scene, "Documentation/Backups/SIT-before-imported-models.unity", false);
            var scene = EditorSceneManager.OpenScene(CanvasDesigner.Scene);
            var app = UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>();
            var data = ScriptableObject.CreateInstance<BuildingDefinition>(); data.buildingName = "SIT - supplied models"; data.illustrative = true;
            data.floors = new FloorDefinition[3];
            var nodes = new List<Waypoint>(); var links = new List<Connection>(); var places = new List<Place>();
            var serialized = new SerializedObject(app.map); var floors = serialized.FindProperty("floors");
            for (int i=0;i<floors.arraySize;i++) UnityEngine.Object.DestroyImmediate(floors.GetArrayElementAtIndex(i).objectReferenceValue);
            floors.arraySize = 3;
            for (int f=0; f<3; f++)
            {
                string prefix = "L"+(f+1);
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(root + "/Prepared/Level "+(f+1)+".prefab");
                var instance = (GameObject)PrefabUtility.InstantiatePrefab(prefab); instance.transform.SetParent(app.map.transform,false);
                data.floors[f] = new FloorDefinition { name="Level "+(f+1), model=prefab };
                floors.GetArrayElementAtIndex(f).objectReferenceValue=instance;
                var bounds = instance.GetComponentsInChildren<Renderer>().Select(r=>r.bounds).ToArray();
                var walls = bounds.Where(b=>b.size.y>.3f).ToArray(); var ground=bounds.Where(b=>b.size.y<.3f).ToArray();
                bool Free(Vector3 p) => ground.Any(b=>p.x>b.min.x+.2f && p.x<b.max.x-.2f && p.z>b.min.z+.2f && p.z<b.max.z-.2f) && !walls.Any(b=>p.x>b.min.x-.3f && p.x<b.max.x+.3f && p.z>b.min.z-.3f && p.z<b.max.z+.3f);
                var free=new HashSet<Vector2Int>();
                for(int x=-32;x<=32;x++) for(int z=-38;z<=38;z++) if(Free(Position(new Vector2Int(x,z)))) free.Add(new Vector2Int(x,z));
                Vector2Int Nearest(float x,float z) => free.OrderBy(c=>(Position(c)-new Vector3(x,.16f,z)).sqrMagnitude).First();
                var targets=new[]{Nearest(-11,-12),Nearest(11,-12),Nearest(0,3),Nearest(-12,10),Nearest(12,10)};
                var lookup=new Dictionary<Vector2Int,string>();
                string Node(Vector2Int cell)
                {
                    if(lookup.TryGetValue(cell,out var id)) return id;
                    id=prefix+"-turn-"+lookup.Count; lookup[cell]=id;
                    nodes.Add(new Waypoint{id=id,label="Corridor turn",floor=f,position=Position(cell)}); return id;
                }
                for(int t=0;t<5;t++)
                {
                    string id=prefix+(t<3?"-0"+(t+1):t==3?"-stairs":"-lift");
                    string label=t<3?"Demo room "+(char)('A'+t)+" (Level "+(f+1)+")":t==3?"Demo stairs":"Demo lift";
                    lookup[targets[t]]=id; nodes.Add(new Waypoint{id=id,label=label,floor=f,position=Position(targets[t])});
                    if(t<3) places.Add(new Place{id=id,code=id,name=label,waypointId=id,category="Rooms",description="Demo destination on your supplied Level "+(f+1)+" model. Room names, scale and floor transfers are illustrative."});
                }
                for(int destination=0;destination<4;destination++) for(int connector=3;connector<=4;connector++)
                {
                    if(destination==connector) continue;
                    var start=targets[destination]; var end=targets[connector];
                    var queue=new Queue<Vector2Int>(); var previous=new Dictionary<Vector2Int,Vector2Int>(); queue.Enqueue(start); previous[start]=start;
                    while(queue.Count>0 && !previous.ContainsKey(end))
                    {
                        var at=queue.Dequeue(); foreach(var direction in Directions)
                        {
                            var next=at+direction;
                            if(!free.Contains(next)||previous.ContainsKey(next)||!Free((Position(at)+Position(next))*.5f)) continue;
                            previous[next]=at; queue.Enqueue(next);
                        }
                    }
                    if(!previous.ContainsKey(end)) throw new Exception(prefix+" demo destination is disconnected.");
                    var path=new List<Vector2Int>{end}; while(path.Last()!=start) path.Add(previous[path.Last()]); path.Reverse();
                    var corners=new List<Vector2Int>{start};
                    for(int i=1;i<path.Count-1;i++) if(path[i]-path[i-1]!=path[i+1]-path[i] || lookup.ContainsKey(path[i])) corners.Add(path[i]);
                    corners.Add(end);
                    for(int i=1;i<corners.Count;i++)
                    {
                        string a=Node(corners[i-1]),b=Node(corners[i]); if(a==b || links.Any(e=>(e.from==a&&e.to==b)||(e.from==b&&e.to==a))) continue;
                        links.Add(new Connection{from=a,to=b,passage=Passage.Corridor});
                    }
                }
                if(f>0) foreach(string kind in new[]{"stairs","lift"}) links.Add(new Connection{from="L"+f+"-"+kind,to=prefix+"-"+kind,passage=kind=="lift"?Passage.Lift:Passage.Stairs,extraMetres=kind=="lift"?50:0});
                instance.SetActive(f==0); PrefabUtility.RecordPrefabInstancePropertyModifications(instance);
            }
            serialized.ApplyModifiedPropertiesWithoutUndo(); data.waypoints=nodes.ToArray(); data.connections=links.ToArray(); data.places=places.ToArray();
            if(data.ValidateData()!=null) throw new Exception(data.ValidateData());
            foreach(var a in places) foreach(var b in places) foreach(bool accessible in new[]{false,true})
                if(RoutePlanner.Find(data,a.waypointId,b.waypointId,accessible)==null) throw new Exception("Missing demo route: "+a.id+" to "+b.id);
            AssetDatabase.CreateAsset(data,dataPath); app.building=data;
            foreach(var text in scene.GetRootGameObjects().SelectMany(r=>r.GetComponentsInChildren<Text>(true)))
            {
                if(text.name=="Prototype note") text.text="Your models · demo locations and routes";
                if(text.text=="Explore Board Room →") text.text="Explore Level 3 demo room →";
                if(text.text=="The building is illustrative. Progress is confirmed manually.") text.text="Your supplied models. Demo room names, scale and floor transfers. Progress is manual.";
                if(PrefabUtility.IsPartOfPrefabInstance(text)) PrefabUtility.RecordPrefabInstancePropertyModifications(text);
            }
            EditorSceneManager.MarkSceneDirty(scene); EditorSceneManager.SaveScene(scene); AssetDatabase.SaveAssets();
            Debug.Log("IMPORTED_NAVIGATION_OK: 3 supplied floors, 9 demo places, 162 reachable route checks; "+nodes.Count+" waypoints.");
        }
    }
}
