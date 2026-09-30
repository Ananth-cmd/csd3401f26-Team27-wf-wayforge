using System;
using System.Linq;
using UnityEngine;
using UnityEngine.UI;

namespace WayforgeApp
{
    public enum AppScreen { Home, Search, Confirm, Details, Route, Guide, Arrival, Saved, Settings }

    // Scene references are assigned in the Inspector. This script only controls data and behaviour.
    public sealed class CanvasNavigator : MonoBehaviour
    {
        [Header("Building and saved screen objects")]
        public BuildingDefinition building;
        public BuildingMap map;
        public GameObject[] screens;
        [Header("Planner")]
        public Text fromLabel, toLabel;
        public Button findRouteButton;
        [Header("Search and saved places")]
        public InputField searchInput;
        public Text searchHeading, searchEmpty;
        public Transform searchResults, savedResults;
        public GameObject savedEmpty;
        public PlaceCard placeCardPrefab;
        [Header("Selected location and place")]
        public Text confirmName, confirmFloor, detailName, detailDescription;
        [Header("Route")]
        public Text routeFrom, routeTo, routeSummary, routeMode, routeMessage;
        public Button startNavigationButton;
        public Toggle stepFreeToggle;
        [Header("Guidance and arrival")]
        public Text direction, instruction, stepLabel, nextLabel, arrivalName, arrivalFloor;
        public Slider progress;
        public Text[] saveLabels;
        [Header("Map controls")]
        public Text[] floorLabels, viewLabels;
        public Toggle preferredStepFree, preferred2D;

        public AppScreen CurrentScreen { get; private set; }
        public Place StartPlace { get; private set; }
        public Place Destination { get; private set; }
        public Route CurrentRoute { get; private set; }
        public int Step { get; private set; }
        Place pendingStart;
        bool pickingStart, stepFree;
        AppScreen pickerReturn, pickerBack, detailBack;
        string category = "All";

        void Start()
        {
            Application.targetFrameRate = 60;
            var error = building.ValidateData();
            if (error != null) { Debug.LogError(error); enabled = false; return; }
            map.Initialize(building);
            stepFree = PlayerPrefs.GetInt("wayforge.stepFree", 0) == 1;
            map.View(PlayerPrefs.GetInt("wayforge.topDown", 0) == 1);
            preferredStepFree.SetIsOnWithoutNotify(stepFree);
            preferred2D.SetIsOnWithoutNotify(map.TopDown);
            Home();
        }
        void Update() { if (Input.GetKeyDown(KeyCode.Escape)) Back(); }

