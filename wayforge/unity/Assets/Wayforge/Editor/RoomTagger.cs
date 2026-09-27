// Draws the right sidebar. Studio shows the blueprint; the only edit it
// allows is renaming rooms. Shows different things depending on what's
// selected in PlanCanvas:
//   - room selected -> info + rename (code, name)
//   - wall selected -> property list (built from GetProperties so we
//     don't need to hardcode a field per property)
//   - nothing selected -> short help text

using System;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public class RoomTagger
    {
        public const float SidebarWidth = 292f;

        // text-box state, not building data
        private string _roomCodeInput = "";
        private string _roomNameInput = "";
        private string _lastSelectedRoomId, _lastRoomCode, _lastRoomName;


        private Vector2 _wallPropsScroll;

        public void Draw(IWayforgeDocument doc, int levelIndex, PlanCanvas canvas, Rect sidebarRect)
        {
            GUILayout.BeginArea(sidebarRect);
            EditorGUILayout.BeginVertical();

            if (!doc.IsOpen)
            {
                EditorGUILayout.HelpBox("No document open.", MessageType.Info);
                EditorGUILayout.EndVertical();
                GUILayout.EndArea();
                return;
            }

            var sel = canvas.CurrentSelection;

            if (sel.IsRoom)
                DrawRoomInspector(doc, levelIndex, sel.id, canvas);
            else if (sel.IsWall)
                DrawWallInspector(doc, levelIndex, sel.id);
            else
                EditorGUILayout.HelpBox("Click a room to see it and rename it, or a wall to see its details.\n" +
                                        "Scroll to zoom, middle-mouse drag to pan.", MessageType.Info);

            EditorGUILayout.EndVertical();
            GUILayout.EndArea();
        }

        private void DrawRoomInspector(IWayforgeDocument doc, int levelIndex, string roomId, PlanCanvas canvas)
        {
            WfRoom room = FindRoom(doc, levelIndex, roomId);
            if (room.id == null)
            {
                EditorGUILayout.HelpBox("Selected room no longer exists.", MessageType.Warning);
                canvas.ClearSelection();
                return;
            }

            // Only refresh the text boxes when the selection changes (or after
            // undo/redo changes the room), not every frame - otherwise typing
            // would get overwritten mid-keystroke.
            if (_lastSelectedRoomId != roomId || _lastRoomCode != room.code || _lastRoomName != room.name)
            {
                _roomCodeInput = room.code ?? "";
                _roomNameInput = room.name ?? "";
                _lastSelectedRoomId = roomId;
                _lastRoomCode = room.code;
                _lastRoomName = room.name;
            }

            EditorGUILayout.LabelField("Room", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);

            InfoRow("Id", room.id);
            InfoRow("Kind", room.kind.ToString());
            InfoRow("Area", $"{room.area:F1} m\u00b2");
            InfoRow("Confidence", $"{room.confidence:P0}");
            EditorGUILayout.Space(8);

            // Renaming is the one edit Studio allows: a room code (e.g. E2-05-12)
            // and a display name. Goes through the core's undo stack, so Ctrl+Z works.
            EditorGUILayout.LabelField("Rename", EditorStyles.boldLabel);
            _roomCodeInput = EditorGUILayout.TextField("Code", _roomCodeInput);
            _roomNameInput = EditorGUILayout.TextField("Name", _roomNameInput);

            bool changed = _roomCodeInput != (room.code ?? "") || _roomNameInput != (room.name ?? "");
            using (new EditorGUI.DisabledScope(!changed))
            {
                if (GUILayout.Button("Apply name"))
                {
                    doc.SetRoomCode(levelIndex, room.id, _roomCodeInput.Trim(), _roomNameInput.Trim());
                    GUI.FocusControl(null);
                }
            }

            if (!room.IsTagged)
                EditorGUILayout.HelpBox("No code yet - give the room a code (e.g. A1) so it shows on the plan and in 3D.", MessageType.Info);
        }

        private void DrawWallInspector(IWayforgeDocument doc, int levelIndex, string wallId)
        {
            EditorGUILayout.LabelField("Wall", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);

            // The rows come from the core's property table (wf_property_name /
            // wf_get_property), so new wall fields show up here automatically.
            var rows = doc.GetProperties(levelIndex, ElementKind.Wall, wallId);
            if (rows.Count == 0)
            {
                EditorGUILayout.HelpBox("Selected wall no longer exists.", MessageType.Warning);
                return;
            }

            _wallPropsScroll = EditorGUILayout.BeginScrollView(_wallPropsScroll);
            foreach (var row in rows)
                InfoRow(row.name, row.valueText);
            EditorGUILayout.EndScrollView();
        }

        // Read-only label/value pair. Studio only shows the blueprint for M1;
        // selectable so values can still be copied.
        private static void InfoRow(string label, string value)
        {
            EditorGUILayout.BeginHorizontal();
            EditorGUILayout.LabelField(label, GUILayout.Width(90));
            EditorGUILayout.SelectableLabel(value ?? "", EditorStyles.label, GUILayout.Height(EditorGUIUtility.singleLineHeight));
            EditorGUILayout.EndHorizontal();
        }

        private static WfRoom FindRoom(IWayforgeDocument doc, int levelIndex, string roomId)
        {
            foreach (var r in doc.Rooms(levelIndex))
                if (r.id == roomId) return r;
            return default;
        }
    }
}