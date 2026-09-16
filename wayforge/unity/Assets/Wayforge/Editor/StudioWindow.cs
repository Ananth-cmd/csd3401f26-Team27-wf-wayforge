// StudioWindow.cs - Wayforge Studio editor window. Week 1: only the plugin check exists.
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public class StudioWindow : EditorWindow
    {
        [MenuItem("Wayforge/Studio")]
        public static void Open() => GetWindow<StudioWindow>("Wayforge Studio");

        [MenuItem("Wayforge/Check native plugin")]
        public static void CheckPlugin()
        {
            if (NativeBridge.PluginLoads()) EditorUtility.DisplayDialog("Wayforge", $"Plugin loaded. Core {NativeBridge.Version()} on {NativeBridge.Platform()}.", "OK");
            else EditorUtility.DisplayDialog("Wayforge", "wayforge.dll not found. Run core\\script_build_and_run.bat, then restart Unity.", "OK");
        }

        void OnGUI() => EditorGUILayout.HelpBox("Wayforge Studio - TODO(IMGD2): plan canvas, room tagger.", MessageType.Info);
    }
}
