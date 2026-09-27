// The Studio window itself: toolbar, keyboard shortcuts, and layout
// (canvas on the left, sidebar on the right, status bar on the bottom).
// Actual drawing is delegated to PlanCanvas and RoomTagger.

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

        [MenuItem("Wayforge/Check native plugin")]
        public static void CheckNativePlugin()
        {
            // Ask the bridge directly: the document may be the fake stub,
            // which always claims to be loaded.
            if (NativeBridge.PluginLoads())
            {
                EditorUtility.DisplayDialog(
                    "Wayforge native plugin",
                    $"Plugin loaded OK.\nCore {NativeBridge.Version()} on {NativeBridge.Platform()}.",
                    "OK");
            }
            else
            {
                EditorUtility.DisplayDialog(
                    "Wayforge native plugin",
                    "The native plugin (wayforge.dll / .so / .dylib) did not load, so Studio is showing fake data.\n\n" +
                    "Run core\\script_build_and_run.bat (it copies wayforge.dll into " +
                    "Assets/Wayforge/Plugins/x86_64), then restart Unity.",
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

            // Note: script recompiles call OnEnable again with a fresh
            // document, so an open file will show as closed after Unity
            // recompiles. Not fixed yet - would need either remembering
            // the path and reopening, or the real document reattaching
            // instead of recreating itself.
        }

        private void OnDisable()
        {
            // Dispose the document here. The real version holds native
            // memory that needs to be released properly, not left to the GC.
            DocumentProvider.Reset();
        }

        // OnDisable runs on every script recompile too, not just a real
        // close, so the unsaved-changes check can't live there (it would
        // pop up constantly while coding). OnDestroy only runs when the
        // window is actually closed, so it goes here instead.
        private void OnDestroy()
        {
            if (_doc == null || !_doc.IsOpen || !_doc.IsDirty) return;

            bool discard = EditorUtility.DisplayDialog(
                "Unsaved changes",
                $"{_doc.BuildingName} has unsaved changes that will be lost if you close Studio now.",
                "Close without saving",
                "Cancel");

            if (!discard)
            {
                // Can't actually cancel the close from here, so just
                // reopen the window and let the user save from there.
                Debug.LogWarning("[StudioWindow] Closed with unsaved changes. Reopening so you can save.");
                EditorApplication.delayCall += Open;
            }
        }

        // Shared check before any action that would throw away unsaved
        // changes (currently just Open). Returns true if it's safe to continue.
        private bool ConfirmDiscardUnsavedChanges(string aboutToDoWhat)
        {
            if (!_doc.IsOpen || !_doc.IsDirty) return true;

            return EditorUtility.DisplayDialog(
                "Unsaved changes",
                $"{_doc.BuildingName} has unsaved changes. They'll be lost if you continue {aboutToDoWhat}.",
                "Discard changes",
                "Cancel");
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

            // keep repainting while the mouse is over the window so
            // pan/zoom feels smooth
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
            GUILayout.Box("", EditorStyles.toolbarButton, GUILayout.Width(1), GUILayout.Height(ToolbarHeight));
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

            _canvas.ShowGraph = GUILayout.Toggle(_canvas.ShowGraph, "Show routes", EditorStyles.toolbarButton, GUILayout.Width(90));
            _canvas.ShowConfidence = GUILayout.Toggle(_canvas.ShowConfidence, "Wall accuracy", EditorStyles.toolbarButton, GUILayout.Width(100));

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
            else if (DocumentProvider.UsingFakeData)
                GUILayout.Label("⚠ native plugin not loaded - showing fake data", EditorStyles.miniLabel);

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

        // Every action below catches exceptions and shows a dialog
        // instead of letting Unity print a raw stack trace.

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

            if (!ConfirmDiscardUnsavedChanges("opening another file")) return;

            string path = EditorUtility.OpenFilePanel("Open plan", DefaultPlanFolder(), "wfb,svg");
            if (string.IsNullOrEmpty(path)) return;

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
            _canvas.ClearSelection(); // selected item might not exist anymore
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

        // wayforge/data/plans next to the Unity project, if it exists.
        private static string DefaultPlanFolder()
        {
            string dir = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "../../data/plans"));
            return System.IO.Directory.Exists(dir) ? dir : "";
        }

        private void SetStatus(string message)
        {
            _statusMessage = message;
            _statusMessageExpiry = EditorApplication.timeSinceStartup + 3.0;
        }
    }
}