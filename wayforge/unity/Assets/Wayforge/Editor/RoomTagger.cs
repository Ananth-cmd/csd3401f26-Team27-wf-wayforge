// Draws the right sidebar. Shows different things depending on what's
// selected in PlanCanvas:
//   - room selected -> code/name fields + kind dropdown
//   - wall selected -> property list (built from GetProperties so we
//     don't need to hardcode a field per property)
//   - nothing selected -> route preview

using System;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public class RoomTagger
    {
        public const float SidebarWidth = 292f;

        // input field state, not building data
        private string _roomCodeInput = "";
        private string _roomNameInput = "";
        private string _lastSelectedRoomId;

        private string _routeFromInput = "";
        private string _routeToInput = "";
        private bool _routeStepFreeOnly = false;
        private WfRouteResult? _lastRoute;

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
                DrawRoutePreview(doc, levelIndex);

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

            // Only refresh the fields when the selection changes, not every
            // frame - otherwise typing would get overwritten mid-keystroke.
            if (_lastSelectedRoomId != roomId)
            {
                _roomCodeInput = room.code ?? "";
                _roomNameInput = room.name ?? "";
                _lastSelectedRoomId = roomId;
            }

            EditorGUILayout.LabelField("Room", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);

            EditorGUILayout.LabelField($"id: {room.id}", EditorStyles.miniLabel);
            EditorGUILayout.LabelField($"area: {room.area:F1} m²", EditorStyles.miniLabel);
            EditorGUILayout.LabelField($"confidence: {room.confidence:P0}", EditorStyles.miniLabel);
            EditorGUILayout.Space(8);

            EditorGUI.BeginChangeCheck();
            _roomCodeInput = EditorGUILayout.DelayedTextField("Code", _roomCodeInput);
            _roomNameInput = EditorGUILayout.DelayedTextField("Name", _roomNameInput);
            if (EditorGUI.EndChangeCheck())
            {
                doc.SetRoomCode(levelIndex, room.id, _roomCodeInput, _roomNameInput);
            }

            EditorGUI.BeginChangeCheck();
            RoomKind newKind = (RoomKind)EditorGUILayout.EnumPopup("Kind", room.kind);
            if (EditorGUI.EndChangeCheck())
            {
                doc.SetRoomKind(levelIndex, room.id, newKind);
            }

            EditorGUILayout.Space(12);
            if (!room.IsTagged)
            {
                EditorGUILayout.HelpBox("Untagged -- give this room a code before building the graph, or it won't be routable.", MessageType.Warning);
            }
        }

        private void DrawWallInspector(IWayforgeDocument doc, int levelIndex, string wallId)
        {
            EditorGUILayout.LabelField("Wall", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);

            var rows = doc.GetProperties(levelIndex, ElementKind.Wall, wallId);
            if (rows.Count == 0)
            {
                EditorGUILayout.HelpBox("Selected wall no longer exists.", MessageType.Warning);
                return;
            }

            _wallPropsScroll = EditorGUILayout.BeginScrollView(_wallPropsScroll);
            foreach (var row in rows)
            {
                DrawPropertyField(doc, levelIndex, ElementKind.Wall, wallId, row);
            }
            EditorGUILayout.EndScrollView();
        }

        // Draws one property field, picking the right control based on
        // the property's type, then writes the new value back if changed.
        private void DrawPropertyField(IWayforgeDocument doc, int levelIndex, ElementKind kind, string elementId, WfPropertyRow row)
        {
            EditorGUI.BeginChangeCheck();
            string newValue = row.valueText;

            switch (row.type)
            {
                case PropertyType.Bool:
                    bool boolVal = row.valueText == "true" || row.valueText == "1";
                    bool newBool = EditorGUILayout.Toggle(row.name, boolVal);
                    newValue = newBool ? "true" : "false";
                    break;

                case PropertyType.Int:
                    int.TryParse(row.valueText, out int intVal);
                    int newInt = EditorGUILayout.DelayedIntField(row.name, intVal);
                    newValue = newInt.ToString();
                    break;

                case PropertyType.Float:
                    float.TryParse(row.valueText, out float floatVal);
                    float newFloat = EditorGUILayout.DelayedFloatField(row.name, floatVal);
                    newValue = newFloat.ToString("F4");
                    break;

                case PropertyType.Vec2:
                    Vector2 vecVal = ParseVec2(row.valueText);
                    Vector2 newVec = EditorGUILayout.Vector2Field(row.name, vecVal);
                    newValue = $"{newVec.x:F4},{newVec.y:F4}";
                    break;

                case PropertyType.Enum:
                    int currentIdx = Array.IndexOf(row.enumOptions ?? Array.Empty<string>(), row.valueText);
                    int newIdx = EditorGUILayout.Popup(row.name, Mathf.Max(0, currentIdx), row.enumOptions ?? Array.Empty<string>());
                    if (row.enumOptions != null && row.enumOptions.Length > 0)
                        newValue = row.enumOptions[newIdx];
                    break;

                case PropertyType.String:
                default:
                    newValue = EditorGUILayout.DelayedTextField(row.name, row.valueText);
                    break;
            }

            if (EditorGUI.EndChangeCheck() && newValue != row.valueText)
            {
                bool ok = doc.SetProperty(levelIndex, kind, elementId, row.name, newValue);
                if (!ok)
                {
                    Debug.LogWarning($"[RoomTagger] Failed to set {row.name} = '{newValue}' on {kind} '{elementId}' " +
                                      $"(rejected by the document -- likely a read-only field or invalid value for its type).");
                }
            }
        }

        private static Vector2 ParseVec2(string text)
        {
            if (string.IsNullOrEmpty(text)) return Vector2.zero;
            var parts = text.Split(',');
            if (parts.Length != 2) return Vector2.zero;
            float.TryParse(parts[0], out float x);
            float.TryParse(parts[1], out float y);
            return new Vector2(x, y);
        }

        private void DrawRoutePreview(IWayforgeDocument doc, int levelIndex)
        {
            EditorGUILayout.LabelField("Route preview", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);
            EditorGUILayout.HelpBox("Nothing selected. Click a room or wall to inspect it, or preview a route below.", MessageType.None);
            EditorGUILayout.Space(8);

            _routeFromInput = EditorGUILayout.DelayedTextField("From (code)", _routeFromInput);
            _routeToInput = EditorGUILayout.DelayedTextField("To (code)", _routeToInput);
            _routeStepFreeOnly = EditorGUILayout.Toggle("Step-free only", _routeStepFreeOnly);

            EditorGUILayout.Space(4);

            using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(_routeFromInput) || string.IsNullOrEmpty(_routeToInput)))
            {
                if (GUILayout.Button("Find route"))
                {
                    RunRoute(doc);
                }
            }

            if (_lastRoute.HasValue)
            {
                EditorGUILayout.Space(8);
                var r = _lastRoute.Value;
                if (r.success)
                {
                    EditorGUILayout.LabelField("Steps:", r.stepCount.ToString());
                    EditorGUILayout.LabelField("Cost:", $"{r.totalCost:F1} m");
                    EditorGUILayout.LabelField("Step-free:", r.stepFree ? "yes" : "no");
                }
                else
                {
                    EditorGUILayout.HelpBox(r.errorMessage ?? "Route failed.", MessageType.Error);
                }
            }
        }

        private void RunRoute(IWayforgeDocument doc)
        {
            string fromRef = doc.NodeForRoom(_routeFromInput);
            string toRef = doc.NodeForRoom(_routeToInput);

            if (fromRef == null)
            {
                _lastRoute = new WfRouteResult { success = false, errorMessage = $"'{_routeFromInput}' not found -- check the code, and that the graph has been built." };
                return;
            }
            if (toRef == null)
            {
                _lastRoute = new WfRouteResult { success = false, errorMessage = $"'{_routeToInput}' not found -- check the code, and that the graph has been built." };
                return;
            }

            _lastRoute = doc.Route(fromRef, toRef, _routeStepFreeOnly);
        }

        private static WfRoom FindRoom(IWayforgeDocument doc, int levelIndex, string roomId)
        {
            foreach (var r in doc.Rooms(levelIndex))
                if (r.id == roomId) return r;
            return default;
        }
    }
}