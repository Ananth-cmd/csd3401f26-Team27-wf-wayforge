using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace WayforgeApp.Editor
{
    [CustomEditor(typeof(CanvasNavigator))]
    public class ScreenPreviewEditor : UnityEditor.Editor
    {
        bool showConnections;

        public override void OnInspectorGUI()
        {
            var app = (CanvasNavigator)target;
            EditorGUILayout.HelpBox("Choose a screen, then select its elements in the Hierarchy to edit them. Save changes outside Play mode.", MessageType.Info);
            using (new EditorGUI.DisabledScope(Application.isPlaying))
            {
                foreach (AppScreen screen in Enum.GetValues(typeof(AppScreen)))
                {
                    if (!GUILayout.Button("Edit " + screen)) continue;
                    foreach (var page in app.screens) Undo.RecordObject(page, "Preview screen");
                    for (int i = 0; i < app.screens.Length; i++)
                        app.screens[i].SetActive(i == (int)screen);
                    Selection.activeGameObject = app.screens[(int)screen];
                    SceneView.lastActiveSceneView?.FrameSelected();
                    EditorSceneManager.MarkSceneDirty(app.gameObject.scene);
                }
            }
            showConnections = EditorGUILayout.Foldout(showConnections, "Building and UI connections", true);
            if (showConnections) DrawDefaultInspector();
        }
    }
}
