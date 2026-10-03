/*!
 * \file ScreenPreviewEditor.cs
 * \brief custom inspector for picking which app screen to edit
 *
 * when you select AppController, instead of the normal inspector you
 * get an "Edit <screen>" button for every screen. clicking one hides the
 * others and selects it so you can edit it in the Hierarchy.
 * editor only, doesnt go into the APK.
 *
 * \author Katie
 *
 * Contribution: Katie
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-10-03
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace WayforgeApp.Editor
{
    // replaces the inspector for CanvasNavigator (the AppController object)
    [CustomEditor(typeof(CanvasNavigator))]
    public class ScreenPreviewEditor : UnityEditor.Editor
    {
        // if the normal fields are shown or folded
        bool showConnections;

        public override void OnInspectorGUI()
        {
            var app = (CanvasNavigator)target;
            // quick help text at the top
            EditorGUILayout.HelpBox("Choose a screen, then select its elements in the Hierarchy to edit them. Save changes outside Play mode.", MessageType.Info);
            // greyed out in play mode cus changes there dont save
            using (new EditorGUI.DisabledScope(Application.isPlaying))
            {
                // 1 button per screen in the AppScreen enum
                foreach (AppScreen screen in Enum.GetValues(typeof(AppScreen)))
                {
                    if (!GUILayout.Button("Edit " + screen)) continue;
                    // so ctrl+z can undo the show/hide
                    foreach (var page in app.screens) Undo.RecordObject(page, "Preview screen");
                    // show only the screen that was clicked
                    for (int i = 0; i < app.screens.Length; i++)
                        app.screens[i].SetActive(i == (int)screen);
                    // select it + zoom the scene view to it
                    Selection.activeGameObject = app.screens[(int)screen];
                    SceneView.lastActiveSceneView?.FrameSelected();
                    // mark the scene as changed so unity asks to save
                    EditorSceneManager.MarkSceneDirty(app.gameObject.scene);
                }
            }
            // the original inspector fields, hidden in a foldout
            showConnections = EditorGUILayout.Foldout(showConnections, "Building and UI connections", true);
            if (showConnections) DrawDefaultInspector();
        }
    }
}
