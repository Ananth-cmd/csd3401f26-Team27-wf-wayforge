/*!
 * \file StudioWindow.cs
 * \brief the Wayforge Studio window (Wayforge > Studio)
 *
 * import a floor plan pic or open a .wfb, the C++ core finds the walls,
 * doors and rooms and i draw them in 2D on top of the pic. can zoom, pan,
 * click a room to rename it, drag to draw a new room, then Make 3D.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - toolbar, 2D drawing, mouse controls and the room sidebar
 *   - import image / open .wfb through the C++ core
 *   - sound for each action (calls StudioAudio)
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-09-26
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.IO;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    // Wayforge > Studio window.
    // import a pic or open a .wfb, see it in 2D, then make it 3D.
    // both go through the C++ core (wayforge.dll) which finds the walls, doors and rooms
    public class StudioWindow : EditorWindow
    {
        const float ToolbarHeight = 22f;
        const float SidebarWidth = 240f;

        WayforgeDocument doc;          // current plan
        RoomData selected;             // room thats clicked
        Texture2D image;               // imported pic, drawn under the plan
        const float MetresPerPixel = 0.02f;   // core uses 1 pixel = 2cm

        float pixelsPerMetre = 30f;    // zoom
        Vector2 offset;                // pan

        bool dragging;                 // true while dragging out a room
        Vector2 dragStart, dragEnd;    // drag corners in metres
        string status = "";
        Vector2 roomListScroll;        // scroll pos of the room list

        // adds Wayforge > Studio to the menu
        [MenuItem("Wayforge/Studio")]
        public static void Open() => GetWindow<StudioWindow>("Wayforge Studio");

        // start the bgm when the window opens
        void OnEnable()
        {
            StudioAudio.StartMusic();
        }

        // redraw 10x a sec so the sound info in the sidebar updates
        void OnInspectorUpdate()
        {
            Repaint();
        }

        // clean up the pic and stop sounds when closing
        void OnDisable()
        {
            if (image != null) DestroyImmediate(image);
            StudioAudio.Shutdown();
        }

        // draws the window + handles clicks
        void OnGUI()
        {
            DrawToolbar();

            if (doc == null)
            {
                EditorGUILayout.HelpBox("Import image: pick a floor plan picture.\n" +
                                        "Open .wfb: load a saved plan (try Assets/Wayforge/Samples/square.wfb).",
                                        MessageType.Info);
                GUILayout.Label("Sound: " + StudioAudio.LastSound, EditorStyles.miniLabel);
                GUILayout.Label("Sounds playing: " + StudioAudio.PlayingCount(), EditorStyles.miniLabel);
                return;
            }

            // plan on the left, sidebar on the right
            var canvas = new Rect(0, ToolbarHeight, position.width - SidebarWidth, position.height - ToolbarHeight);
            HandleMouse(canvas);
            DrawPlan(canvas);
            DrawSidebar(new Rect(canvas.xMax, ToolbarHeight, SidebarWidth, canvas.height));
        }

        // toolbar

        // buttons at the top: Import image, Open .wfb, Make 3D, Clear rooms, Audio
        void DrawToolbar()
        {
            GUILayout.BeginHorizontal(EditorStyles.toolbar);

            // these 2 need the dll
            using (new EditorGUI.DisabledScope(!NativeBridge.PluginLoads()))
            {
                if (GUILayout.Button("Import image", EditorStyles.toolbarButton, GUILayout.Width(90)))
                {
                    StudioAudio.Play("click");
                    ImportImage();
                }
                if (GUILayout.Button("Open .wfb", EditorStyles.toolbarButton, GUILayout.Width(70)))
                {
                    StudioAudio.Play("click");
                    OpenFile();
                }
            }

            using (new EditorGUI.DisabledScope(doc == null))
            {
                if (GUILayout.Button("Make 3D", EditorStyles.toolbarButton, GUILayout.Width(70)))
                {
                    RoomBuilder.Build(doc);
                    StudioAudio.Play("make_3d");
                    status = "3D room made, see the Scene view";
                }

                if (GUILayout.Button("Clear rooms", EditorStyles.toolbarButton, GUILayout.Width(80)))
                {
                    doc.Walls.Clear();
                    doc.Rooms.Clear();
                    doc.Doors.Clear();
                    selected = null;
                    StudioAudio.Play("clear");
                }
            }

            // audio settings + test
            if (GUILayout.Button("Audio", EditorStyles.toolbarDropDown, GUILayout.Width(60)))
                ShowAudioMenu();

            GUILayout.FlexibleSpace();
            GUILayout.Label(status, EditorStyles.miniLabel);
            GUILayout.EndHorizontal();
        }

        // audio menu: music on/off, test sounds, open config
        void ShowAudioMenu()
        {
            var menu = new GenericMenu();
            menu.AddItem(new GUIContent("Music"), StudioAudio.MusicOn, StudioAudio.ToggleMusic);
            menu.AddItem(new GUIContent("Play all 8 sounds"), false, StudioAudio.PlayAll);
            foreach (var id in StudioAudio.SoundIds())
            {
                string sound = id;
                menu.AddItem(new GUIContent("Play one/" + sound), false, () => StudioAudio.Play(sound));
            }
            menu.AddSeparator("");
            menu.AddItem(new GUIContent("Open audio config"), false, StudioAudio.OpenConfig);
            menu.ShowAsContext();
        }

        // send the pic to the C++ core to find walls, doors and rooms. pic is drawn underneath
        void ImportImage()
        {
            string path = EditorUtility.OpenFilePanel("Import floor plan image", Application.dataPath + "/Wayforge/Samples", "png,jpg,jpeg");
            if (string.IsNullOrEmpty(path)) return;

            try
            {
                doc = WayforgeDocument.ImportImage(path);
            }
            catch (System.Exception e)
            {
                StudioAudio.Play("error");
                EditorUtility.DisplayDialog("Wayforge", e.Message, "OK");
                return;
            }
            StudioAudio.Play("import_done");

            // load the pic again to show it
            if (image != null) DestroyImmediate(image);
            image = new Texture2D(2, 2);
            image.LoadImage(File.ReadAllBytes(path));

            selected = null;
            FitTo(Vector2.zero, new Vector2(ImageWidthMetres, ImageHeightMetres));
            status = $"{Path.GetFileName(path)}: {doc.Walls.Count} walls, {doc.Doors.Count} door(s), {doc.Rooms.Count} room(s)";
        }

        // load a .wfb through the C++ core
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
                StudioAudio.Play("open_done");
                status = $"{Path.GetFileName(path)}: {doc.Walls.Count} walls, {doc.Rooms.Count} rooms";
            }
            catch (System.Exception e)
            {
                StudioAudio.Play("error");
                EditorUtility.DisplayDialog("Wayforge", e.Message, "OK");
            }
        }

        // pic size in metres
        float ImageWidthMetres => image == null ? 0 : image.width * MetresPerPixel;
        float ImageHeightMetres => image == null ? 0 : image.height * MetresPerPixel;

        // drawing the plan

        // metres to pixels. plan y goes up but screen y goes down so flip it
        Vector2 ToScreen(Vector2 m, Rect canvas) =>
            new Vector2(canvas.x + offset.x + m.x * pixelsPerMetre, canvas.yMax - offset.y - m.y * pixelsPerMetre);

        // pixels back to metres
        Vector2 ToMetres(Vector2 s, Rect canvas) =>
            new Vector2((s.x - canvas.x - offset.x) / pixelsPerMetre, (canvas.yMax - offset.y - s.y) / pixelsPerMetre);

        // zoom + pan so min to max fills the window
        void FitTo(Vector2 min, Vector2 max)
        {
            Vector2 size = Vector2.Max(max - min, Vector2.one);
            float w = position.width - SidebarWidth - 60;
            float h = position.height - ToolbarHeight - 60;
            pixelsPerMetre = Mathf.Min(w / size.x, h / size.y);
            offset = new Vector2(30 - min.x * pixelsPerMetre, 30 - min.y * pixelsPerMetre);
        }

        // zoom so all the walls fit
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

        // draw the pic, rooms, walls, doors and names
        void DrawPlan(Rect canvas)
        {
            if (Event.current.type != EventType.Repaint) return;

            // clip to the plan area
            GUI.BeginClip(canvas);
            var area = new Rect(0, 0, canvas.width, canvas.height);
            EditorGUI.DrawRect(area, new Color(0.18f, 0.18f, 0.2f));

            // pic
            if (image != null)
            {
                Vector2 topLeft = ToScreen(new Vector2(0, ImageHeightMetres), area);
                GUI.DrawTexture(new Rect(topLeft.x, topLeft.y, ImageWidthMetres * pixelsPerMetre, ImageHeightMetres * pixelsPerMetre), image);
            }

            Handles.BeginGUI();

            // rooms, filled triangle by triangle so L shaped rooms look right
            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length < 3) continue;
                var points = new Vector3[room.corners.Length];
                for (int i = 0; i < points.Length; i++) points[i] = ToScreen(room.corners[i], area);

                Color fill = room.Colour;
                fill.a = room == selected ? 0.85f : 0.55f;
                Handles.color = fill;
                int[] tris = room.Triangles;
                for (int t = 0; t + 2 < tris.Length; t += 3)
                    Handles.DrawAAConvexPolygon(points[tris[t]], points[tris[t + 1]], points[tris[t + 2]]);
            }

            // outline the selected room
            if (selected != null && selected.corners.Length >= 3)
            {
                var outline = new Vector3[selected.corners.Length + 1];
                for (int i = 0; i < outline.Length; i++) outline[i] = ToScreen(selected.corners[i % selected.corners.Length], area);
                Handles.color = Color.yellow;
                Handles.DrawAAPolyLine(4f, outline);
            }

            // walls
            Handles.color = new Color(0.1f, 0.5f, 1f);
            foreach (var w in doc.Walls)
                Handles.DrawAAPolyLine(3f, ToScreen(w.a, area), ToScreen(w.b, area));

            // doors
            Handles.color = new Color(0.3f, 0.9f, 0.4f);
            foreach (var d in doc.Doors)
                Handles.DrawAAPolyLine(5f, ToScreen(d.a, area), ToScreen(d.b, area));

            // room being dragged out
            if (dragging)
            {
                Vector2 a = ToScreen(dragStart, area), b = ToScreen(dragEnd, area);
                Handles.color = Color.yellow;
                Handles.DrawAAPolyLine(2f, a, new Vector2(b.x, a.y), b, new Vector2(a.x, b.y), a);
            }

            Handles.EndGUI();

            // room code (+ type) in the middle
            var labelStyle = new GUIStyle(EditorStyles.boldLabel) { alignment = TextAnchor.MiddleCenter, normal = { textColor = Color.black } };
            var kindStyle = new GUIStyle(EditorStyles.miniLabel) { alignment = TextAnchor.MiddleCenter, normal = { textColor = new Color(0f, 0f, 0f, 0.75f) } };
            foreach (var room in doc.Rooms)
            {
                if (room.corners.Length == 0) continue;
                Vector2 s = ToScreen(room.Centre, area);
                GUI.Label(new Rect(s.x - 60, s.y - 10, 120, 16), string.IsNullOrEmpty(room.code) ? room.id : room.code, labelStyle);
                if (room.kind != "unknown")
                    GUI.Label(new Rect(s.x - 60, s.y + 4, 120, 14), room.kind, kindStyle);
            }

            GUI.EndClip();
        }

        // mouse
        // scroll = zoom, right drag = pan, left drag = draw room, left click = select

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
                    // dragged, so add a room
                    selected = doc.AddRectangle(dragStart, dragEnd);
                    StudioAudio.Play("draw_room");
                    status = $"{selected.code} added ({selected.Area:F1} m²)";
                }
                else
                {
                    // just a click, select the room under the mouse
                    selected = null;
                    foreach (var room in doc.Rooms)
                        if (IsInside(dragStart, room.corners)) { selected = room; break; }
                    if (selected != null) StudioAudio.Play("select");
                }
                e.Use();
                Repaint();
            }
        }

        // true if p is inside the outline
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

        // sidebar

        // right panel: selected room details + list of all rooms
        void DrawSidebar(Rect area)
        {
            GUILayout.BeginArea(new Rect(area.x + 8, area.y + 8, area.width - 16, area.height - 16));

            // selected room, can change code, name and type here
            GUILayout.Label("Room", EditorStyles.boldLabel);
            if (selected == null)
            {
                EditorGUILayout.HelpBox("Click a room to select it, or drag to draw one.\nScroll to zoom, right-drag to pan.", MessageType.None);
            }
            else
            {
                EditorGUI.BeginChangeCheck();
                EditorGUILayout.LabelField("Id", selected.id);
                selected.code = EditorGUILayout.TextField("Code", selected.code);
                selected.name = EditorGUILayout.TextField("Name", selected.name);
                int kind = Mathf.Max(0, System.Array.IndexOf(RoomData.Kinds, selected.kind));
                selected.kind = RoomData.Kinds[EditorGUILayout.Popup("Type", kind, RoomData.Kinds)];
                EditorGUILayout.LabelField("Area", selected.Area.ToString("F1") + " m²");
                if (EditorGUI.EndChangeCheck()) Repaint();
            }

            // all rooms, click to select
            GUILayout.Space(8);
            GUILayout.Label($"Rooms ({doc.Rooms.Count})", EditorStyles.boldLabel);
            roomListScroll = GUILayout.BeginScrollView(roomListScroll);
            foreach (var room in doc.Rooms)
            {
                Rect row = GUILayoutUtility.GetRect(0, 18, GUILayout.ExpandWidth(true));
                if (room == selected) EditorGUI.DrawRect(row, new Color(1f, 0.8f, 0.3f, 0.25f));
                EditorGUI.DrawRect(new Rect(row.x + 2, row.y + 3, 12, 12), room.Colour);
                GUI.Label(new Rect(row.x + 20, row.y, row.width - 20, row.height), $"{room.Label}   {room.Area:F1} m²");
                if (Event.current.type == EventType.MouseDown && row.Contains(Event.current.mousePosition))
                {
                    selected = room;
                    StudioAudio.Play("select");
                    Event.current.Use();
                    Repaint();
                }
            }
            GUILayout.EndScrollView();

            GUILayout.FlexibleSpace();
            GUILayout.Label("Sound: " + StudioAudio.LastSound, EditorStyles.miniLabel);
            GUILayout.Label("Sounds playing: " + StudioAudio.PlayingCount(), EditorStyles.miniLabel);
            GUILayout.Label(NativeBridge.PluginLoads() ? "core " + NativeBridge.Version() : "wayforge.dll not loaded", EditorStyles.miniLabel);
            GUILayout.EndArea();
        }
    }
}
