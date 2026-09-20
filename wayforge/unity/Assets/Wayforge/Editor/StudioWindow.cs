// StudioWindow.cs
//
// Week 1 deliverable (Work Breakdown, IMGD 2 row), extended through
// weeks 2-3 to host PlanCanvas and RoomTagger once those existed.
//
// Owns: the EditorWindow itself, the toolbar (Open/Save/Undo/Redo/Build
// graph, Graph+Confidence toggles, level slider), keyboard shortcuts, and
// the top-level layout (canvas left, 292px sidebar right, status bar
// bottom). Delegates all actual drawing to PlanCanvas and RoomTagger --
// this file should never draw a wall or a room itself.
//
// Gets its IWayforgeDocument from DocumentProvider.Current -- never
// constructs one directly. See DocumentProvider.cs for why.

using System;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public class StudioWindow : UnityEditor.EditorWindow
    {
        [MenuItem("Wayforge/Studio")]
        public static void Open()
        {
            var window = GetWindow<StudioWindow>("Wayforge Studio");
            window.minSize = new Vector2(700, 420);
            window.Show();
        }

        // Pre-existing menu item (per the week-1 spec: "keep the existing
        // Wayforge/Check native plugin menu item working"). Lives here
        // rather than a separate file since it's a one-liner and directly
        // relevant to Studio's own open-flow check below.
        [MenuItem("Wayforge/Check native plugin")]
        public static void CheckNativePlugin()
        {
            var doc = DocumentProvider.Current;
            if (doc.NativePluginLoaded)
            {
                EditorUtility.DisplayDialog(
                    "Wayforge native plugin",
                    $"Plugin loaded OK.\nVersion: {doc.NativeVersion}",
                    "OK");
            }
            else
            {
                EditorUtility.DisplayDialog(
                    "Wayforge native plugin",
                    "The native plugin (wayforge.dll / .so / .dylib) did not load.\n\n" +
                    "Check Console for the specific load error, and confirm the plugin " +
                    "is present under Assets/Plugins for your platform.",
                    "OK");
            }
        }

        private PlanCanvas _canvas;
        private RoomTagger _tagger;
        private IWayforgeDocument _doc;

        private const float ToolbarHeight = 22f;
        private const float StatusBarHeight = 20f;
        private const float LevelSliderWidth = 160f;

        private string _statusMessage = "";
        private double _statusMessageExpiry;

        private void OnEnable()
        {
            _canvas = new PlanCanvas();
            _tagger = new RoomTagger();
            _doc = DocumentProvider.Current;

            // Domain reloads (script recompiles) call OnEnable again on
            // the same window instance with a FRESH DocumentProvider
            // (statics reset) -- doc will report IsOpen == false even if
            // the user had a file open a moment ago. That's an accepted
            // gap for M1: the fix is either (a) reopening from a
            // remembered path via EditorPrefs, or (b) the real
            // WayforgeDocument surviving reloads by re-attaching to the
            // still-loaded native document rather than recreating it.
            // Neither is in scope until the real document exists -- note
            // it here so it isn't forgotten, but don't build it against
            // the fake/dummy data.
        }

        private void OnDisable()
        {
            // CRITICAL: dispose the document. The real implementation
            // holds native (C++) memory -- if this doesn't run, that
            // memory leaks for the lifetime of the Unity process, not just
            // the window. This is exactly why IWayforgeDocument : IDisposable
            // rather than relying on GC finalization.
            DocumentProvider.Reset();
        }

        private void OnGUI()
        {
            HandleShortcuts();

            DrawToolbar();

            Rect body = new Rect(0, ToolbarHeight, position.width, position.height - ToolbarHeight - StatusBarHeight);
            Rect canvasRect = new Rect(body.x, body.y, body.width - RoomTagger.SidebarWidth, body.height);
            Rect sidebarRect = new Rect(canvasRect.xMax, body.y, RoomTagger.SidebarWidth, body.height);

            _canvas.HandleInput(_doc, _doc.CurrentLevel, canvasRect);
            _canvas.Draw(_doc, _doc.CurrentLevel, canvasRect);

            EditorGUI.DrawRect(sidebarRect, new Color(0.24f, 0.24f, 0.26f, 1f));
            _tagger.Draw(_doc, _doc.CurrentLevel, _canvas, sidebarRect);

            DrawStatusBar();

            // Repaint continuously while the mouse is over the canvas so
            // pan/zoom/hover feel responsive rather than only updating on
            // the next unrelated event. Cheap at this scale (small
            // buildings, IMGUI) -- revisit only if profiling under RTIS 1's
            // week-11 perf pass says otherwise.
            if (mouseOverWindow == this) Repaint();
        }

        private void DrawToolbar()
        {
            GUILayout.BeginHorizontal(EditorStyles.toolbar, GUILayout.Height(ToolbarHeight));

            using (new EditorGUI.DisabledScope(false))
            {
                if (GUILayout.Button("Open", EditorStyles.toolbarButton, GUILayout.Width(50)))
                    DoOpen();

                using (new EditorGUI.DisabledScope(!_doc.IsOpen || !_doc.IsDirty))
                {
                    if (GUILayout.Button("Save", EditorStyles.toolbarButton, GUILayout.Width(50)))
                        DoSave();
                }
            }

            GUILayout.Space(6);
            EditorGUI.BeginDisabledGroup(!_doc.IsOpen);
            GUILayout.Box("", EditorStyles.toolbarButton, GUILayout.Width(1), GUILayout.Height(ToolbarHeight)); // thin separator
            EditorGUI.EndDisabledGroup();
            GUILayout.Space(6);

            using (new EditorGUI.DisabledScope(!_doc.IsOpen || !_doc.CanUndo))
            {
                if (GUILayout.Button("Undo", EditorStyles.toolbarButton, GUILayout.Width(50)))
                    DoUndo();
            }
            using (new EditorGUI.DisabledScope(!_doc.IsOpen || !_doc.CanRedo))
            {
                if (GUILayout.Button("Redo", EditorStyles.toolbarButton, GUILayout.Width(50)))
                    DoRedo();
            }

            GUILayout.Space(6);

            using (new EditorGUI.DisabledScope(!_doc.IsOpen))
            {
                if (GUILayout.Button("Build graph", EditorStyles.toolbarButton, GUILayout.Width(85)))
                    DoBuildGraph();
            }

            GUILayout.FlexibleSpace();

            _canvas.ShowGraph = GUILayout.Toggle(_canvas.ShowGraph, "Graph", EditorStyles.toolbarButton, GUILayout.Width(50));
            _canvas.ShowConfidence = GUILayout.Toggle(_canvas.ShowConfidence, "Confidence", EditorStyles.toolbarButton, GUILayout.Width(80));

            GUILayout.Space(10);

            if (_doc.IsOpen && _doc.LevelCount > 1)
            {
                GUILayout.Label(_doc.LevelName(_doc.CurrentLevel), EditorStyles.toolbarButton, GUILayout.Width(70));
                int newLevel = (int)GUILayout.HorizontalSlider(_doc.CurrentLevel, 0, _doc.LevelCount - 1, GUILayout.Width(LevelSliderWidth));
                if (newLevel != _doc.CurrentLevel)
                {
                    _doc.CurrentLevel = newLevel;
                    _canvas.ClearSelection();
                }
            }

            GUILayout.EndHorizontal();
        }

        private void DrawStatusBar()
        {
            Rect statusRect = new Rect(0, position.height - StatusBarHeight, position.width, StatusBarHeight);
            EditorGUI.DrawRect(statusRect, new Color(0.16f, 0.16f, 0.18f, 1f));

            GUILayout.BeginArea(statusRect);
            GUILayout.BeginHorizontal();

            string left = !_doc.IsOpen
                ? "No document open."
                : $"{_doc.BuildingName}{(_doc.IsDirty ? " *" : "")}  —  {_doc.Walls(_doc.CurrentLevel).Count} walls, {_doc.Rooms(_doc.CurrentLevel).Count} rooms";
            GUILayout.Label(left, EditorStyles.miniLabel);

            GUILayout.FlexibleSpace();

            if (!string.IsNullOrEmpty(_statusMessage) && EditorApplication.timeSinceStartup < _statusMessageExpiry)
                GUILayout.Label(_statusMessage, EditorStyles.miniLabel);
            else if (!_doc.NativePluginLoaded)
                GUILayout.Label("⚠ native plugin not loaded", EditorStyles.miniLabel);

            GUILayout.EndHorizontal();
            GUILayout.EndArea();
        }

        private void HandleShortcuts()
        {
            Event e = Event.current;
            if (e.type != EventType.KeyDown) return;
            bool ctrl = e.control || e.command; // command on macOS

            if (ctrl && e.keyCode == KeyCode.Z && !e.shift)
            {
                if (_doc.IsOpen && _doc.CanUndo) DoUndo();
                e.Use();
            }
            else if (ctrl && (e.keyCode == KeyCode.Y || (e.keyCode == KeyCode.Z && e.shift)))
            {
                if (_doc.IsOpen && _doc.CanRedo) DoRedo();
                e.Use();
            }
            else if (ctrl && e.keyCode == KeyCode.S)
            {
                if (_doc.IsOpen && _doc.IsDirty) DoSave();
                e.Use();
            }
        }

        // --- actions -------------------------------------------------------
        // Every action funnels exceptions into a dialog, per the PDD's
        // stated error philosophy: messages a human can act on, never a
        // raw stack trace in front of the user. Console still gets the
        // full exception via Debug.LogException for debugging.

        private void DoOpen()
        {
            if (!_doc.NativePluginLoaded)
            {
                EditorUtility.DisplayDialog(
                    "Cannot open",
                    "The native plugin isn't loaded, so Studio can't open a plan file.\n\n" +
                    "Use Wayforge > Check native plugin for details.",
                    "OK");
                return;
            }

            string path = EditorUtility.OpenFilePanel("Open plan", "", "wfb,svg");
            if (string.IsNullOrEmpty(path)) return; // user cancelled

            try
            {
                _doc.Open(path);
                _canvas.ClearSelection();
                Rect canvasRect = new Rect(0, ToolbarHeight, position.width - RoomTagger.SidebarWidth, position.height - ToolbarHeight - StatusBarHeight);
                _canvas.FitToContent(_doc, _doc.CurrentLevel, canvasRect);
                SetStatus($"Opened {System.IO.Path.GetFileName(path)}");
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
                EditorUtility.DisplayDialog("Couldn't open file",
                    $"Failed to open:\n{path}\n\n{ex.Message}", "OK");
            }
        }

        private void DoSave()
        {
            try
            {
                _doc.Save();
                SetStatus("Saved.");
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
                EditorUtility.DisplayDialog("Couldn't save", ex.Message, "OK");
            }
        }

        private void DoUndo()
        {
            _doc.Undo();
            _canvas.ClearSelection(); // selected id may no longer exist post-undo
        }

        private void DoRedo()
        {
            _doc.Redo();
            _canvas.ClearSelection();
        }

        private void DoBuildGraph()
        {
            try
            {
                _doc.BuildGraph();
                SetStatus("Graph built.");
            }
            catch (Exception ex)
            {
                Debug.LogException(ex);
                EditorUtility.DisplayDialog("Build graph failed", ex.Message, "OK");
            }
        }

        private void SetStatus(string message)
        {
            _statusMessage = message;
            _statusMessageExpiry = EditorApplication.timeSinceStartup + 3.0;
        }
    }
}
