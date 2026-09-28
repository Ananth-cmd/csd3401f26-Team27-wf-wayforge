// StudioWindow.cs - Wayforge Studio, the M1 prototype (IMGD 2).
// Menu: Wayforge > Studio.
//   Import image -> the picture appears and its room is found -> Make 3D
//   Open .wfb    -> a plan saved by the C++ core (through NativeBridge) appears -> Make 3D
// M1 placeholder: the room on an image is found with a simple "box around the dark lines" check
// (FindDarkBox below), and can be redrawn by dragging. The real detection is T04 (image parser).
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public class StudioWindow : EditorWindow
    {
        const float ToolbarHeight = 22f;
        const float SidebarWidth = 240f;

        WayforgeDocument doc;
        RoomData selected;
        Texture2D image;              // imported floor plan picture, shown under the plan
        float imageWidthMetres = 20f; // how wide the picture is in real life
        float pixelsPerMetre = 30f;   // zoom
        Vector2 offset;               // pan, in pixels
        bool dragging;                // drawing a square right now
        Vector2 dragStart, dragEnd;   // in metres
        string status = "";

        [MenuItem("Wayforge/Studio")]
        public static void Open() => GetWindow<StudioWindow>("Wayforge Studio");

        void OnDisable() { if (image != null) DestroyImmediate(image); }

        void OnGUI()
        {
            DrawToolbar();
            if (doc == null)
            {
                EditorGUILayout.HelpBox("Import image: pick a floor plan picture, then drag over it to draw a room.\n" +
                                        "Open: load a .wfb saved by the C++ core (try Assets/Wayforge/Samples/square.wfb).",
                                        MessageType.Info);
                return;
            }

            var canvas = new Rect(0, ToolbarHeight, position.width - SidebarWidth, position.height - ToolbarHeight);
            HandleMouse(canvas);
            DrawPlan(canvas);
            DrawSidebar(new Rect(canvas.xMax, ToolbarHeight, SidebarWidth, canvas.height));
        }

        // ---- toolbar ------------------------------------------------------------------------

        void DrawToolbar()
        {
            GUILayout.BeginHorizontal(EditorStyles.toolbar);
            if (GUILayout.Button("Import image", EditorStyles.toolbarButton, GUILayout.Width(90))) ImportImage();
            using (new EditorGUI.DisabledScope(!NativeBridge.PluginLoads()))
            {
                if (GUILayout.Button("Open .wfb", EditorStyles.toolbarButton, GUILayout.Width(70))) OpenFile();
            }
            using (new EditorGUI.DisabledScope(doc == null))
            {
                if (GUILayout.Button("Make 3D", EditorStyles.toolbarButton, GUILayout.Width(70)))
                    status = BlockMaker.Build(doc) + " block(s) made - see the Scene view";
                if (GUILayout.Button("Clear rooms", EditorStyles.toolbarButton, GUILayout.Width(80)))
                {
                    doc.Walls.Clear(); doc.Rooms.Clear(); selected = null;
                }
            }
            GUILayout.FlexibleSpace();
            GUILayout.Label(status, EditorStyles.miniLabel);
            GUILayout.EndHorizontal();
        }

        void ImportImage()
        {
            string path = EditorUtility.OpenFilePanel("Import floor plan image", "", "png,jpg,jpeg");
            if (string.IsNullOrEmpty(path)) return;

            var tex = new Texture2D(2, 2);
            if (!tex.LoadImage(System.IO.File.ReadAllBytes(path)))
            {
                DestroyImmediate(tex);
                EditorUtility.DisplayDialog("Wayforge", "That file is not a readable png or jpg.", "OK");
                return;
            }
            if (image != null) DestroyImmediate(image);
            image = tex;
            doc = new WayforgeDocument();       // start an empty plan on top of the picture
            selected = null;
            FitTo(Vector2.zero, new Vector2(imageWidthMetres, ImageHeightMetres));
            DetectRoom();
            status = System.IO.Path.GetFileName(path) + (doc.Rooms.Count > 0
                ? $" - found room {doc.Rooms[0].code} ({doc.Rooms[0].Area:F1} m\u00b2)"
                : " - no outline found, drag on the picture to draw the room");
        }

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
                status = $"{System.IO.Path.GetFileName(path)}: {doc.Walls.Count} walls, {doc.Rooms.Count} rooms";
            }
            catch (System.Exception e)
            {
                EditorUtility.DisplayDialog("Wayforge", e.Message, "OK");
            }
        }

        // Finds the room on the imported picture and adds it to the plan.
        void DetectRoom()
        {
            doc.Walls.Clear(); doc.Rooms.Clear();
            if (!FindDarkBox(image, out RectInt box)) { selected = null; return; }
            float metresPerPixel = imageWidthMetres / image.width;
            // texture pixels start bottom-left, like our plan, so no flip is needed
            selected = doc.AddRectangle(new Vector2(box.xMin, box.yMin) * metresPerPixel,
                                        new Vector2(box.xMax, box.yMax) * metresPerPixel);
        }

        // M1 placeholder for T04: the smallest box that contains every dark pixel.
        // For a picture of one square room, that box is the room.
        static bool FindDarkBox(Texture2D tex, out RectInt box)
        {
            Color32[] px = tex.GetPixels32();
            int minX = tex.width, minY = tex.height, maxX = -1, maxY = -1;
            for (int y = 0; y < tex.height; y++)
                for (int x = 0; x < tex.width; x++)
                {
                    Color32 c = px[y * tex.width + x];
                    if (c.r + c.g + c.b < 3 * 100)          // dark enough to be a wall line
                    {
                        if (x < minX) minX = x; if (x > maxX) maxX = x;
                        if (y < minY) minY = y; if (y > maxY) maxY = y;
                    }
                }
            box = new RectInt(minX, minY, maxX - minX + 1, maxY - minY + 1);
            return maxX > minX && maxY > minY;
        }

        float ImageHeightMetres => image == null ? 0 : imageWidthMetres * image.height / image.width;

        // ---- 2D view ------------------------------------------------------------------------

        // metres -> pixels inside the canvas. World y points up, screen y points down, so y is flipped here only.
        Vector2 ToScreen(Vector2 m, Rect canvas) =>
            new Vector2(canvas.x + offset.x + m.x * pixelsPerMetre, canvas.yMax - offset.y - m.y * pixelsPerMetre);

        Vector2 ToMetres(Vector2 s, Rect canvas) =>
            new Vector2((s.x - canvas.x - offset.x) / pixelsPerMetre, (canvas.yMax - offset.y - s.y) / pixelsPerMetre);

        void FitTo(Vector2 min, Vector2 max)
        {
            Vector2 size = Vector2.Max(max - min, Vector2.one);
            float w = position.width - SidebarWidth - 60, h = position.height - ToolbarHeight - 60;
            pixelsPerMetre = Mathf.Min(w / size.x, h / size.y);
            offset = new Vector2(30 - min.x * pixelsPerMetre, 30 - min.y * pixelsPerMetre);
        }

        void FitToWalls()
        {
            if (doc.Walls.Count == 0) return;
            Vector2 min = doc.Walls[0].a, max = min;
            foreach (var w in doc.Walls) { min = Vector2.Min(min, Vector2.Min(w.a, w.b)); max = Vector2.Max(max, Vector2.Max(w.a, w.b)); }
            FitTo(min, max);
        }

        void DrawPlan(Rect canvas)
        {
            if (Event.current.type != EventType.Repaint) return;

            // Draw inside a clip so nothing spills over the toolbar or sidebar.
            // Inside the clip, (0,0) is the canvas corner, so use a local rect for positions.
            GUI.BeginClip(canvas);
            var local = new Rect(0, 0, canvas.width, canvas.height);
            EditorGUI.DrawRect(local, new Color(0.18f, 0.18f, 0.2f));

            if (image != null)
            {
                Vector2 topLeft = ToScreen(new Vector2(0, ImageHeightMetres), local);
                GUI.DrawTexture(new Rect(topLeft.x, topLeft.y, imageWidthMetres * pixelsPerMetre, ImageHeightMetres * pixelsPerMetre), image);
            }

            Handles.BeginGUI();
            foreach (var room in doc.Rooms)
            {
                var pts = new Vector3[room.corners.Length];
                for (int i = 0; i < pts.Length; i++) pts[i] = ToScreen(room.corners[i], local);
                Handles.color = room == selected ? new Color(1f, 0.8f, 0.3f, 0.6f) : new Color(0.4f, 0.65f, 0.95f, 0.45f);
                if (pts.Length >= 3) Handles.DrawAAConvexPolygon(pts);   // fine for square / rectangular rooms
            }
            Handles.color = new Color(0.1f, 0.5f, 1f);
            foreach (var w in doc.Walls)
                Handles.DrawAAPolyLine(3f, ToScreen(w.a, local), ToScreen(w.b, local));

            if (dragging)   // the square being drawn right now
            {
                Vector2 a = ToScreen(dragStart, local), b = ToScreen(dragEnd, local);
                Handles.color = Color.yellow;
                Handles.DrawAAPolyLine(2f, a, new Vector2(b.x, a.y), b, new Vector2(a.x, b.y), a);
            }
            Handles.EndGUI();

            var label = new GUIStyle(EditorStyles.boldLabel) { alignment = TextAnchor.MiddleCenter, normal = { textColor = Color.white } };
            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length == 0) continue;
                Vector2 centre = Vector2.zero;
                foreach (var c in room.corners) centre += c;
                Vector2 s = ToScreen(centre / room.corners.Length, local);
                GUI.Label(new Rect(s.x - 40, s.y - 8, 80, 16), string.IsNullOrEmpty(room.code) ? room.id : room.code, label);
            }
            GUI.EndClip();
        }

        // scroll = zoom, right/middle-drag = pan, left-drag = draw a room, left-click = select a room
        void HandleMouse(Rect canvas)
        {
            Event e = Event.current;
            bool overCanvas = canvas.Contains(e.mousePosition);

            if (e.type == EventType.ScrollWheel && overCanvas)
            {
                pixelsPerMetre = Mathf.Clamp(pixelsPerMetre * (e.delta.y < 0 ? 1.1f : 0.9f), 2f, 500f);
                e.Use(); Repaint();
            }
            else if (e.type == EventType.MouseDrag && e.button != 0 && overCanvas)
            {
                offset += new Vector2(e.delta.x, -e.delta.y);
                e.Use(); Repaint();
            }
            else if (e.type == EventType.MouseDown && e.button == 0 && overCanvas)
            {
                dragging = true;
                dragStart = dragEnd = ToMetres(e.mousePosition, canvas);
                e.Use();
            }
            else if (e.type == EventType.MouseDrag && e.button == 0 && dragging)
            {
                dragEnd = ToMetres(e.mousePosition, canvas);
                e.Use(); Repaint();
            }
            else if (e.type == EventType.MouseUp && e.button == 0 && dragging)
            {
                dragging = false;
                dragEnd = ToMetres(e.mousePosition, canvas);
                Vector2 size = dragEnd - dragStart;
                if (Mathf.Abs(size.x) > 0.3f && Mathf.Abs(size.y) > 0.3f)
                {
                    selected = doc.AddRectangle(dragStart, dragEnd);        // a real drag: new room
                    status = $"{selected.code} added ({selected.Area:F1} m²)";
                }
                else
                {
                    selected = null;                                        // a click: select the room under it
                    foreach (var room in doc.Rooms)
                        if (Inside(dragStart, room.corners)) { selected = room; break; }
                }
                e.Use(); Repaint();
            }
        }

        // Is point p inside the outline? (count how many edges a ray to the right crosses)
        static bool Inside(Vector2 p, Vector2[] poly)
        {
            bool inside = false;
            for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
                if ((poly[i].y > p.y) != (poly[j].y > p.y) &&
                    p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)
                    inside = !inside;
            return inside;
        }

        // ---- sidebar ------------------------------------------------------------------------

        void DrawSidebar(Rect area)
        {
            GUILayout.BeginArea(new Rect(area.x + 8, area.y + 8, area.width - 16, area.height - 16));

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

            GUILayout.Label("Room", EditorStyles.boldLabel);
            if (selected == null)
            {
                EditorGUILayout.HelpBox("Click a room to select it, or drag to draw one by hand.\nScroll to zoom, right-drag to pan.", MessageType.None);
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
