/*!
 * \file ModelRouteCheck.cs
 * \brief Editor check: every corridor route stays on the floor and away from walls
 *
 * Opens the app's main scene and, for every corridor connection in the
 * building data, walks along it in 10 cm steps. At each step it checks the
 * point is not within 25 cm of a wall and is still above the floor of the
 * 3D model. This catches route data that would draw a line through a wall.
 * When everything passes it logs "MODEL_ROUTE_CLEARANCE_OK" and then runs
 * CanvasFlowCheck (the app-screen checks).
 *
 * Links: reads the building data (BuildingDefinition / Navigation.asset) and
 * the floor models assigned in BuildingMap. Uses PrototypeSetup.ScenePath to
 * find the scene.
 *
 * C# notes: this is an Editor script (it's in an "Editor" folder), so it only
 * runs inside the Unity Editor and is not included in the phone app.
 * ".Where(x => ...)" keeps only the items for which the test is true;
 * ".Select(x => ...)" turns each item into something else; ".Any(x => ...)"
 * asks "is the test true for at least one item?".
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Wall-clearance and on-floor sampling of every corridor link against the 3D models
 *   - Check that the scene uses the imported building data and matching floor prefabs
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-10-01
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;                     // Exception.
using System.Linq;                // Where / Select / Any / ToArray list helpers.
using UnityEditor;                // Editor-only tools: AssetDatabase, SerializedObject, PrefabUtility.
using UnityEditor.SceneManagement; // EditorSceneManager: opening scenes from code.
using UnityEngine;                // GameObject, Renderer, Bounds, Vector3, Mathf, Debug.

namespace WayforgeApp.Editor
{
    public static class ModelRouteCheck
    {
        // Runs the check. Throws an Exception (stops with an error message) on the first problem.
        public static void RunChecks()
        {
            // Open the app's main scene and find the app controller and its building data.
            EditorSceneManager.OpenScene(PrototypeSetup.ScenePath);
            var app=UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>();
            var data=app.building;
            // Make sure the scene uses the real imported building data, not a test copy elsewhere.
            if(!AssetDatabase.GetAssetPath(data).StartsWith("Assets/WayforgeApp/Models")) throw new Exception("Scene does not use imported building data.");
            // Read BuildingMap's private "floors" list (SerializedObject can read fields scripts can't normally reach).
            var serialized=new SerializedObject(app.map); var floors=serialized.FindProperty("floors"); int samples=0;
            // The building has 3 floors (0, 1, 2).
            for(int f=0;f<3;f++)
            {
                var floor=(GameObject)floors.GetArrayElementAtIndex(f).objectReferenceValue;
                // The floor model in the scene must be the same model the building data says.
                if(PrefabUtility.GetCorrespondingObjectFromSource(floor)!=data.floors[f].model) throw new Exception("Wrong floor prefab.");
                // Get a box around every visible part of this floor's model.
                var bounds=floor.GetComponentsInChildren<Renderer>(true).Select(r=>r.bounds).ToArray();
                // Tall parts (over 30 cm high) are treated as walls; flat parts as floor.
                var walls=bounds.Where(b=>b.size.y>.3f).ToArray(); var ground=bounds.Where(b=>b.size.y<.3f).ToArray();
                // Every corridor connection that starts on this floor (stairs and lifts aren't walked along).
                foreach(var edge in data.connections.Where(e=>e.passage==Passage.Corridor && data.Node(e.from).floor==f))
                {
                    var a=data.Node(edge.from).position; var b=data.Node(edge.to).position;
                    // Number of 10 cm steps along this connection (CeilToInt = round up).
                    int steps=Mathf.CeilToInt(Vector3.Distance(a,b)/.1f);
                    for(int s=0;s<=steps;s++)
                    {
                        // Lerp = the point s/steps of the way from a to b.
                        var p=Vector3.Lerp(a,b,(float)s/steps); samples++;
                        // Fail if the point is inside any wall box widened by 25 cm on each side (seen from above: x and z).
                        if(walls.Any(w=>p.x>w.min.x-.25f && p.x<w.max.x+.25f && p.z>w.min.z-.25f && p.z<w.max.z+.25f)) throw new Exception("Route touches a wall: "+edge.from+" → "+edge.to);
                        // Fail if the point is not above any piece of floor.
                        if(!ground.Any(g=>p.x>g.min.x && p.x<g.max.x && p.z>g.min.z && p.z<g.max.z)) throw new Exception("Route leaves floor geometry.");
                    }
                }
            }

            // Everything passed: report how many points were checked, then run the app-screen checks.
            Debug.Log("MODEL_ROUTE_CLEARANCE_OK: "+samples+" path samples avoid walls and remain over floor geometry.");
            CanvasFlowCheck.Run();
        }
    }
}
