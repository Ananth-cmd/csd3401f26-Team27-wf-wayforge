// Draws the right sidebar. Read-only for M1 (Studio shows the blueprint,
// it doesn't edit it). Shows different things depending on what's
// selected in PlanCanvas:
//   - room selected -> code, name, kind, area, confidence
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

        // route preview input state, not building data
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

            EditorGUILayout.LabelField("Room", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);

            InfoRow("Id", room.id);
            InfoRow("Code", room.IsTagged ? room.code : "(untagged)");
            InfoRow("Name", string.IsNullOrEmpty(room.name) ? "-" : room.name);
            InfoRow("Kind", room.kind.ToString());
            InfoRow("Area", $"{room.area:F1} m\u00b2");
            InfoRow("Corners", room.polygon?.Count.ToString() ?? "0");
            InfoRow("Confidence", $"{room.confidence:P0}");
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