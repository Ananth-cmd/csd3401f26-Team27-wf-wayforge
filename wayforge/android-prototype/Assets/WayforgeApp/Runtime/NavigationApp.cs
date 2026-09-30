using System;
using System.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace WayforgeApp
{
    public sealed class NavigationApp : MonoBehaviour
    {
        BuildingDefinition building;
        BuildingMap map;
        VisualElement root, page, content;
        PanelSettings panel;
        Place selected, start, pendingStart;
        Route route;
        int step;
        bool stepFree, topDown, recovering;
        string screen = "Explore", category = "All", query = "";
        string backTarget = "Explore", startReturn = "Explore", startBack = "Explore", destinationReturn = "Explore", detailsReturn = "Explore";
        bool choosingDestination;
        Rect lastSafe;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot()
        {
            if (FindFirstObjectByType<CanvasNavigator>() == null && FindFirstObjectByType<NavigationApp>() == null)
                new GameObject("Wayforge navigation app").AddComponent<NavigationApp>();
        }
        void Start()
        {
            Application.targetFrameRate = 60;
            Screen.orientation = ScreenOrientation.Portrait;
            building = Resources.Load<BuildingDefinition>("Building");
            if (!building) building = DemoBuilding.Create();
            panel = ScriptableObject.CreateInstance<PanelSettings>();
            panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panel.referenceResolution = new Vector2Int(390, 844);
            panel.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            panel.match = 0;
            panel.themeStyleSheet = Resources.Load<ThemeStyleSheet>("AppTheme");
            var document = gameObject.AddComponent<UIDocument>(); document.panelSettings = panel;
            root = document.rootVisualElement;
            root.styleSheets.Add(Resources.Load<StyleSheet>("App"));
            root.AddToClassList("app");
            root.style.unityFont = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            string error = building.ValidateData();
            if (error != null) { Label(root, "Building needs setup", "title"); Label(root, error, "body"); return; }
            // A custom building must supply every floor model; demo geometry must never impersonate an imported floor.
            if (!building.illustrative && building.floors.Any(f => !f.model))
            { Label(root, "Building needs setup", "title"); Label(root, "Assign a model prefab to every floor in the Building asset.", "body"); return; }
            var backgroundCamera = new GameObject("Screen background").AddComponent<Camera>();
            backgroundCamera.transform.SetParent(transform);
            backgroundCamera.clearFlags = CameraClearFlags.SolidColor;
            backgroundCamera.backgroundColor = BuildingMap.Hex("F5F8F8");
            backgroundCamera.cullingMask = 0; backgroundCamera.depth = -100;
            map = new GameObject("Interactive building map").AddComponent<BuildingMap>();
            map.transform.SetParent(transform); map.Initialize(building);
            stepFree = PlayerPrefs.GetInt("wayforge.stepFree", 0) == 1;
            topDown = PlayerPrefs.GetInt("wayforge.topDown", 0) == 1; map.View(topDown);
            Show("Explore");
        }
        void Update()
        {
            if (root != null && (Screen.safeArea != lastSafe || Time.frameCount < 3))
            {
                lastSafe = Screen.safeArea;
                float scale = 390f / Mathf.Max(1, Screen.width);
                root.style.paddingTop = (Screen.height - lastSafe.yMax) * scale;
                root.style.paddingBottom = lastSafe.y * scale;
                root.style.paddingLeft = lastSafe.x * scale;
                root.style.paddingRight = (Screen.width - lastSafe.xMax) * scale;
            }
            if (Input.GetKeyDown(KeyCode.Escape) && map) Show(backTarget);
        }
        void Show(string next)
        {
            // Invalid/incomplete journeys always return to the planner, never a broken screen.
            if ((next == "Details" || next == "Arrived") && selected == null) next = "Explore";
            if (next == "Route" && (start == null || selected == null)) next = "Explore";
            if (next == "Confirm" && pendingStart == null) next = "Manual";
            screen = next; backTarget = "Explore"; root.Clear();
            page = new VisualElement(); page.AddToClassList("page"); root.Add(page);
            var scroll = new ScrollView(ScrollViewMode.Vertical); scroll.AddToClassList("page-scroll");
            scroll.horizontalScrollerVisibility = ScrollerVisibility.Hidden;
            scroll.verticalScrollerVisibility = ScrollerVisibility.Hidden;
            page.Add(scroll); content = scroll.contentContainer; content.AddToClassList("content");
            switch (next)
            {
                case "Explore": Explore(); break;
                case "Search": Search(false, false); break;
                case "Saved": Search(true, false); break;
                case "Details": Details(); break;
                case "Location": Location(); break;
                case "Manual": Search(false, true); break;
                case "QR": Qr(); break;
                case "Confirm": Confirm(); break;
                case "Route": Preview(); break;
                case "Guide": Guide(); break;
                case "Arrived": Arrived(); break;
                case "Settings": Settings(); break;
            }
            if (next == "Explore" || next == "Saved" || next == "Settings") BottomNav();
        }
        void Explore()
        {
            map.ShowRoute(null);
            Label(content, "PATH / SIT", "eyebrow brand");
            Label(content, "Find your way.", "hero");
            Label(content, "SIT · Campus navigation", "subtitle");
            Label(content, "PLAN YOUR JOURNEY", "eyebrow");
            Card(content, start == null ? "Enter your current location" : start.name,
                start == null ? "FROM · Search a room or landmark" : "FROM · " + PlaceSubtitle(start), "locate", () => BeginStart("Explore"));
            Card(content, selected == null ? "Enter your destination" : selected.name,
                selected == null ? "TO · Search a room or room code" : "TO · " + PlaceSubtitle(selected), "pin", () => BeginDestination("Explore"));
            var directions = Button(content, "Find route →", () => Show("Route"), "primary");
            directions.SetEnabled(start != null && selected != null);
            if (start == null || selected == null) Label(content, "Choose both places to find your route.", "caption");
            MapCard(235);
            Label(content, "QUICK DESTINATIONS", "eyebrow section");
            var quick = building.places.FirstOrDefault(p => p.name == "Board Room") ?? building.places.FirstOrDefault();
            if (quick != null) PlaceRow(content, quick, () => OpenPlace(quick));
            var chips = Row(content);
            foreach (string c in new[] { "Rooms", "Food", "Facilities" })
                Button(chips, c == "Food" ? "Food & cafés" : c, () => { choosingDestination = false; category = c; query = ""; Show("Search"); }, "chip");
            Label(content, building.illustrative ? "Demo building · illustrative layout" : "Building model from Wayforge", "caption");
        }
        void Search(bool savedOnly, bool choosingStart)
        {
            Header(choosingStart ? "Your current location" : savedOnly ? "Your saved places" : "Your destination", choosingStart ? startBack : choosingDestination ? destinationReturn : "Explore");
            Label(content, choosingStart ? "Type a room, code or landmark, then select it." : "Type a destination, then choose a matching place.", "subtitle");
            Label(content, "SEARCH BY NAME OR ROOM CODE", "eyebrow");
            var field = new TextField { value = choosingStart || savedOnly ? "" : query };
            field.AddToClassList("search-field"); field.tooltip = "Search places"; content.Add(field);
            var chips = Row(content);
            var results = new VisualElement();
            string localCategory = choosingStart || savedOnly ? "All" : category;
            Action refresh = () =>
            {
                results.Clear();
                var found = building.places.Where(p => (!savedOnly || IsSaved(p)) && (!choosingStart || p.startingPoint)
                    && (localCategory == "All" || p.category == localCategory)
                    && (p.name + " " + p.code + " " + building.floors[building.FloorOf(p)].name).IndexOf((field.value ?? "").Trim(), StringComparison.OrdinalIgnoreCase) >= 0).ToArray();
                Label(results, found.Length + (choosingStart ? " STARTING POINTS" : " PLACES"), "eyebrow section");
                foreach (var p in found) PlaceRow(results, p, () =>
                {
                    if (choosingStart) { pendingStart = p; Show("Confirm"); }
                    else if (choosingDestination && !savedOnly) { selected = p; route = null; Show(destinationReturn); }
                    else OpenPlace(p);
                });
                if (found.Length == 0) Note(results, savedOnly ? "No saved places yet" : "No matching places", savedOnly ? "Open a destination and tap Save this place." : "Try another name, code or category.");
            };
            foreach (string c in new[] { "All", "Rooms", "Facilities", "Food" })
            {
                var b = Button(chips, c, () => { localCategory = c; if (!choosingStart) category = c; foreach (var child in chips.Children()) child.EnableInClassList("selected", (child as Button)?.text == c); refresh(); }, "chip");
                b.EnableInClassList("selected", c == localCategory);
            }
            field.RegisterValueChangedCallback(e => { if (!choosingStart) query = e.newValue; refresh(); });
            content.Add(results); refresh();
            Note(content, "Search by room code", "Try a name or a code such as L3-02.");
        }
        void BeginStart(string returnTo)
        {
            startBack = screen; startReturn = returnTo; pendingStart = null; Show("Manual");
        }
        void BeginDestination(string returnTo)
        {
            destinationReturn = returnTo; choosingDestination = true; query = ""; category = "All"; Show("Search");
        }
        void OpenPlace(Place p) { detailsReturn = screen; choosingDestination = false; selected = p; route = null; Show("Details"); }
        void Details()
        {
            Header(selected.name, detailsReturn); Label(content, PlaceSubtitle(selected), "subtitle");
            map.ShowPlace(building.Node(selected.waypointId)); MapCard(292);
            Label(content, "A little focus, a lot of possibility.", "title section");
            Label(content, selected.description, "body");
            SaveButton();
            Note(content, "Your route starts with you", start == null ? "Choose a starting point to get directions." : "Starting from " + start.name + ".");
            Button(ActionArea(), start == null ? "Set start & get directions →" : "Get directions →", () => { if (start == null) BeginStart("Route"); else Show("Route"); }, "primary");
        }
        void Location()
        {
            Header(recovering ? "Find your bearings" : "Where are you?", selected == null ? "Explore" : "Details");
            Label(content, "Choose how to set your starting point.", "subtitle");
            Card(content, "Preview a QR checkpoint", "Simulated checkpoint for this prototype", "locate", () => Show("QR"));
            Card(content, "Choose a place manually", "Select a recognisable room or landmark", "pin", () => Show("Manual"));
            Note(content, "Indoor location, without the guesswork", "Your position is the location you confirm. Update it whenever you need to.");
            if (selected != null) Note(content, "HEADING TO", selected.name + " · " + PlaceSubtitle(selected));
        }
        void Qr()
        {
            Header("Checkpoint preview", "Location");
            Note(content, "SIMULATED SCAN", "This preview does not use your camera. Choose a checkpoint below, then confirm where you are.");
            foreach (var p in building.places.Where(p => p.startingPoint))
                Card(content, p.name, "Demo checkpoint · " + p.code, "locate", () => { pendingStart = p; Show("Confirm"); });
        }
        void Confirm()
        {
            Header("Confirm your location", "Manual");
            map.ShowPlace(building.Node(pendingStart.waypointId)); MapCard(290);
            Label(content, pendingStart.name, "title section"); Label(content, PlaceSubtitle(pendingStart), "body");
            Note(content, "Look around before confirming", "Only continue if this matches your current location.");
            var actions = ActionArea();
            Button(actions, "Yes, I'm here →", () => { start = pendingStart; route = null; step = 0; recovering = false; Show(startReturn); }, "primary");
            Button(actions, "Choose another starting point", () => Show("Manual"), "secondary");
        }
        void Preview()
        {
            Header("Your route", "Explore");
            Card(content, start.name, "FROM · " + PlaceSubtitle(start) + " · Change", "locate", () => BeginStart("Route"));
            Card(content, selected.name, "TO · " + PlaceSubtitle(selected) + " · Change", "pin", () => BeginDestination("Route"));
            var row = Row(content);
            foreach (bool accessible in new[] { false, true })
            {
                var b = Button(row, accessible ? "Step-free" : "Shortest", () => { stepFree = accessible; Show("Route"); }, "chip");
                b.EnableInClassList("selected", accessible == stepFree);
            }
            route = RoutePlanner.Find(building, start.waypointId, selected.waypointId, stepFree); step = 0;
            map.ShowRoute(route); map.SetFloor(building.FloorOf(start)); MapCard(280);
            if (route == null)
            {
                Note(content, "No available route", "Try the other route option or change one of the places above.");
                Button(content, "Change starting location", () => BeginStart("Route"), "secondary"); return;
            }
            Label(content, route.nodes.Count == 1 ? "You're already here." : route.Minutes + " min · " + Mathf.CeilToInt(route.metres) + " m", "hero section");
            Label(content, stepFree ? "Step-free · uses lifts for floor changes" : "Shortest available walking route", "body");
            Note(content, "A clear route, one step at a time", "Follow the highlighted path and confirm each landmark as you go.");
            Button(ActionArea(), "Start navigation →", () => Show(route.nodes.Count == 1 ? "Arrived" : "Guide"), "primary");
        }
        void Guide()
        {
            if (route == null || step >= route.nodes.Count - 1) { Show("Arrived"); return; }
            var current = route.nodes[step]; var next = route.nodes[step + 1];
            bool change = current.floor != next.floor;
            Header("To " + selected.name, "Route");
            var direction = new VisualElement(); direction.AddToClassList("direction"); content.Add(direction);
            direction.Add(Icon("arrow", 30));
            Label(direction, change ? "Take the " + (route.passages[step] == Passage.Lift ? "lift" : "stairs") + " to " + building.floors[next.floor].name : "Continue to " + next.label, "direction-title");
            Label(direction, change ? "Confirm after you reach the next floor." : Mathf.CeilToInt(Vector3.Distance(current.position, next.position)) + " m along the highlighted path", "direction-subtitle");
            map.ShowRoute(route, step); map.SetFloor(current.floor); MapCard(340);
            Label(content, "STEP " + (step + 1) + " OF " + (route.nodes.Count - 1) + " · POSITION CONFIRMED BY YOU", "eyebrow");
            content.Add(new ProgressBar { lowValue = 0, highValue = route.nodes.Count - 1, value = step, title = "Route progress" });
            var actions = ActionArea();
            Button(actions, change ? "I'm on " + building.floors[next.floor].name + " →" : "I'm at " + next.label + " →", () => { step++; Show(step == route.nodes.Count - 1 ? "Arrived" : "Guide"); }, "primary");
            Button(actions, "I'm lost / update my location", () => { recovering = true; BeginStart("Route"); }, "secondary");
        }
        void Arrived()
        {
            var badge = new VisualElement(); badge.AddToClassList("arrival-badge"); badge.Add(Icon("check", 36)); content.Add(badge);
            Label(content, "You've arrived.", "hero centered"); Label(content, selected.name, "title centered"); Label(content, PlaceSubtitle(selected), "subtitle centered");
            map.ShowPlace(building.Node(selected.waypointId)); MapCard(225);
            Note(content, "Your destination is ahead", selected.description);
            SaveButton(); Button(ActionArea(), "Done · Explore", () => { start = selected; selected = null; route = null; Show("Explore"); }, "primary");
        }
        void Settings()
        {
            Label(content, "Make it your way.", "hero"); Label(content, "Navigation preferences", "subtitle");
            Card(content, "Route preference", stepFree ? "Step-free" : "Shortest", "walk", () => { stepFree = !stepFree; PlayerPrefs.SetInt("wayforge.stepFree", stepFree ? 1 : 0); PlayerPrefs.Save(); Show("Settings"); });
            Card(content, "Map view", topDown ? "2D floor plan" : "3D building", "map", () => { topDown = !topDown; map.View(topDown); PlayerPrefs.SetInt("wayforge.topDown", topDown ? 1 : 0); PlayerPrefs.Save(); Show("Settings"); });
            Card(content, "Current location", start == null ? "Set your starting point" : start.name, "locate", () => BeginStart("Settings"));
            Note(content, "How your location works", "Your position is based on the point you confirm. Update manually when needed. Checkpoint scanning is a simulation.");
            Note(content, building.illustrative ? "Prototype building" : building.buildingName, building.illustrative ? "Maps, places and journey times are illustrative. Import your Wayforge output to showcase your own building." : "This app displays the exported building model. Route links are configured separately.");
        }
        void SaveButton()
        {
            Button(content, IsSaved(selected) ? "Remove from saved places" : "Save this place", () => { PlayerPrefs.SetInt(SavedKey(selected), IsSaved(selected) ? 0 : 1); PlayerPrefs.Save(); Show(screen); }, "secondary");
        }
        string SavedKey(Place p) => "wayforge.saved." + building.buildingName + "." + p.id;
        bool IsSaved(Place p) => PlayerPrefs.GetInt(SavedKey(p), 0) == 1;
        string PlaceSubtitle(Place p) => building.floors[building.FloorOf(p)].name + " · " + p.code;
        void PlaceRow(VisualElement host, Place p, Action action) => Card(host, p.name, PlaceSubtitle(p), "pin", action);
        void Header(string title, string back)
        {
            backTarget = back;
            var row = Row(content); row.AddToClassList("header");
            var b = Button(row, "", () => Show(back), "icon-button"); b.Add(Icon("back")); b.tooltip = "Back";
            Label(row, title, "title");
        }
        void BottomNav()
        {
            var nav = Row(page); nav.AddToClassList("bottom-nav");
            foreach (var item in new[] { ("Explore", "map"), ("Saved", "saved"), ("Settings", "settings") })
            {
                var b = Button(nav, "", () => { choosingDestination = false; Show(item.Item1); }, "nav-button"); b.Add(Icon(item.Item2, 21)); Label(b, item.Item1, "nav-label");
                b.EnableInClassList("active", screen == item.Item1);
            }
        }
        void MapCard(float height, bool startButton = false)
        {
            var card = new VisualElement(); card.AddToClassList("map-card"); card.style.height = height; content.Add(card);
            var img = new Image { image = map.Texture, scaleMode = ScaleMode.StretchToFill }; img.AddToClassList("map-image"); card.Add(img);
            img.RegisterCallback<GeometryChangedEvent>(e => { if (e.newRect.height > 0) map.Aspect(e.newRect.width / e.newRect.height); });
            var pointers = new System.Collections.Generic.Dictionary<int, Vector2>(); bool pan = false;
            img.RegisterCallback<PointerDownEvent>(e => { pointers[e.pointerId] = e.position; pan = e.shiftKey || e.button == 1; img.CapturePointer(e.pointerId); e.StopPropagation(); });
            img.RegisterCallback<PointerMoveEvent>(e =>
            {
                if (!pointers.TryGetValue(e.pointerId, out var previous)) return;
                Vector2 now = e.position; var delta = now - previous;
                if (pointers.Count == 2)
                {
                    var other = pointers.First(p => p.Key != e.pointerId).Value;
                    float before = Vector2.Distance(previous, other), after = Vector2.Distance(now, other);
                    if (before > 10 && after > 10) map.Zoom(before / after);
                    map.Pan(delta * .5f);
                }
                else if (pan || topDown) map.Pan(delta); else map.Orbit(-delta.x * .4f);
                pointers[e.pointerId] = now; e.StopPropagation();
            });
            img.RegisterCallback<PointerUpEvent>(e => { pointers.Remove(e.pointerId); img.ReleasePointer(e.pointerId); });
            img.RegisterCallback<PointerCancelEvent>(e => { pointers.Remove(e.pointerId); img.ReleasePointer(e.pointerId); });
            img.RegisterCallback<WheelEvent>(e => { map.Zoom(e.delta.y > 0 ? 1.1f : .9f); e.StopPropagation(); });
            var top = Row(card); top.AddToClassList("map-top");
            Button floorButton = null;
            floorButton = Button(top, building.floors[map.Floor].name, () => { map.SetFloor((map.Floor + 1) % building.floors.Length); floorButton.text = building.floors[map.Floor].name; }, "map-chip");
            Button(top, "N ↑", () => map.Recenter(), "map-chip compass");
            var controls = Row(card); controls.AddToClassList("map-controls");
            Button viewButton = null;
            viewButton = Button(controls, topDown ? "3D" : "2D", () => { topDown = !topDown; map.View(topDown); viewButton.text = topDown ? "3D" : "2D"; }, "map-chip");
            Button(controls, "−", () => map.Zoom(1.15f), "map-chip zoom");
            Button(controls, "+", () => map.Zoom(.85f), "map-chip zoom");
            var locate = Button(controls, "", () => map.Recenter(), "map-chip zoom"); locate.Add(Icon("locate")); locate.tooltip = "Recenter map";
            if (startButton)
            {
                controls.style.bottom = 74;
                var set = Button(card, start == null ? "Set your starting location" : "Start: " + start.name, () => BeginStart("Explore"), "set-start");
                set.Insert(0, Icon("locate"));
            }
        }
        VisualElement ActionArea()
        {
            var actions = new VisualElement(); actions.AddToClassList("actions"); page.Add(actions); return actions;
        }
        static VisualElement Row(VisualElement parent) { var row = new VisualElement(); row.AddToClassList("row"); parent.Add(row); return row; }
        static Label Label(VisualElement parent, string text, string classes)
        {
            var label = new Label(text); foreach (var c in classes.Split(' ')) label.AddToClassList(c); parent.Add(label); return label;
        }
        static Button Button(VisualElement parent, string text, Action clicked, string classes)
        {
            var b = new Button(clicked) { text = text }; foreach (var c in classes.Split(' ')) b.AddToClassList(c); parent.Add(b); return b;
        }
        static Image Icon(string name, float size = 22)
        {
            var icon = new Image { image = Resources.Load<Texture2D>("Icons/" + name), scaleMode = ScaleMode.ScaleToFit, pickingMode = PickingMode.Ignore };
            icon.style.width = size; icon.style.height = size; icon.style.flexShrink = 0; return icon;
        }
        static void Card(VisualElement parent, string title, string subtitle, string icon, Action clicked)
        {
            var card = Button(parent, "", clicked, "place-card");
            var box = new VisualElement(); box.AddToClassList("icon-box"); box.Add(Icon(icon)); card.Add(box);
            var copy = new VisualElement(); copy.AddToClassList("card-copy"); card.Add(copy);
            Label(copy, title, "card-title"); Label(copy, subtitle, "card-subtitle"); card.Add(Icon("chevron", 18));
        }
        static void Note(VisualElement parent, string title, string body)
        {
            var note = new VisualElement(); note.AddToClassList("note"); parent.Add(note);
            Label(note, title, "note-title"); Label(note, body, "note-body");
        }
        void OnDestroy() { if (panel) Destroy(panel); }
    }
}
