using System.IO;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    // The Wayforge Studio window (Wayforge > Studio).
    // Import a floor plan image or open a .wfb file, see the plan in 2D, then make it 3D.
    public class StudioWindow : EditorWindow
    {
        const float ToolbarHeight = 22f;
        const float SidebarWidth = 240f;

        WayforgeDocument doc;          // the plan being shown
        RoomData selected;             // the room clicked on
        Texture2D image;               // the imported picture
        float imageWidthMetres = 20f;  // real width of the picture

        float pixelsPerMetre = 30f;    // zoom
        Vector2 offset;                // pan

        bool dragging;                 // true while drawing a room with the mouse
        Vector2 dragStart, dragEnd;    // drag corners, in metres
        string status = "";

        [MenuItem("Wayforge/Studio")]
        public static void Open() => GetWindow<StudioWindow>("Wayforge Studio");

        void OnDisable()
        {
            if (image != null) DestroyImmediate(image);
        }

        void OnGUI()
        {
            DrawToolbar();

            if (doc == null)
            {
                EditorGUILayout.HelpBox("Import image: pick a floor plan picture.\n" +
                                        "Open .wfb: load a saved plan (try Assets/Wayforge/Samples/square.wfb).",
                                        MessageType.Info);
                return;
            }

            // Plan on the left, sidebar on the right
            var canvas = new Rect(0, ToolbarHeight, position.width - SidebarWidth, position.height - ToolbarHeight);
            HandleMouse(canvas);
            DrawPlan(canvas);
            DrawSidebar(new Rect(canvas.xMax, ToolbarHeight, SidebarWidth, canvas.height));
        }

        // ---------- Toolbar ----------

        void DrawToolbar()
        {
            GUILayout.BeginHorizontal(EditorStyles.toolbar);

            if (GUILayout.Button("Import image", EditorStyles.toolbarButton, GUILayout.Width(90)))
                ImportImage();

            // Opening a .wfb needs the C++ dll
            using (new EditorGUI.DisabledScope(!NativeBridge.PluginLoads()))
            {
                if (GUILayout.Button("Open .wfb", EditorStyles.toolbarButton, GUILayout.Width(70)))
                    OpenFile();
            }

            using (new EditorGUI.DisabledScope(doc == null))
            {
                if (GUILayout.Button("Make 3D", EditorStyles.toolbarButton, GUILayout.Width(70)))
                    status = BlockMaker.Build(doc) + " block(s) made, see the Scene view";

                if (GUILayout.Button("Clear rooms", EditorStyles.toolbarButton, GUILayout.Width(80)))
                {
                    doc.Walls.Clear();
                    doc.Rooms.Clear();
                    selected = null;
                }
            }

            GUILayout.FlexibleSpace();
            GUILayout.Label(status, EditorStyles.miniLabel);
            GUILayout.EndHorizontal();
        }

        // Loads a picture, shows it, and finds the room in it
        void ImportImage()
        {
            string path = EditorUtility.OpenFilePanel("Import floor plan image", "", "png,jpg,jpeg");
            if (string.IsNullOrEmpty(path)) return;

            var tex = new Texture2D(2, 2);
            if (!tex.LoadImage(File.ReadAllBytes(path)))
            {
                DestroyImmediate(tex);
                EditorUtility.DisplayDialog("Wayforge", "That file is not a png or jpg.", "OK");
                return;
            }

            if (image != null) DestroyImmediate(image);
            image = tex;
            doc = new WayforgeDocument();
            FitTo(Vector2.zero, new Vector2(imageWidthMetres, ImageHeightMetres));
            DetectRoom();

            status = Path.GetFileName(path) + (doc.Rooms.Count > 0
                ? $": found room {doc.Rooms[0].code} ({doc.Rooms[0].Area:F1} m²)"
                : ": no room found, drag on the picture to draw one");
        }

        // Loads a .wfb file through the C++ core
        void OpenFile()
        {
            string path = EditorUtility.OpenFilePanel("Open building", Application.dataPath + "/Wayforge/Samples", "wfb");
            if (string.IsNullOrEmpty(path)) return;

            try
            {
                doc = WayforgeDocument.Load(path);
                if (image != null) { DestroyImmediate(image); image = null; }
                selected = null;
                FitToWalls();
                status = $"{Path.GetFileName(path)}: {doc.Walls.Count} walls, {doc.Rooms.Count} rooms";
            }
            catch (System.Exception e)
            {
                EditorUtility.DisplayDialog("Wayforge", e.Message, "OK");
            }
        }

        // ---------- Finding the room in the image ----------

        // Puts a room where the dark lines of the picture are
        void DetectRoom()
        {
            doc.Walls.Clear();
            doc.Rooms.Clear();
            selected = null;

            if (!FindDarkBox(image, out RectInt box)) return;

            float metresPerPixel = imageWidthMetres / image.width;
            selected = doc.AddRectangle(new Vector2(box.xMin, box.yMin) * metresPerPixel,
                                        new Vector2(box.xMax, box.yMax) * metresPerPixel);
        }

        // Finds the smallest box around all the dark pixels (the walls)
        static bool FindDarkBox(Texture2D tex, out RectInt box)
        {
            Color32[] pixels = tex.GetPixels32();
            int minX = tex.width, minY = tex.height, maxX = -1, maxY = -1;

            for (int y = 0; y < tex.height; y++)
            {
                for (int x = 0; x < tex.width; x++)
                {
                    Color32 c = pixels[y * tex.width + x];
                    bool dark = c.r + c.g + c.b < 300;
                    if (!dark) continue;

                    minX = Mathf.Min(minX, x);
                    maxX = Mathf.Max(maxX, x);
                    minY = Mathf.Min(minY, y);
                    maxY = Mathf.Max(maxY, y);
                }
            }

            box = new RectInt(minX, minY, maxX - minX + 1, maxY - minY + 1);
            return maxX > minX && maxY > minY;
        }

        float ImageHeightMetres => image == null ? 0 : imageWidthMetres * image.height / image.width;

        // ---------- Drawing the plan ----------

        // Metres to pixels. The plan's y goes up but the screen's y goes down, so it's flipped here.
        Vector2 ToScreen(Vector2 m, Rect canvas) =>
            new Vector2(canvas.x + offset.x + m.x * pixelsPerMetre, canvas.yMax - offset.y - m.y * pixelsPerMetre);

        // Pixels back to metres
        Vector2 ToMetres(Vector2 s, Rect canvas) =>
            new Vector2((s.x - canvas.x - offset.x) / pixelsPerMetre, (canvas.yMax - offset.y - s.y) / pixelsPerMetre);

        // Zooms and pans so the area from min to max fills the window
        void FitTo(Vector2 min, Vector2 max)
        {
            Vector2 size = Vector2.Max(max - min, Vector2.one);
            float w = position.width - SidebarWidth - 60;
            float h = position.height - ToolbarHeight - 60;
            pixelsPerMetre = Mathf.Min(w / size.x, h / size.y);
            offset = new Vector2(30 - min.x * pixelsPerMetre, 30 - min.y * pixelsPerMetre);
        }

        void FitToWalls()
        {
            if (doc.Walls.Count == 0) return;
            Vector2 min = doc.Walls[0].a, max = min;
            foreach (var w in doc.Walls)
            {
                min = Vector2.Min(min, Vector2.Min(w.a, w.b));
                max = Vector2.Max(max, Vector2.Max(w.a, w.b));
            }
            FitTo(min, max);
        }

        void DrawPlan(Rect canvas)
        {
            if (Event.current.type != EventType.Repaint) return;

            // Keep the drawing inside the plan area
            GUI.BeginClip(canvas);
            var area = new Rect(0, 0, canvas.width, canvas.height);
            EditorGUI.DrawRect(area, new Color(0.18f, 0.18f, 0.2f));

            // The picture
            if (image != null)
            {
                Vector2 topLeft = ToScreen(new Vector2(0, ImageHeightMetres), area);
                GUI.DrawTexture(new Rect(topLeft.x, topLeft.y, imageWidthMetres * pixelsPerMetre, ImageHeightMetres * pixelsPerMetre), image);
            }

            Handles.BeginGUI();

            // Rooms (the selected one in yellow)
            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length < 3) continue;
                var points = new Vector3[room.corners.Length];
                for (int i = 0; i < points.Length; i++) points[i] = ToScreen(room.corners[i], area);
                Handles.color = room == selected ? new Color(1f, 0.8f, 0.3f, 0.6f) : new Color(0.4f, 0.65f, 0.95f, 0.45f);
                Handles.DrawAAConvexPolygon(points);
            }

            // Walls
            Handles.color = new Color(0.1f, 0.5f, 1f);
            foreach (var w in doc.Walls)
                Handles.DrawAAPolyLine(3f, ToScreen(w.a, area), ToScreen(w.b, area));

            // The room being drawn with the mouse
            if (dragging)
            {
                Vector2 a = ToScreen(dragStart, area), b = ToScreen(dragEnd, area);
                Handles.color = Color.yellow;
                Handles.DrawAAPolyLine(2f, a, new Vector2(b.x, a.y), b, new Vector2(a.x, b.y), a);
            }

            Handles.EndGUI();

            // Room names in the middle of each room
            var labelStyle = new GUIStyle(EditorStyles.boldLabel) { alignment = TextAnchor.MiddleCenter, normal = { textColor = Color.white } };
            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length == 0) continue;
                Vector2 centre = Vector2.zero;
                foreach (var c in room.corners) centre += c;
                Vector2 s = ToScreen(centre / room.corners.Length, area);
                GUI.Label(new Rect(s.x - 40, s.y - 8, 80, 16), string.IsNullOrEmpty(room.code) ? room.id : room.code, labelStyle);
            }

            GUI.EndClip();
        }

        // ---------- Mouse ----------
        // Scroll = zoom, right-drag = pan, left-drag = draw a room, left-click = select a room

        void HandleMouse(Rect canvas)
        {
            Event e = Event.current;
            bool overPlan = canvas.Contains(e.mousePosition);

            if (e.type == EventType.ScrollWheel && overPlan)
            {
                pixelsPerMetre = Mathf.Clamp(pixelsPerMetre * (e.delta.y < 0 ? 1.1f : 0.9f), 2f, 500f);
                e.Use();
                Repaint();
            }
            else if (e.type == EventType.MouseDrag && e.button != 0 && overPlan)
            {
                offset += new Vector2(e.delta.x, -e.delta.y);
                e.Use();
                Repaint();
            }
            else if (e.type == EventType.MouseDown && e.button == 0 && overPlan)
            {
                dragging = true;
                dragStart = dragEnd = ToMetres(e.mousePosition, canvas);
                e.Use();
            }
            else if (e.type == EventType.MouseDrag && e.button == 0 && dragging)
            {
                dragEnd = ToMetres(e.mousePosition, canvas);
                e.Use();
                Repaint();
            }
            else if (e.type == EventType.MouseUp && e.button == 0 && dragging)
            {
                dragging = false;
                dragEnd = ToMetres(e.mousePosition, canvas);
                Vector2 size = dragEnd - dragStart;

                if (Mathf.Abs(size.x) > 0.3f && Mathf.Abs(size.y) > 0.3f)
                {
                    // A drag: add a new room
                    selected = doc.AddRectangle(dragStart, dragEnd);
                    status = $"{selected.code} added ({selected.Area:F1} m²)";
                }
                else
                {
                    // A click: select the room under the mouse
                    selected = null;
                    foreach (var room in doc.Rooms)
                        if (IsInside(dragStart, room.corners)) { selected = room; break; }
                }
                e.Use();
                Repaint();
            }
        }

        // True if point p is inside the outline
        static bool IsInside(Vector2 p, Vector2[] outline)
        {
            bool inside = false;
            for (int i = 0, j = outline.Length - 1; i < outline.Length; j = i++)
            {
                Vector2 a = outline[i], b = outline[j];
                if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x)
                    inside = !inside;
            }
            return inside;
        }

        // ---------- Sidebar ----------

        void DrawSidebar(Rect area)
        {
            GUILayout.BeginArea(new Rect(area.x + 8, area.y + 8, area.width - 16, area.height - 16));

            // Image scale
            if (image != null)
            {
                GUILayout.Label("Image", EditorStyles.boldLabel);
                EditorGUI.BeginChangeCheck();
                imageWidthMetres = Mathf.Max(1f, EditorGUILayout.FloatField("Real width (m)", imageWidthMetres));
                if (EditorGUI.EndChangeCheck())
                {
                    FitTo(Vector2.zero, new Vector2(imageWidthMetres, ImageHeightMetres));
                    DetectRoom();
                }
                if (GUILayout.Button("Find room again")) DetectRoom();
                EditorGUILayout.Space();
            }

            // Selected room
            GUILayout.Label("Room", EditorStyles.boldLabel);
            if (selected == null)
            {
                EditorGUILayout.HelpBox("Click a room to select it, or drag to draw one.\nScroll to zoom, right-drag to pan.", MessageType.None);
            }
            else
            {
                EditorGUILayout.LabelField("Id", selected.id);
                EditorGUILayout.LabelField("Code", string.IsNullOrEmpty(selected.code) ? "-" : selected.code);
                EditorGUILayout.LabelField("Corners", selected.corners.Length.ToString());
                EditorGUILayout.LabelField("Area", selected.Area.ToString("F1") + " m²");
            }

            GUILayout.FlexibleSpace();
            GUILayout.Label(NativeBridge.PluginLoads() ? "core " + NativeBridge.Version() : "wayforge.dll not loaded", EditorStyles.miniLabel);
            GUILayout.EndArea();
        }
    }
}