        public void Show(AppScreen screen)
        {
            CurrentScreen = screen;
            for (int i = 0; i < screens.Length; i++) screens[i].SetActive(i == (int)screen);
            RefreshMapLabels();
        }
        public void Home()
        {
            fromLabel.text = StartPlace == null ? "Enter your current location" : StartPlace.name;
            toLabel.text = Destination == null ? "Enter your destination" : Destination.name;
            findRouteButton.interactable = StartPlace != null && Destination != null;
            map.ShowRoute(null);
            Show(AppScreen.Home);
        }
        public void ChooseStart() => OpenPicker(true, CurrentScreen == AppScreen.Guide ? AppScreen.Route : CurrentScreen);
        public void ChooseDestination() => OpenPicker(false, CurrentScreen);
        void OpenPicker(bool start, AppScreen returnTo)
        {
            pickingStart = start;
            pickerBack = CurrentScreen;
            pickerReturn = returnTo;
            pendingStart = null;
            category = "All";
            searchHeading.text = start ? "Your current location" : "Your destination";
            searchInput.SetTextWithoutNotify("");
            RefreshSearch();
            Show(AppScreen.Search);
        }
        public void RefreshSearch()
        {
            string query = searchInput.text.Trim();
            var places = building.places.Where(p => (!pickingStart || p.startingPoint) &&
                (category == "All" || p.category == category) &&
                (p.name + " " + p.code + " " + Floor(p)).IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0).ToArray();
            FillList(searchResults, places, SelectPlace);
            searchEmpty.gameObject.SetActive(places.Length == 0);
        }
        public void Filter(string value) { category = value; RefreshSearch(); }
        void SelectPlace(Place place)
        {
            if (pickingStart)
            {
                pendingStart = place;
                confirmName.text = place.name; confirmFloor.text = Subtitle(place);
                map.ShowPlace(building.Node(place.waypointId)); Show(AppScreen.Confirm);
            }
            else
            {
                Destination = place; CurrentRoute = null;
                if (pickerReturn == AppScreen.Route) PreviewRoute(); else Home();
            }
        }
        public void ConfirmStart()
        {
            if (pendingStart == null) return;
            StartPlace = pendingStart; CurrentRoute = null; Step = 0;
            if (pickerReturn == AppScreen.Route || pickerReturn == AppScreen.Details) PreviewRoute();
            else if (pickerReturn == AppScreen.Settings) Settings(); else Home();
        }
        public void Details(Place place)
        {
            detailBack = CurrentScreen;
            Destination = place;
            detailName.text = place.name;
            detailDescription.text = place.description;
            RefreshSaveLabels();
            map.ShowPlace(building.Node(place.waypointId)); Show(AppScreen.Details);
        }
        public void QuickDestination() => Details(building.places.FirstOrDefault(p => p.id == "L3-02") ?? building.places[0]);
        public void Directions()
        {
            if (StartPlace == null) OpenPicker(true, AppScreen.Route); else PreviewRoute();
        }
        public void PreviewRoute()
        {
            if (StartPlace == null || Destination == null) { Home(); return; }
            CurrentRoute = RoutePlanner.Find(building, StartPlace.waypointId, Destination.waypointId, stepFree);
            Step = 0;
            routeFrom.text = StartPlace.name + " · " + Floor(StartPlace);
            routeTo.text = Destination.name + " · " + Floor(Destination);
            stepFreeToggle.SetIsOnWithoutNotify(stepFree);
            startNavigationButton.interactable = CurrentRoute != null;
            routeSummary.text = CurrentRoute == null ? "No available route" : CurrentRoute.nodes.Count == 1 ? "You're already here" : CurrentRoute.Minutes + " min · " + Mathf.CeilToInt(CurrentRoute.metres) + " m";
            routeMode.text = stepFree ? "Step-free · lift access" : "Shortest walking route";
            routeMessage.text = CurrentRoute == null ? "Change a place or try another route option." : "Follow the path and confirm each landmark as you go.";
            map.ShowRoute(CurrentRoute); map.SetFloor(building.FloorOf(StartPlace)); Show(AppScreen.Route);
        }
        public void SetStepFree(bool value) { stepFree = value; PreviewRoute(); }
        public void StartNavigation()
        {
            if (CurrentRoute == null) return;
            if (CurrentRoute.nodes.Count == 1) Arrive(); else Guide();
        }
        void Guide()
        {
            var here = CurrentRoute.nodes[Step]; var next = CurrentRoute.nodes[Step + 1];
            bool changeFloor = here.floor != next.floor;
            direction.text = changeFloor ? "Take the " + (CurrentRoute.passages[Step] == Passage.Lift ? "lift" : "stairs") + " to " + building.floors[next.floor].name : "Continue to " + next.label;
            instruction.text = changeFloor ? "Confirm once you reach the next floor." : Mathf.CeilToInt(Vector3.Distance(here.position, next.position)) + " m along the highlighted path";
            nextLabel.text = changeFloor ? "I'm on " + building.floors[next.floor].name + " →" : "I'm at " + next.label + " →";
            stepLabel.text = "STEP " + (Step + 1) + " OF " + (CurrentRoute.nodes.Count - 1) + " · CONFIRMED BY YOU";
            progress.value = (float)Step / (CurrentRoute.nodes.Count - 1);
            map.ShowRoute(CurrentRoute, Step); map.SetFloor(here.floor); Show(AppScreen.Guide);
        }
        public void NextStep()
        {
            if (CurrentRoute == null || CurrentScreen != AppScreen.Guide) return;
            Step++;
            if (Step == CurrentRoute.nodes.Count - 1) Arrive(); else Guide();
        }
        void Arrive()
        {
            arrivalName.text = Destination.name; arrivalFloor.text = Subtitle(Destination);
            RefreshSaveLabels(); map.ShowPlace(building.Node(Destination.waypointId)); Show(AppScreen.Arrival);
        }
        public void Finish() { StartPlace = Destination; Destination = null; CurrentRoute = null; Home(); }
        public void ToggleSaved()
        {
            if (Destination == null) return;
            PlayerPrefs.SetInt(SaveKey(Destination), Saved(Destination) ? 0 : 1); PlayerPrefs.Save(); RefreshSaveLabels();
        }
        public void SavedPlaces()
        {
            var places = building.places.Where(Saved).ToArray();
            FillList(savedResults, places, Details); savedEmpty.SetActive(places.Length == 0); Show(AppScreen.Saved);
        }
        public void Settings() => Show(AppScreen.Settings);
        public void PreferStepFree(bool value) { stepFree = value; PlayerPrefs.SetInt("wayforge.stepFree", value ? 1 : 0); PlayerPrefs.Save(); }
        public void Prefer2D(bool value) { map.View(value); PlayerPrefs.SetInt("wayforge.topDown", value ? 1 : 0); PlayerPrefs.Save(); RefreshMapLabels(); }
        public void ToggleMap() { map.View(!map.TopDown); RefreshMapLabels(); }
        public void NextFloor() { map.SetFloor((map.Floor + 1) % building.floors.Length); RefreshMapLabels(); }
        public void Recenter() => map.Recenter();
        public void ZoomIn() => map.Zoom(.85f);
        public void ZoomOut() => map.Zoom(1.15f);
        public void Back()
        {
            switch (CurrentScreen)
            {
                case AppScreen.Confirm: RefreshSearch(); Show(AppScreen.Search); break;
                case AppScreen.Search:
                    if (pickerBack == AppScreen.Guide && CurrentRoute != null) Guide();
                    else Show(pickerBack);
                    break;
                case AppScreen.Details: if (detailBack == AppScreen.Saved) SavedPlaces(); else Home(); break;
                case AppScreen.Guide: PreviewRoute(); break;
                default: Home(); break;
            }
        }
        void RefreshMapLabels()
        {
            foreach (var label in floorLabels) label.text = building.floors[map.Floor].name;
            foreach (var label in viewLabels) label.text = map.TopDown ? "3D" : "2D";
        }
        void RefreshSaveLabels() { foreach (var label in saveLabels) label.text = Saved(Destination) ? "Remove from saved" : "Save this place"; }
        string Floor(Place p) => building.floors[building.FloorOf(p)].name;
        string Subtitle(Place p) => Floor(p) + " · " + p.code;
        string SaveKey(Place p) => "wayforge.saved." + building.buildingName + "." + p.id;
        bool Saved(Place p) => PlayerPrefs.GetInt(SaveKey(p), 0) == 1;
        void FillList(Transform container, Place[] places, Action<Place> action)
        {
            foreach (Transform child in container) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            foreach (var place in places) Instantiate(placeCardPrefab, container).Bind(place, Floor(place), () => action(place));
        }
    }
}

