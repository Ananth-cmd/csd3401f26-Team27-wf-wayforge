// The drawing surface - handles world/screen conversion, drawing the
// plan, and click-to-select. Doesn't store any building data itself,
// just reads from the document every time it draws.
//
// Note: world space is Y-up, but Unity GUI space is Y-down. WorldToScreen
// and ScreenToWorld are the only two places that flip the Y axis. Don't
// add another Y-flip anywhere else, it'll cancel out and break things.

using System;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public enum SelectionKind { None, Wall, Room }

    [Serializable]
    public struct Selection
    {
        public SelectionKind kind;
        public string id;

        public static Selection None => new Selection { kind = SelectionKind.None, id = null };
        public bool IsWall => kind == SelectionKind.Wall;
        public bool IsRoom => kind == SelectionKind.Room;
        public bool IsNone => kind == SelectionKind.None;
    }

    public class PlanCanvas
    {
        // pan/zoom state - this is view-only, not part of the building
        private Vector2 _panWorld;
        private float _pixelsPerMeter = 40f;
        private const float MinPpm = 4f;
        private const float MaxPpm = 400f;

        private Rect _canvasRect;

        public Selection CurrentSelection { get; private set; } = Selection.None;
        public event Action<Selection> OnSelectionChanged;

        public bool ShowConfidence { get; set; } = true;

        private const float WallClickToleranceMeters = 0.25f;

        // wall colors by confidence: >=0.7 green, >=0.4 orange, else red
        private static readonly Color RoomFillColor = new Color(0.55f, 0.75f, 0.95f, 0.25f);
        private static readonly Color RoomFillSelected = new Color(0.95f, 0.80f, 0.30f, 0.35f);
        private static readonly Color RoomFillUntagged = new Color(0.85f, 0.35f, 0.35f, 0.18f);
        private static readonly Color WallSelectedColor = new Color(0.30f, 0.65f, 1.0f, 1f);
        private static readonly Color WallGreen = new Color(0.30f, 0.75f, 0.35f, 1f);
        private static readonly Color WallOrange = new Color(0.95f, 0.65f, 0.15f, 1f);
        private static readonly Color WallRed = new Color(0.85f, 0.25f, 0.25f, 1f);
        private static readonly Color WallFlatColor = new Color(0.15f, 0.15f, 0.18f, 1f);
        private static readonly Color DoorColor = new Color(0.9f, 0.9f, 0.2f, 1f);
        private static readonly Color BackgroundColor = new Color(0.20f, 0.20f, 0.22f, 1f);
        private static readonly Color GridColor = new Color(1f, 1f, 1f, 0.04f);

        public Vector2 WorldToScreen(Vector2 world)
        {
            Vector2 center = _canvasRect.center;
            float dx = (world.x - _panWorld.x) * _pixelsPerMeter;
            float dy = (world.y - _panWorld.y) * _pixelsPerMeter;
            return new Vector2(center.x + dx, center.y - dy);
        }

        public Vector2 ScreenToWorld(Vector2 screen)
        {
            Vector2 center = _canvasRect.center;
            float dx = (screen.x - center.x) / _pixelsPerMeter;
            float dy = (screen.y - center.y) / _pixelsPerMeter;
            return new Vector2(_panWorld.x + dx, _panWorld.y - dy);
        }

        // Centers the view on the level's content and picks a zoom level
        // that fits it. Called after opening a file.
        public void FitToContent(IWayforgeDocument doc, int levelIndex, Rect canvasRect)
        {
            var walls = doc.Walls(levelIndex);
            if (walls.Count == 0)
            {
                _panWorld = Vector2.zero;
                _pixelsPerMeter = 40f;
                return;
            }

            float minX = float.MaxValue, minY = float.MaxValue, maxX = float.MinValue, maxY = float.MinValue;
            foreach (var w in walls)
            {
                minX = Mathf.Min(minX, Mathf.Min(w.a.x, w.b.x));
                minY = Mathf.Min(minY, Mathf.Min(w.a.y, w.b.y));
                maxX = Mathf.Max(maxX, Mathf.Max(w.a.x, w.b.x));
                maxY = Mathf.Max(maxY, Mathf.Max(w.a.y, w.b.y));
            }

            _panWorld = new Vector2((minX + maxX) * 0.5f, (minY + maxY) * 0.5f);

            float contentW = Mathf.Max(0.01f, maxX - minX);
            float contentH = Mathf.Max(0.01f, maxY - minY);
            float pad = 0.9f; // leave a small margin
            float ppmX = canvasRect.width / contentW * pad;
            float ppmY = canvasRect.height / contentH * pad;
            _pixelsPerMeter = Mathf.Clamp(Mathf.Min(ppmX, ppmY), MinPpm, MaxPpm);
        }

        // Draw() only does anything on Repaint events - Unity calls OnGUI
        // (and this) for other event types too, and drawing calls outside
        // Repaint don't work right. Mouse/keyboard input is handled
        // separately in HandleInput below.
        public void Draw(IWayforgeDocument doc, int levelIndex, Rect canvasRect)
        {
            _canvasRect = canvasRect;

            if (Event.current.type != EventType.Repaint)
                return;

            EditorGUI.DrawRect(canvasRect, BackgroundColor);
            DrawGrid(canvasRect);

            if (!doc.IsOpen) return;

            // Inside BeginClip, (0,0) is the canvas's top-left corner, not the
            // window's. Swap in the local rect while drawing so WorldToScreen
            // gives clip-local positions; otherwise everything draws one
            // toolbar-height below where clicks are tested.
            GUI.BeginClip(canvasRect);
            _canvasRect = new Rect(0, 0, canvasRect.width, canvasRect.height);

            DrawRooms(doc, levelIndex);
            DrawWalls(doc, levelIndex);
            DrawOpenings(doc, levelIndex);

            _canvasRect = canvasRect;
            GUI.EndClip();
        }

        private void DrawGrid(Rect canvasRect)
        {
            // skip drawing the grid when zoomed out too far, would just
            // be a mess of lines
            if (_pixelsPerMeter < 8f) return;

            Handles.BeginGUI();
            Handles.color = GridColor;
            Vector2 worldTopLeft = ScreenToWorld(new Vector2(canvasRect.xMin, canvasRect.yMin));
            Vector2 worldBottomRight = ScreenToWorld(new Vector2(canvasRect.xMax, canvasRect.yMax));

            int xStart = Mathf.FloorToInt(worldTopLeft.x);
            int xEnd = Mathf.CeilToInt(worldBottomRight.x);
            int yStart = Mathf.FloorToInt(worldBottomRight.y);
            int yEnd = Mathf.CeilToInt(worldTopLeft.y);

            for (int x = xStart; x <= xEnd; x++)
            {
                Vector2 p1 = WorldToScreen(new Vector2(x, yStart));
                Vector2 p2 = WorldToScreen(new Vector2(x, yEnd));
                Handles.DrawLine(p1, p2);
            }
            for (int y = yStart; y <= yEnd; y++)
            {
                Vector2 p1 = WorldToScreen(new Vector2(xStart, y));
                Vector2 p2 = WorldToScreen(new Vector2(xEnd, y));
                Handles.DrawLine(p1, p2);
            }
            Handles.color = Color.white;
            Handles.EndGUI();
        }

        private void DrawRooms(IWayforgeDocument doc, int levelIndex)
        {
            foreach (var room in doc.Rooms(levelIndex))
            {
                if (room.polygon == null || room.polygon.Count < 3) continue;

                Vector3[] screenPoly = room.polygon
                    .Select(p => (Vector3)WorldToScreen(p))
                    .ToArray();

                Color fill = room.id == CurrentSelection.id && CurrentSelection.IsRoom
                    ? RoomFillSelected
                    : (room.IsTagged ? RoomFillColor : RoomFillUntagged);

                // Fill triangle by triangle: DrawAAConvexPolygon on its own
                // draws L-shaped (non-convex) rooms wrong.
                var tris = PolygonUtil.Triangulate(room.polygon);
                Handles.BeginGUI();
                Handles.color = fill;
                for (int t = 0; t + 2 < tris.Count; t += 3)
                    Handles.DrawAAConvexPolygon(screenPoly[tris[t]], screenPoly[tris[t + 1]], screenPoly[tris[t + 2]]);
                Handles.color = Color.white;
                Handles.EndGUI();

                DrawRoomLabel(room);
            }
        }

        private void DrawRoomLabel(WfRoom room)
        {
            Vector2 screenCentroid = WorldToScreen(room.centroid);
            string label = room.IsTagged
                ? (string.IsNullOrEmpty(room.name) ? room.code : $"{room.code}\n{room.name}")
                : (string.IsNullOrEmpty(room.name) ? "untagged" : room.name);
            var style = new GUIStyle(EditorStyles.miniLabel)
            {
                alignment = TextAnchor.MiddleCenter,
                normal = { textColor = room.IsTagged ? Color.white : new Color(1f, 0.75f, 0.75f) }
            };
            Vector2 size = style.CalcSize(new GUIContent(label));
            var rect = new Rect(screenCentroid.x - size.x / 2, screenCentroid.y - size.y / 2, size.x, size.y);
            GUI.Label(rect, label, style);
        }

        private void DrawWalls(IWayforgeDocument doc, int levelIndex)
        {
            Handles.BeginGUI();
            foreach (var wall in doc.Walls(levelIndex))
            {
                bool selected = CurrentSelection.IsWall && CurrentSelection.id == wall.id;
                Handles.color = selected ? WallSelectedColor
                    : (ShowConfidence ? ConfidenceColor(wall.confidence) : WallFlatColor);

                Vector2 p1 = WorldToScreen(wall.a);
                Vector2 p2 = WorldToScreen(wall.b);
                float thicknessPx = Mathf.Max(2f, wall.thickness * _pixelsPerMeter);
                Handles.DrawAAPolyLine(thicknessPx, p1, p2);
            }
            Handles.color = Color.white;
            Handles.EndGUI();
        }

        private void DrawOpenings(IWayforgeDocument doc, int levelIndex)
        {
            Handles.BeginGUI();
            Handles.color = DoorColor;
            var walls = doc.Walls(levelIndex);
            foreach (var opening in doc.Openings(levelIndex))
            {
                // The real core gives the position directly; the stub gives wall + offset.
                Vector2 worldPos = opening.pos;
                if (!string.IsNullOrEmpty(opening.wall))
                {
                    var wall = walls.FirstOrDefault(w => w.id == opening.wall);
                    if (wall.id == null) continue;
                    worldPos = wall.a + wall.Direction * opening.offset;
                }
                Vector2 screenPos = WorldToScreen(worldPos);
                float radius = Mathf.Max(3f, opening.width * 0.5f * _pixelsPerMeter);
                Handles.DrawSolidDisc(screenPos, Vector3.forward, radius);
            }
            Handles.color = Color.white;
            Handles.EndGUI();
        }

        private static Color ConfidenceColor(float confidence)
        {
            if (confidence >= 0.7f) return WallGreen;
            if (confidence >= 0.4f) return WallOrange;
            return WallRed;
        }

        // Mouse/keyboard input, handled separately from Draw so it can
        // run on every event type, not just Repaint.
        public void HandleInput(IWayforgeDocument doc, int levelIndex, Rect canvasRect)
        {
            _canvasRect = canvasRect;
            Event e = Event.current;
            if (!canvasRect.Contains(e.mousePosition)) return;

            switch (e.type)
            {
                case EventType.MouseDown when e.button == 0:
                    HandleClickSelect(doc, levelIndex, e.mousePosition);
                    e.Use();
                    break;

                case EventType.MouseDrag when e.button == 2: // middle mouse = pan
                    _panWorld -= new Vector2(e.delta.x, -e.delta.y) / _pixelsPerMeter;
                    e.Use();
                    GUI.changed = true;
                    break;

                case EventType.ScrollWheel:
                    float zoomFactor = e.delta.y < 0 ? 1.1f : (1f / 1.1f);
                    Vector2 worldUnderMouseBefore = ScreenToWorld(e.mousePosition);
                    _pixelsPerMeter = Mathf.Clamp(_pixelsPerMeter * zoomFactor, MinPpm, MaxPpm);
                    // keep the point under the cursor fixed while zooming
                    Vector2 worldUnderMouseAfter = ScreenToWorld(e.mousePosition);
                    _panWorld += worldUnderMouseBefore - worldUnderMouseAfter;
                    e.Use();
                    GUI.changed = true;
                    break;
            }
        }

        private void HandleClickSelect(IWayforgeDocument doc, int levelIndex, Vector2 screenPos)
        {
            Vector2 worldPos = ScreenToWorld(screenPos);

            // check walls first - they're thin, so if we checked rooms
            // first a wall click would usually just select the room behind it
            string nearestWall = null;
            float nearestDist = WallClickToleranceMeters;
            foreach (var wall in doc.Walls(levelIndex))
            {
                float d = DistancePointToSegment(worldPos, wall.a, wall.b);
                if (d < nearestDist)
                {
                    nearestDist = d;
                    nearestWall = wall.id;
                }
            }

            if (nearestWall != null)
            {
                SetSelection(new Selection { kind = SelectionKind.Wall, id = nearestWall });
                return;
            }

            foreach (var room in doc.Rooms(levelIndex))
            {
                if (room.polygon != null && PointInPolygon(worldPos, room.polygon))
                {
                    SetSelection(new Selection { kind = SelectionKind.Room, id = room.id });
                    return;
                }
            }

            SetSelection(Selection.None);
        }

        private void SetSelection(Selection s)
        {
            CurrentSelection = s;
            OnSelectionChanged?.Invoke(s);
            GUI.changed = true;
        }

        public void ClearSelection() => SetSelection(Selection.None);

        private static float DistancePointToSegment(Vector2 p, Vector2 a, Vector2 b)
        {
            Vector2 ab = b - a;
            float lenSq = ab.sqrMagnitude;
            if (lenSq < 1e-8f) return Vector2.Distance(p, a);
            float t = Mathf.Clamp01(Vector2.Dot(p - a, ab) / lenSq);
            Vector2 closest = a + ab * t;
            return Vector2.Distance(p, closest);
        }

        private static bool PointInPolygon(Vector2 p, List<Vector2> poly)
        {
            // even-odd ray casting
            bool inside = false;
            int j = poly.Count - 1;
            for (int i = 0; i < poly.Count; i++)
            {
                Vector2 pi = poly[i], pj = poly[j];
                if ((pi.y > p.y) != (pj.y > p.y) &&
                    p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y) + pi.x)
                {
                    inside = !inside;
                }
                j = i;
            }
            return inside;
        }
    }
}