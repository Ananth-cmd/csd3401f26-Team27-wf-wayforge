using System;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace WayforgeApp.Editor
{
    public static class ModelRouteCheck
    {
        public static void RunChecks()
        {
            EditorSceneManager.OpenScene(PrototypeSetup.ScenePath);
            var app=UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>();
            var data=app.building;
            if(!AssetDatabase.GetAssetPath(data).StartsWith("Assets/WayforgeApp/Models")) throw new Exception("Scene does not use imported building data.");
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
            }

            Debug.Log("MODEL_ROUTE_CLEARANCE_OK: "+samples+" path samples avoid walls and remain over floor geometry.");
            CanvasFlowCheck.Run();
        }
    }
}
