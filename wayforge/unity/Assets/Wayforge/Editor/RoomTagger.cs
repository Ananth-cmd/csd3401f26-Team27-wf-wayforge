// RoomTagger.cs
//
// Week 3 deliverable (Work Breakdown, IMGD 2 row).
//
// Draws the 292px right sidebar. Three modes depending on
// PlanCanvas.CurrentSelection:
//   - Room selected -> code/name fields + kind dropdown
//   - Wall selected  -> generic property list, built by looping
//                        doc.GetProperties() -- NO per-field UI code.
//                        This is the point of the property system
//                        (Work Breakdown 3.2): IMGD 2 writes ONE field
//                        renderer that works for every property type,
//                        so when IMGD 1/RTIS 1 add a new Wall field on
//                        the C++ side later, it shows up here for free.
//   - Nothing selected -> route preview (from/to room code, Find Route
//                        button, step count + cost display)
//
// Like PlanCanvas, this file holds no building data -- every field reads
// live from IWayforgeDocument and every edit calls straight back into it.

using System;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public class RoomTagger
    {
        public const float SidebarWidth = 292f;

        // Local UI-only state (never building data): text currently typed
        // into fields before commit, and the last route result to display.
        // This is exactly analogous to PlanCanvas's pan/zoom -- state about
        // "what's on screen right now," not state about the building.
        private string _roomCodeInput = "";
        private string _roomNameInput = "";
        private string _lastSelectedRoomId; // used to detect selection changes and refresh input fields

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

        // --- room inspector -----------------------------------------------

        private void DrawRoomInspector(IWayforgeDocument doc, int levelIndex, string roomId, PlanCanvas canvas)
        {
            WfRoom room = FindRoom(doc, levelIndex, roomId);
            if (room.id == null)
            {
                EditorGUILayout.HelpBox("Selected room no longer exists.", MessageType.Warning);
                canvas.ClearSelection();
                return;
            }

            // Refresh the input fields from the document only when the
            // selection just changed -- NOT every frame, or the user could
            // never type into these fields (every keystroke would get
            // overwritten by the doc's current value before the next
            // repaint). This mirrors why StudioWindow uses
            // DelayedTextField semantics elsewhere: local edit buffer,
            // committed explicitly.
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

        // --- wall inspector: THE property-system loop ----------------------
        // This method is short on purpose. It does not know about
        // "thickness" or "confidence" as concepts -- it asks the document
        // for a list of (name, type, value) rows and renders each row with
        // one shared field-drawing function. Adding a new Wall property on
        // the C++ side requires ZERO changes here.

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

        /// <summary>
        /// Renders ONE property row with the control appropriate to its
        /// declared type, and writes back via doc.SetProperty on change.
        /// This is the single generic renderer every element inspector
        /// (currently just Wall; later Opening/Room/Node as the property
        /// table grows) funnels through.
        /// </summary>
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

        // --- route preview ---------------------------------------------

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

        // --- helpers -------------------------------------------------------

        private static WfRoom FindRoom(IWayforgeDocument doc, int levelIndex, string roomId)
        {
            foreach (var r in doc.Rooms(levelIndex))
                if (r.id == roomId) return r;
            return default; // .id will be null -- callers check for that
        }
    }
}
