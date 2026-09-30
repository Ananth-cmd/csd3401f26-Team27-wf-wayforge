using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace WayforgeApp.Editor
{
    // Run once after moving assets. Asset GUIDs and component references stay intact.
    public static class ProjectCleanup
    {
        public static void Run()
        {
            var scene = EditorSceneManager.OpenScene(PrototypeSetup.ScenePath);
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var item in root.GetComponentsInChildren<Transform>(true))
                {
                    item.name = item.name.Replace(" - edit me", "").Replace("Dynamic - ", "")
                        .Replace(" - editable", "").Replace(" - supplied model", "");
                    switch (item.name)
                    {
                        case "App behaviour - connect UI here": item.name = "AppController"; break;
                        case "SIT App Canvas": item.name = "Canvas"; break;
                        case "Design board - 390 x 844": item.name = "Screens"; break;
                        case "Building floor prefabs": item.name = "Building"; break;
                        case "UI EventSystem": item.name = "EventSystem"; break;
                    }
                    if (PrefabUtility.IsPartOfPrefabInstance(item.gameObject))
                        PrefabUtility.RecordPrefabInstancePropertyModifications(item.gameObject);
                }
            }
            EditorSceneManager.SaveScene(scene);
            PrototypeSetup.Setup();
            Debug.Log("PROJECT_CLEANUP_OK");
            CanvasFlowCheck.Run();
        }
    }
}
