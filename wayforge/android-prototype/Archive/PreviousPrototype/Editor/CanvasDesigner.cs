using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.Events;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace WayforgeApp.Editor
{
    // One-time migration tool. Runtime code never calls this or rebuilds the saved layout.
    public static class CanvasDesigner
    {
        public const string Root = "Assets/WayforgeApp/Designer";
        public const string Scene = Root + "/Scenes/SIT-Editable.unity";
        static Font font;
        static Sprite rounded;
        static CanvasNavigator app;
        static RenderTexture texture;
        static GameObject primary, secondary, card, mapPanel, navigation;
        static readonly List<Text> floors = new List<Text>(), views = new List<Text>(), saves = new List<Text>();
        static Color Ink => C("102E2B");
        static Color Teal => C("006B5E");
        static Color Muted => C("617873");
        static Color C(string value) => BuildingMap.Hex(value);

        [MenuItem("Wayforge App/Open editable Canvas app")]
        public static void Open()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            if (!File.Exists(Scene)) CreateOnce();
            EditorSceneManager.OpenScene(Scene);
            Selection.activeGameObject = UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>().gameObject;
        }

        public static void CreateOnce()
        {
            if (File.Exists(Scene)) { Debug.Log("Editable scene already exists; preserving designer changes."); return; }
            foreach (string folder in new[] { "Scenes", "Prefabs", "Art", "Data", "Materials" }) Directory.CreateDirectory(Root + "/" + folder);
            AssetDatabase.Refresh();
            font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            rounded = CreateRoundedSprite();
            texture = new RenderTexture(1024, 1024, 24) { name = "Building preview", antiAliasing = 2 };
            AssetDatabase.CreateAsset(texture, Root + "/Art/BuildingPreview.renderTexture");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            app = new GameObject("App behaviour - connect UI here").AddComponent<CanvasNavigator>();
            CreateBuilding();
            CreatePrefabs();
            var canvas = new GameObject("SIT App Canvas", typeof(RectTransform), typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvas.GetComponent<CanvasScaler>(); scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(390, 844); scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.Expand;
            var safe = Rect("Safe area", canvas.transform); Stretch(safe); safe.gameObject.AddComponent<SafeArea>();
            var board = Rect("Design board - 390 x 844", safe); board.anchorMin = board.anchorMax = board.pivot = new Vector2(.5f, .5f);
            board.sizeDelta = new Vector2(390, 844); board.gameObject.AddComponent<DesignFrame>();
            var eventSystem = new GameObject("UI EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            Undo.RegisterCreatedObjectUndo(eventSystem, "Create editable app");
            app.screens = new GameObject[Enum.GetValues(typeof(AppScreen)).Length];
            floors.Clear(); views.Clear(); saves.Clear();
            foreach (AppScreen screen in Enum.GetValues(typeof(AppScreen)))
            {
                var panel = Image(screen.ToString() + " Screen", board, 0, 0, 390, 844, C("F5F8F8"), false);
                app.screens[(int)screen] = panel.gameObject;
            }
            Home(); Search(); Confirm(); Details(); Route(); Guide(); Arrival(); Saved(); Settings();
            app.floorLabels = floors.ToArray(); app.viewLabels = views.ToArray(); app.saveLabels = saves.ToArray();
            for (int i = 0; i < app.screens.Length; i++) app.screens[i].SetActive(i == 0);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(Scene, true) };
            foreach (var component in canvas.GetComponentsInChildren<Transform>(true)) component.gameObject.layer = 5;
            foreach (var rootObject in scene.GetRootGameObjects()) foreach (var component in rootObject.GetComponentsInChildren<Component>(true)) if (component && PrefabUtility.IsPartOfPrefabInstance(component)) PrefabUtility.RecordPrefabInstancePropertyModifications(component);
            EditorSceneManager.SaveScene(scene, Scene);
            AssetDatabase.SaveAssets(); AssetDatabase.Refresh();
            Debug.Log("CANVAS_CREATED: " + Scene);
        }

        static Transform Page(AppScreen value) => app.screens[(int)value].transform;
        static void Home()
        {
            var p = Page(AppScreen.Home);
            Text(p, "Brand - edit me", "PATH / SIT", 24, 32, 342, 22, 12, Teal, true);
            Text(p, "Headline - edit me", "Find your way.", 24, 68, 342, 42, 29, Ink, true);
            Text(p, "Subtitle - edit me", "SIT · Campus navigation", 24, 115, 342, 24, 13, Muted);
            Text(p, "Journey heading", "PLAN YOUR JOURNEY", 24, 155, 342, 20, 11, Muted, true);
            var from = Card(p, "From card", 24, 185, "Enter your current location", "FROM · Search a room or landmark", app.ChooseStart);
            var to = Card(p, "To card", 24, 275, "Enter your destination", "TO · Search a room or room code", app.ChooseDestination);
            app.fromLabel = from.title; app.toLabel = to.title;
            app.findRouteButton = Button(p, "Find route", "Find route →", 24, 367, 342, 54, app.PreviewRoute);
            Map(p, 24, 438, 342, 226);
            Text(p, "Prototype note", "Illustrative building · location confirmed by you", 24, 672, 342, 20, 11, Muted);
            Button(p, "Quick destination", "Explore Board Room →", 24, 700, 342, 42, app.QuickDestination, true);
            Nav(p);
        }
        static void Search()
        {
            var p = Page(AppScreen.Search);
            app.searchHeading = Header(p, "Your destination");
            Text(p, "Search help", "Type a room name or code, then choose a place.", 24, 100, 342, 35, 13, Muted);
            var field = Image("Search input - editable", p, 24, 145, 342, 56, Color.white);
            field.raycastTarget = true; var input = field.gameObject.AddComponent<InputField>();
            var text = Text(field.transform, "Entered text", "", 16, 0, 310, 56, 16, Ink);
            var placeholder = Text(field.transform, "Placeholder - edit me", "Search rooms or landmarks", 16, 0, 310, 56, 14, Muted);
            input.textComponent = text; input.placeholder = placeholder; input.targetGraphic = field;
            input.lineType = InputField.LineType.SingleLine; app.searchInput = input;
            UnityEventTools.AddVoidPersistentListener(input.onValueChanged, app.RefreshSearch);
            string[] cats = { "All", "Rooms", "Facilities", "Food" };
            for (int i = 0; i < cats.Length; i++)
            {
                var b = Button(p, "Filter " + cats[i], cats[i], 24 + i * 87, 215, 81, 42, null, true);
                UnityEventTools.AddStringPersistentListener(b.onClick, app.Filter, cats[i]);
            }
            app.searchResults = List(p, "Search results - rows use PlaceCard prefab", 24, 275, 342, 515);
            app.searchEmpty = Text(p, "No results message - edit me", "No matching places. Try another name or code.", 30, 300, 330, 70, 16, Muted);
            app.searchEmpty.gameObject.SetActive(false);
        }
        static void Confirm()
        {
            var p = Page(AppScreen.Confirm); Header(p, "Confirm your location");
            Map(p, 24, 112, 342, 325);
            app.confirmName = Text(p, "Dynamic - selected location", "Main entrance", 24, 460, 342, 40, 24, Ink, true);
            app.confirmFloor = Text(p, "Dynamic - location floor", "Level 1 · L1-01", 24, 504, 342, 28, 14, Muted);
            Note(p, 554, "Look around before confirming", "Only continue if this matches where you are.");
            Button(p, "Confirm location", "Yes, I'm here →", 24, 696, 342, 54, app.ConfirmStart);
            Button(p, "Change location", "Choose another place", 24, 762, 342, 54, app.Back, true);
        }
        static void Details()
        {
            var p = Page(AppScreen.Details); app.detailName = Header(p, "Board Room");
            Map(p, 24, 115, 342, 310);
            Text(p, "Detail headline - edit me", "A little focus, a lot of possibility.", 24, 450, 342, 65, 23, Ink, true);
            app.detailDescription = Text(p, "Dynamic - place description", "Enter through the doorway off the central corridor.", 24, 526, 342, 85, 15, Muted);
            var save = Button(p, "Save place", "Save this place", 24, 680, 342, 54, app.ToggleSaved, true); saves.Add(save.GetComponentInChildren<Text>());
            Button(p, "Get directions", "Get directions →", 24, 758, 342, 58, app.Directions);
        }
        static void Route()
        {
            var p = Page(AppScreen.Route); Header(p, "Your route");
            app.routeFrom = Card(p, "Change starting point", 24, 100, "Main entrance · Level 1", "FROM · Tap to change", app.ChooseStart).title;
            app.routeTo = Card(p, "Change destination", 24, 184, "Board Room · Level 3", "TO · Tap to change", app.ChooseDestination).title;
            app.stepFreeToggle = Toggle(p, "Step-free option", "Step-free route (use lifts)", 24, 272, app.SetStepFree);
            Map(p, 24, 325, 342, 275);
            app.routeSummary = Text(p, "Dynamic - distance and time", "1 min · 30 m", 24, 615, 342, 42, 28, Ink, true);
            app.routeMode = Text(p, "Dynamic - route mode", "Shortest walking route", 24, 660, 342, 24, 14, Muted);
            app.routeMessage = Text(p, "Dynamic - route availability", "Follow the path and confirm each landmark.", 24, 695, 342, 48, 13, Muted);
            app.startNavigationButton = Button(p, "Start navigation", "Start navigation →", 24, 762, 342, 54, app.StartNavigation);
        }
        static void Guide()
        {
            var p = Page(AppScreen.Guide); Header(p, "Follow your route");
            var banner = Image("Direction card - edit me", p, 24, 100, 342, 120, Teal);
            app.direction = Text(banner.transform, "Dynamic - next direction", "Continue to West corridor", 20, 15, 302, 58, 20, Color.white, true);
            app.instruction = Text(banner.transform, "Dynamic - instruction", "4 m along the highlighted path", 20, 79, 302, 30, 13, C("CBECE0"));
            Map(p, 24, 235, 342, 335);
            app.stepLabel = Text(p, "Dynamic - progress caption", "STEP 1 OF 9 · CONFIRMED BY YOU", 24, 585, 342, 26, 11, Muted, true);
            var track = Image("Route progress", p, 24, 625, 342, 12, C("DDF1E9"));
            var fill = Image("Progress fill", track.transform, 0, 0, 342, 12, Teal); Stretch((RectTransform)fill.transform);
            var slider = track.gameObject.AddComponent<Slider>(); slider.fillRect = (RectTransform)fill.transform; slider.interactable = false;
            app.progress = slider;
            var next = Button(p, "Confirm next landmark", "I'm at West corridor →", 24, 694, 342, 56, app.NextStep);
            app.nextLabel = next.GetComponentInChildren<Text>();
            Button(p, "Lost - update location", "I'm lost / update my location", 24, 762, 342, 54, app.ChooseStart, true);
        }
        static void Arrival()
        {
            var p = Page(AppScreen.Arrival);
            var badge = Image("Arrival badge", p, 148, 65, 94, 94, C("DDF1E9")); Icon(badge.transform, "check", 29, 29, 36);
            Text(p, "Arrival headline - edit me", "You've arrived.", 24, 180, 342, 48, 32, Ink, true, TextAnchor.MiddleCenter);
            app.arrivalName = Text(p, "Dynamic - destination name", "Board Room", 24, 238, 342, 35, 23, Ink, true, TextAnchor.MiddleCenter);
            app.arrivalFloor = Text(p, "Dynamic - destination floor", "Level 3 · L3-02", 24, 279, 342, 26, 14, Muted, false, TextAnchor.MiddleCenter);
            Map(p, 24, 332, 342, 260);
            Note(p, 612, "Your destination is ahead", "Check the room sign before entering.");
            var save = Button(p, "Save destination", "Save this place", 24, 704, 342, 48, app.ToggleSaved, true); saves.Add(save.GetComponentInChildren<Text>());
            Button(p, "Finish journey", "Done · Explore", 24, 765, 342, 51, app.Finish);
        }
        static void Saved()
        {
            var p = Page(AppScreen.Saved); Header(p, "Your saved places");
            Text(p, "Saved subtitle - edit me", "Keep your everyday destinations close.", 24, 100, 342, 35, 14, Muted);
            app.savedResults = List(p, "Saved place rows", 24, 153, 342, 580);
            app.savedEmpty = Text(p, "Saved empty message - edit me", "No saved places yet. Open a place and tap Save this place.", 24, 200, 342, 95, 17, Muted).gameObject;
            Nav(p);
        }
        static void Settings()
        {
            var p = Page(AppScreen.Settings);
            Text(p, "Settings headline - edit me", "Make it your way.", 24, 60, 342, 50, 29, Ink, true);
            Text(p, "Settings subtitle", "Navigation preferences", 24, 117, 342, 28, 14, Muted);
            app.preferredStepFree = Toggle(p, "Preferred route", "Prefer step-free routes", 24, 175, app.PreferStepFree);
            app.preferred2D = Toggle(p, "Preferred map view", "Use a 2D map", 24, 239, app.Prefer2D);
            Card(p, "Update current location", 24, 320, "Current location", "Set or update your starting point", app.ChooseStart);
            Note(p, 436, "How your location works", "Your position is the point you confirm. Update it whenever you need to.");
            Note(p, 551, "Prototype campus", "The building is illustrative. Progress is confirmed manually.");
            Nav(p);
        }

        static void CreateBuilding()
        {
            var b = DemoBuilding.Create(); AssetDatabase.CreateAsset(b, Root + "/Data/SIT Campus.asset"); app.building = b;
            var group = new GameObject("Building - editable floor prefabs"); var floorObjects = new GameObject[b.floors.Length];
            Material floorMat = Material("Floor", "B7D2CC"), wallMat = Material("Walls", "E7F0ED"), accentMat = Material("Accent", "CBE4DB");
            for (int i = 0; i < floorObjects.Length; i++)
            {
                var floor = DemoBuilding.MakeFloor(i, floorMat, wallMat, accentMat);
                var prefab = PrefabUtility.SaveAsPrefabAsset(floor, Root + "/Prefabs/Level " + (i + 1) + ".prefab");
                UnityEngine.Object.DestroyImmediate(floor);
                floorObjects[i] = (GameObject)PrefabUtility.InstantiatePrefab(prefab); floorObjects[i].transform.SetParent(group.transform);
                b.floors[i].model = prefab; floorObjects[i].SetActive(i == 0);
            }
            var camera = new GameObject("Building preview camera - editable").AddComponent<Camera>(); camera.orthographic = true;
            camera.backgroundColor = C("EAF1EF"); camera.clearFlags = CameraClearFlags.SolidColor; camera.targetTexture = texture; camera.cullingMask = 1;
            camera.transform.position = new Vector3(24, 34, -34); camera.transform.LookAt(Vector3.zero); camera.orthographicSize = 16;
            var screenCamera = new GameObject("Screen background camera").AddComponent<Camera>(); screenCamera.cullingMask = 0;
            screenCamera.clearFlags = CameraClearFlags.SolidColor; screenCamera.backgroundColor = C("F5F8F8"); screenCamera.depth = -100;
            var light = new GameObject("Building light - editable").AddComponent<Light>(); light.type = LightType.Directional; light.intensity = .8f;
            light.transform.rotation = Quaternion.Euler(45, -25, 0);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat; RenderSettings.ambientLight = C("A6B3AD"); RenderSettings.reflectionIntensity = 0;
            var marker = Ball("Current location marker", "006B5E", .6f);
            var destination = Ball("Destination marker", "F5A35C", .7f); marker.SetActive(false); destination.SetActive(false);
            app.map = group.AddComponent<BuildingMap>();
            var serialized = new SerializedObject(app.map);
            serialized.FindProperty("mapCamera").objectReferenceValue = camera;
            serialized.FindProperty("previewTexture").objectReferenceValue = texture;
            serialized.FindProperty("marker").objectReferenceValue = marker;
            serialized.FindProperty("destination").objectReferenceValue = destination;
            var roots = serialized.FindProperty("floors"); roots.arraySize = floorObjects.Length;
            for (int i = 0; i < floorObjects.Length; i++) roots.GetArrayElementAtIndex(i).objectReferenceValue = floorObjects[i];
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }
        static Material Material(string name, string color)
        {
            var m = new Material(Shader.Find("Standard")) { color = C(color), name = name }; m.SetFloat("_Glossiness", 0);
            AssetDatabase.CreateAsset(m, Root + "/Materials/" + name + ".mat"); return m;
        }
        static GameObject Ball(string name, string color, float size)
        {
            var ball = GameObject.CreatePrimitive(PrimitiveType.Sphere); ball.name = name; ball.transform.localScale = Vector3.one * size;
            ball.GetComponent<Renderer>().sharedMaterial = Material(name, color); return ball;
        }
        static void CreatePrefabs()
        {
            primary = ButtonTemplate("Primary button", Teal, Color.white);
            secondary = ButtonTemplate("Secondary button", C("DDF1E9"), Teal);
            var root = Image("Place card", null, 0, 0, 342, 78, Color.white); var pc = root.gameObject.AddComponent<PlaceCard>();
            root.raycastTarget = true; pc.button = root.gameObject.AddComponent<Button>(); pc.button.targetGraphic = root;
            Image("Icon background", root.transform, 14, 17, 44, 44, C("F4F8F7")); Icon(root.transform, "pin", 25, 28, 22);
            pc.title = Text(root.transform, "Dynamic - place name", "Board Room", 72, 12, 234, 32, 15, Ink, true);
            pc.subtitle = Text(root.transform, "Dynamic - place subtitle", "Level 3 · L3-02", 72, 46, 234, 21, 12, Muted);
            Icon(root.transform, "chevron", 315, 30, 18);
            var element = root.gameObject.AddComponent<LayoutElement>(); element.preferredHeight = 78;
            card = SavePrefab(root.gameObject, "PlaceCard"); app.placeCardPrefab = card.GetComponent<PlaceCard>();
            root = Image("Map panel", null, 0, 0, 342, 292, C("EAF1EF"));
            root.gameObject.AddComponent<RectMask2D>();
            var rawRect = Rect("Live map viewport", root.transform); Stretch(rawRect); var raw = rawRect.gameObject.AddComponent<RawImage>(); raw.texture = texture;
            raw.gameObject.AddComponent<MapGestures>();
            Button(root.transform, "Floor", "Level 1", 12, 12, 102, 40, null, true);
            Button(root.transform, "Recenter", "N ↑", 286, 12, 44, 40, null, true);
            var controls = Rect("Bottom controls", root.transform); controls.anchorMin = controls.anchorMax = new Vector2(1, 0); controls.pivot = new Vector2(1, 0);
            controls.anchoredPosition = new Vector2(-12, 12); controls.sizeDelta = new Vector2(168, 40);
            Button(controls, "View", "2D", 0, 0, 52, 40, null, true); Button(controls, "Zoom out", "−", 58, 0, 52, 40, null, true); Button(controls, "Zoom in", "+", 116, 0, 52, 40, null, true);
            mapPanel = SavePrefab(root.gameObject, "MapPanel");
            root = Image("Bottom navigation", null, 0, 0, 366, 66, Color.white);
            for (int i = 0; i < 3; i++) Button(root.transform, new[] { "Explore", "Saved", "Settings" }[i], new[] { "Explore", "Saved", "Settings" }[i], 8 + i * 118, 6, 114, 54, null, true);
            navigation = SavePrefab(root.gameObject, "BottomNavigation");
        }
        static GameObject ButtonTemplate(string name, Color background, Color foreground)
        {
            var image = Image(name, null, 0, 0, 342, 54, background); image.raycastTarget = true; var b = image.gameObject.AddComponent<Button>(); b.targetGraphic = image;
            var colors = b.colors; colors.disabledColor = new Color(.6f, .7f, .65f, .5f); b.colors = colors;
            var label = Text(image.transform, "Label - edit me", "Button", 12, 5, 318, 44, 15, foreground, true, TextAnchor.MiddleCenter);
            Stretch((RectTransform)label.transform, 12, 5);
            return SavePrefab(image.gameObject, name.Replace(" ", ""));
        }
        static GameObject SavePrefab(GameObject obj, string name)
        {
            var saved = PrefabUtility.SaveAsPrefabAsset(obj, Root + "/Prefabs/" + name + ".prefab"); UnityEngine.Object.DestroyImmediate(obj); return saved;
        }
        static Button Button(Transform parent, string name, string caption, float x, float y, float w, float h, UnityAction action, bool pale = false)
        {
            var obj = (GameObject)PrefabUtility.InstantiatePrefab(pale ? secondary : primary); obj.name = name; obj.transform.SetParent(parent, false);
            Position((RectTransform)obj.transform, x, y, w, h); var b = obj.GetComponent<Button>(); obj.GetComponentInChildren<Text>().text = caption;
            if (action != null) UnityEventTools.AddPersistentListener(b.onClick, action); return b;
        }
        static PlaceCard Card(Transform parent, string name, float x, float y, string title, string subtitle, UnityAction action)
        {
            var obj = (GameObject)PrefabUtility.InstantiatePrefab(card); obj.name = name; obj.transform.SetParent(parent, false);
            Position((RectTransform)obj.transform, x, y, 342, 78); var pc = obj.GetComponent<PlaceCard>(); pc.title.text = title; pc.subtitle.text = subtitle;
            UnityEventTools.AddPersistentListener(pc.button.onClick, action); return pc;
        }
        static void Map(Transform parent, float x, float y, float w, float h)
        {
            var obj = (GameObject)PrefabUtility.InstantiatePrefab(mapPanel); obj.transform.SetParent(parent, false); Position((RectTransform)obj.transform, x, y, w, h);
            obj.GetComponentInChildren<MapGestures>().map = app.map;
            foreach (var b in obj.GetComponentsInChildren<Button>())
            {
                switch (b.name)
                {
                    case "Floor": UnityEventTools.AddPersistentListener(b.onClick, app.NextFloor); floors.Add(b.GetComponentInChildren<Text>()); break;
                    case "Recenter": UnityEventTools.AddPersistentListener(b.onClick, app.Recenter); break;
                    case "View": UnityEventTools.AddPersistentListener(b.onClick, app.ToggleMap); views.Add(b.GetComponentInChildren<Text>()); break;
                    case "Zoom out": UnityEventTools.AddPersistentListener(b.onClick, app.ZoomOut); break;
                    case "Zoom in": UnityEventTools.AddPersistentListener(b.onClick, app.ZoomIn); break;
                }
            }
        }
        static void Nav(Transform parent)
        {
            var obj = (GameObject)PrefabUtility.InstantiatePrefab(navigation); obj.transform.SetParent(parent, false); Position((RectTransform)obj.transform, 12, 762, 366, 66);
            foreach (var b in obj.GetComponentsInChildren<Button>()) UnityEventTools.AddPersistentListener(b.onClick, b.name == "Explore" ? app.Home : b.name == "Saved" ? app.SavedPlaces : (UnityAction)app.Settings);
        }
        static Text Header(Transform parent, string title)
        {
            Button(parent, "Back", "‹", 24, 32, 44, 44, app.Back, true);
            return Text(parent, "Screen title - edit me", title, 80, 31, 286, 48, 22, Ink, true);
        }
        static void Note(Transform parent, float y, string title, string body)
        {
            var box = Image(title + " card", parent, 24, y, 342, 86, C("DDF1E9"));
            Text(box.transform, "Heading - edit me", title, 16, 10, 310, 24, 13, Teal, true);
            Text(box.transform, "Body - edit me", body, 16, 36, 310, 43, 12, Muted);
        }
        static Toggle Toggle(Transform parent, string name, string caption, float x, float y, UnityAction<bool> action)
        {
            var root = Image(name, parent, x, y, 342, 48, Color.white); root.raycastTarget = true; var toggle = root.gameObject.AddComponent<Toggle>(); toggle.targetGraphic = root;
            var box = Image("Check box", root.transform, 13, 12, 24, 24, C("DDF1E9"));
            var check = Image("Check mark", box.transform, 5, 5, 14, 14, Teal); toggle.graphic = check;
            Text(root.transform, "Label - edit me", caption, 50, 0, 280, 48, 14, Ink);
            UnityEventTools.AddPersistentListener(toggle.onValueChanged, action); return toggle;
        }
        static Transform List(Transform parent, string name, float x, float y, float w, float h)
        {
            var root = Rect(name, parent); Position(root, x, y, w, h);
            var scroll = root.gameObject.AddComponent<ScrollRect>(); scroll.horizontal = false; scroll.movementType = ScrollRect.MovementType.Clamped;
            var viewport = Image("Viewport", root, 0, 0, w, h, new Color(0, 0, 0, .001f), false); viewport.gameObject.AddComponent<RectMask2D>(); viewport.raycastTarget = true;
            var rows = Rect("Rows - populated from prefab", viewport.transform); Position(rows, 0, 0, w, h);
            rows.anchorMin = new Vector2(0, 1); rows.anchorMax = new Vector2(1, 1); rows.sizeDelta = new Vector2(0, h);
            var layout = rows.gameObject.AddComponent<VerticalLayoutGroup>(); layout.spacing = 12; layout.childControlHeight = true; layout.childForceExpandHeight = false;
            layout.childControlWidth = true; layout.childForceExpandWidth = true;
            rows.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.viewport = (RectTransform)viewport.transform; scroll.content = rows; return rows;
        }
        static RectTransform Rect(string name, Transform parent)
        {
            var obj = new GameObject(name, typeof(RectTransform)); obj.transform.SetParent(parent, false); return (RectTransform)obj.transform;
        }
        static void Position(RectTransform rect, float x, float y, float w, float h)
        {
            rect.anchorMin = rect.anchorMax = rect.pivot = new Vector2(0, 1); rect.anchoredPosition = new Vector2(x, -y); rect.sizeDelta = new Vector2(w, h);
        }
        static void Stretch(RectTransform rect, float x = 0, float y = 0)
        {
            rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = new Vector2(x, y); rect.offsetMax = new Vector2(-x, -y);
        }
        static Image Image(string name, Transform parent, float x, float y, float w, float h, Color color, bool round = true)
        {
            var rect = Rect(name, parent); Position(rect, x, y, w, h); var image = rect.gameObject.AddComponent<Image>(); image.color = color;
            image.raycastTarget = false; if (round) { image.sprite = rounded; image.type = UnityEngine.UI.Image.Type.Sliced; }
            return image;
        }
        static Text Text(Transform parent, string name, string value, float x, float y, float w, float h, int size, Color color, bool bold = false, TextAnchor align = TextAnchor.MiddleLeft)
        {
            var rect = Rect(name, parent); Position(rect, x, y, w, h); var text = rect.gameObject.AddComponent<Text>();
            text.font = font; text.text = value; text.fontSize = size; text.color = color; text.fontStyle = bold ? FontStyle.Bold : FontStyle.Normal;
            text.alignment = align; text.raycastTarget = false; text.horizontalOverflow = HorizontalWrapMode.Wrap; text.verticalOverflow = VerticalWrapMode.Truncate; return text;
        }
        static void Icon(Transform parent, string name, float x, float y, float size)
        {
            var rect = Rect("Icon - " + name, parent); Position(rect, x, y, size, size); var raw = rect.gameObject.AddComponent<RawImage>();
            raw.texture = Resources.Load<Texture2D>("Icons/" + name); raw.raycastTarget = false;
        }
        static Sprite CreateRoundedSprite()
        {
            string path = Root + "/Art/Rounded.png"; var pixels = new Texture2D(64, 64, TextureFormat.RGBA32, false);
            for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++)
            {
                float dx = Mathf.Max(16 - (x + .5f), 0, x + .5f - 48), dy = Mathf.Max(16 - (y + .5f), 0, y + .5f - 48);
                pixels.SetPixel(x, y, new Color(1, 1, 1, Mathf.Clamp01(16.5f - Mathf.Sqrt(dx * dx + dy * dy))));
            }
            pixels.Apply(); File.WriteAllBytes(path, pixels.EncodeToPNG()); UnityEngine.Object.DestroyImmediate(pixels); AssetDatabase.ImportAsset(path);
            var importer = (TextureImporter)AssetImporter.GetAtPath(path); importer.textureType = TextureImporterType.Sprite; importer.spriteImportMode = SpriteImportMode.Single;
            importer.spriteBorder = new Vector4(18, 18, 18, 18); importer.alphaIsTransparency = true; importer.mipmapEnabled = false; importer.SaveAndReimport();
            return AssetDatabase.LoadAssetAtPath<Sprite>(path);
        }

        // Used once to finish the initial migration before delivery; never called by builds.
        public static void FinishInitialLayout()
        {
            var sprite = CreateRoundedSprite();
            foreach (var path in Directory.GetFiles(Root + "/Prefabs", "*.prefab"))
            {
                var contents = PrefabUtility.LoadPrefabContents(path);
                foreach (var image in contents.GetComponentsInChildren<Image>(true))
                    if (image.type == UnityEngine.UI.Image.Type.Sliced && !image.sprite) image.sprite = sprite;
                PrefabUtility.SaveAsPrefabAsset(contents, path); PrefabUtility.UnloadPrefabContents(contents);
            }
            var scene = EditorSceneManager.OpenScene(Scene);
            foreach (var root in scene.GetRootGameObjects()) foreach (var image in root.GetComponentsInChildren<Image>(true))
                if (image.type == UnityEngine.UI.Image.Type.Sliced && !image.sprite) { image.sprite = sprite; if (PrefabUtility.IsPartOfPrefabInstance(image)) PrefabUtility.RecordPrefabInstancePropertyModifications(image); }
            var controller = UnityEngine.Object.FindFirstObjectByType<CanvasNavigator>();
            Stretch(controller.progress.fillRect); controller.progress.value = 0;
            foreach (var camera in UnityEngine.Object.FindObjectsByType<Camera>(FindObjectsSortMode.None)) if (camera.name.StartsWith("Building preview")) camera.cullingMask = 1;
            EditorSceneManager.SaveScene(scene); AssetDatabase.SaveAssets();
            CanvasFlowCheck.Run();
        }
    }

    [CustomEditor(typeof(CanvasNavigator))]
    public sealed class CanvasNavigatorInspector : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var app = (CanvasNavigator)target;
            EditorGUILayout.HelpBox("Choose a screen to design outside Play mode. Expand it under SIT App Canvas, select a Text/Image/Button, and edit its Inspector. These buttons only change editor visibility.", MessageType.Info);
            foreach (AppScreen screen in Enum.GetValues(typeof(AppScreen)))
                if (GUILayout.Button("Edit " + screen + " screen") && !Application.isPlaying)
                {
                    foreach (var page in app.screens) Undo.RecordObject(page, "Preview screen");
                    for (int i = 0; i < app.screens.Length; i++) app.screens[i].SetActive(i == (int)screen);
                    Selection.activeGameObject = app.screens[(int)screen]; SceneView.lastActiveSceneView?.FrameSelected();
                    EditorSceneManager.MarkSceneDirty(app.gameObject.scene);
                }
            DrawDefaultInspector();
        }
    }
}


