/*!
 * \file CanvasNavigator.cs
 * \brief The app's screen flow: search, route preview, step-by-step guidance, arrival
 *
 * The "brain" of the app's user interface. It decides which screen is shown
 * and reacts to button presses:
 *   Home -> pick start / destination (Search, Confirm) -> Route preview ->
 *   Guide (one step at a time, the user taps to confirm each landmark) -> Arrival.
 * It also handles saved places, settings (step-free, 2D/3D map) and the
 * Android back button.
 *
 * Links: asks RoutePlanner.Find (BuildingDefinition.cs) for the route, tells
 * BuildingMap.cs what to draw, and fills the list with PlaceCard items.
 * The buttons in the Unity scene call the public methods here (Home, Directions,
 * NextStep, ToggleSaved...).
 *
 * C# notes: "MonoBehaviour" = a script attached to an object in a Unity scene.
 * Unity calls Start() once when the app starts and Update() every frame.
 * "[Header]" only adds a title above fields in Unity's Inspector.
 * "PlayerPrefs" = small settings saved on the phone that survive restarting the app.
 * ".Where(x => ...)" keeps only items for which the test is true; ".ToArray()" turns the result into an array.
 * "a ?? b" = use a, or b if a is null.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Screen flow: search, start confirmation, route preview, guidance, arrival
 *   - Step-by-step guidance with stairs / lift prompts and user-confirmed progress
 *   - Saved places, step-free and 2D/3D preferences, Android back handling
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-10-01
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;              // Action (a function passed around as a value), StringComparison.
using System.Linq;         // Where / FirstOrDefault / ToArray list helpers.
using UnityEngine;         // MonoBehaviour, GameObject, Mathf, PlayerPrefs, Input...
using UnityEngine.UI;      // Text, Button, Toggle, InputField, Slider (UI widgets).

namespace WayforgeApp
{
    // Every screen in the app. The order must match the "screens" list set up in the scene.
    public enum AppScreen { Home, Search, Confirm, Details, Route, Guide, Arrival, Saved, Settings }

    // Scene references are assigned in the Inspector. This script only controls data and behaviour.
    public sealed class CanvasNavigator : MonoBehaviour
    {
        // ---- Things dragged in from the Unity scene (texts, buttons, screens...) ----
        [Header("Building and saved screen objects")]
        public BuildingDefinition building;   // the building data (Navigation.asset)
        public BuildingMap map;               // the map view
        public GameObject[] screens;          // one panel per AppScreen, in the same order
        [Header("Planner")]
        public Text fromLabel, toLabel;       // "from" / "to" boxes on the Home screen
        public Button findRouteButton;
        [Header("Search and saved places")]
        public InputField searchInput;
        public Text searchHeading, searchEmpty;
        public Transform searchResults, savedResults;   // containers the result cards are added to
        public GameObject savedEmpty;
        public PlaceCard placeCardPrefab;               // template for one result card
        [Header("Selected location and place")]
        public Text confirmName, confirmFloor, detailName, detailDescription;
        [Header("Route")]
        public Text routeFrom, routeTo, routeSummary, routeMode, routeMessage;
        public Button startNavigationButton;
        public Toggle stepFreeToggle;
        [Header("Guidance and arrival")]
        public Text direction, instruction, stepLabel, nextLabel, arrivalName, arrivalFloor;
        public Slider progress;               // progress bar during guidance
        public Text[] saveLabels;             // every "Save this place" button label
        [Header("Map controls")]
        public Text[] floorLabels, viewLabels;
        public Toggle preferredStepFree, preferred2D;   // switches on the Settings screen

        // ---- Current state of the app (other scripts can read these, only this one changes them) ----
        public AppScreen CurrentScreen { get; private set; }
        public Place StartPlace { get; private set; }     // where the user is
        public Place Destination { get; private set; }    // where they want to go
        public Route CurrentRoute { get; private set; }   // route between them (null = none)
        public int Step { get; private set; }             // which step of the route the user is on
        Place pendingStart;                     // start picked but not yet confirmed
        bool pickingStart, stepFree;            // is the search picking a start (vs destination)? step-free mode on?
        AppScreen pickerReturn, pickerBack, detailBack;   // which screen to go to after picking / on Back
        string category = "All";               // current search filter

        // Unity calls this once when the app starts.
        void Start()
        {
            Application.targetFrameRate = 60;
            // Refuse to run with broken building data; log the problem instead.
            var error = building.ValidateData();
            if (error != null) { Debug.LogError(error); enabled = false; return; }
            map.Initialize(building);
            // Load the saved settings (1 = on, 0 = off; default off).
            stepFree = PlayerPrefs.GetInt("wayforge.stepFree", 0) == 1;
            map.View(PlayerPrefs.GetInt("wayforge.topDown", 0) == 1);
            // Show the saved settings on the switches without triggering their "changed" actions.
            preferredStepFree.SetIsOnWithoutNotify(stepFree);
            preferred2D.SetIsOnWithoutNotify(map.TopDown);
            Home();
        }
        // Unity calls this every frame. Escape = the Android back button.
        void Update() { if (Input.GetKeyDown(KeyCode.Escape)) Back(); }

        // Show one screen and hide all the others.
        public void Show(AppScreen screen)
        {
            CurrentScreen = screen;
            // "(int)screen" turns the screen name into its position in the enum (Home = 0, Search = 1...).
            for (int i = 0; i < screens.Length; i++) screens[i].SetActive(i == (int)screen);
            RefreshMapLabels();
        }
        // Home screen: show the chosen start/destination (or a hint), and enable "Find route" only when both are set.
        public void Home()
        {
            fromLabel.text = StartPlace == null ? "Enter your current location" : StartPlace.name;
            toLabel.text = Destination == null ? "Enter your destination" : Destination.name;
            findRouteButton.interactable = StartPlace != null && Destination != null;   // "&&" means AND
            map.ShowRoute(null);
            Show(AppScreen.Home);
        }
        // Buttons for "choose where I am" / "choose where I'm going". Both open the search screen.
        public void ChooseStart() => OpenPicker(true, CurrentScreen == AppScreen.Guide ? AppScreen.Route : CurrentScreen);
        public void ChooseDestination() => OpenPicker(false, CurrentScreen);
        // Open the search screen, remembering what we're picking and where to go afterwards.
        void OpenPicker(bool start, AppScreen returnTo)
        {
            pickingStart = start;
            pickerBack = CurrentScreen;     // screen to return to on Back
            pickerReturn = returnTo;        // screen to go to after picking
            pendingStart = null;
            category = "All";
            searchHeading.text = start ? "Your current location" : "Your destination";
            searchInput.SetTextWithoutNotify("");   // clear the search box
            RefreshSearch();
            Show(AppScreen.Search);
        }
        // Update the search results as the user types or changes the filter.
        public void RefreshSearch()
        {
            string query = searchInput.text.Trim();   // Trim = remove spaces at the start/end
            // Keep places that: can be a start point (when picking a start), match the filter,
            // and whose name, code or floor contains the typed text (ignoring upper/lower case).
            var places = building.places.Where(p => (!pickingStart || p.startingPoint) &&
                (category == "All" || p.category == category) &&
                (p.name + " " + p.code + " " + Floor(p)).IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0).ToArray();
            FillList(searchResults, places, SelectPlace);
            searchEmpty.gameObject.SetActive(places.Length == 0);   // "No results" message
        }
        public void Filter(string value) { category = value; RefreshSearch(); }   // category filter buttons
        // A search result was tapped.
        void SelectPlace(Place place)
        {
            if (pickingStart)
            {
                // Picking a start: show it on the map and ask the user to confirm it.
                pendingStart = place;
                confirmName.text = place.name; confirmFloor.text = Subtitle(place);
                map.ShowPlace(building.Node(place.waypointId)); Show(AppScreen.Confirm);
            }
            else
            {
                // Picking a destination: set it, then go back to the route preview or Home.
                Destination = place; CurrentRoute = null;
                if (pickerReturn == AppScreen.Route) PreviewRoute(); else Home();
            }
        }
        // "Yes, I'm here" on the Confirm screen.
        public void ConfirmStart()
        {
            if (pendingStart == null) return;
            StartPlace = pendingStart; CurrentRoute = null; Step = 0;
            // Continue to wherever the user was heading before they had to pick a start.
            if (pickerReturn == AppScreen.Route || pickerReturn == AppScreen.Details) PreviewRoute();
            else if (pickerReturn == AppScreen.Settings) Settings(); else Home();
        }
        // Details screen for one place (name, description, save button), with it shown on the map.
        public void Details(Place place)
        {
            detailBack = CurrentScreen;
            Destination = place;
            detailName.text = place.name;
            detailDescription.text = place.description;
            RefreshSaveLabels();
            map.ShowPlace(building.Node(place.waypointId)); Show(AppScreen.Details);
        }
        // Shortcut button: open place "L3-02", or the first place if that one doesn't exist.
        public void QuickDestination() => Details(building.places.FirstOrDefault(p => p.id == "L3-02") ?? building.places[0]);
        // "Directions" button: if we don't know where the user is yet, ask first; otherwise show the route.
        public void Directions()
        {
            if (StartPlace == null) OpenPicker(true, AppScreen.Route); else PreviewRoute();
        }
        // Route preview screen: ask the route planner for a route and show its summary and line.
        public void PreviewRoute()
        {
            if (StartPlace == null || Destination == null) { Home(); return; }
            // This is where the app uses the route planner (BuildingDefinition.cs).
            CurrentRoute = RoutePlanner.Find(building, StartPlace.waypointId, Destination.waypointId, stepFree);
            Step = 0;
            routeFrom.text = StartPlace.name + " · " + Floor(StartPlace);
            routeTo.text = Destination.name + " · " + Floor(Destination);
            stepFreeToggle.SetIsOnWithoutNotify(stepFree);
            startNavigationButton.interactable = CurrentRoute != null;   // can't start without a route
            // e.g. "3 min · 120 m", or a message if there's no route / already there.
            routeSummary.text = CurrentRoute == null ? "No available route" : CurrentRoute.nodes.Count == 1 ? "You're already here" : CurrentRoute.Minutes + " min · " + Mathf.CeilToInt(CurrentRoute.metres) + " m";
            routeMode.text = stepFree ? "Step-free · lift access" : "Shortest walking route";
            routeMessage.text = CurrentRoute == null ? "Change a place or try another route option." : "Follow the path and confirm each landmark as you go.";
            map.ShowRoute(CurrentRoute); map.SetFloor(building.FloorOf(StartPlace)); Show(AppScreen.Route);
        }
        // Step-free switch on the route screen: change mode and recalculate.
        public void SetStepFree(bool value) { stepFree = value; PreviewRoute(); }
        // "Start" button: begin step-by-step guidance (or arrive straight away if already there).
        public void StartNavigation()
        {
            if (CurrentRoute == null) return;
            if (CurrentRoute.nodes.Count == 1) Arrive(); else Guide();
        }
        // Guidance screen for the current step: from waypoint "here" to waypoint "next".
        void Guide()
        {
            var here = CurrentRoute.nodes[Step]; var next = CurrentRoute.nodes[Step + 1];
            bool changeFloor = here.floor != next.floor;
            // Floor change -> "Take the lift/stairs to Level 2"; same floor -> "Continue to <next landmark>".
            direction.text = changeFloor ? "Take the " + (CurrentRoute.passages[Step] == Passage.Lift ? "lift" : "stairs") + " to " + building.floors[next.floor].name : "Continue to " + next.label;
            instruction.text = changeFloor ? "Confirm once you reach the next floor." : Mathf.CeilToInt(Vector3.Distance(here.position, next.position)) + " m along the highlighted path";
            // The user taps this button when they get there (there's no GPS indoors, so the user confirms each step).
            nextLabel.text = changeFloor ? "I'm on " + building.floors[next.floor].name + " →" : "I'm at " + next.label + " →";
            stepLabel.text = "STEP " + (Step + 1) + " OF " + (CurrentRoute.nodes.Count - 1) + " · CONFIRMED BY YOU";
            progress.value = (float)Step / (CurrentRoute.nodes.Count - 1);   // progress bar from 0 to 1
            map.ShowRoute(CurrentRoute, Step); map.SetFloor(here.floor); Show(AppScreen.Guide);
        }
        // "I'm at ..." button: move to the next step, or arrive after the last one.
        public void NextStep()
        {
            if (CurrentRoute == null || CurrentScreen != AppScreen.Guide) return;
            Step++;   // add 1
            if (Step == CurrentRoute.nodes.Count - 1) Arrive(); else Guide();
        }
        // Arrival screen.
        void Arrive()
        {
            arrivalName.text = Destination.name; arrivalFloor.text = Subtitle(Destination);
            RefreshSaveLabels(); map.ShowPlace(building.Node(Destination.waypointId)); Show(AppScreen.Arrival);
        }
        // "Done": the place you arrived at becomes your new starting point.
        public void Finish() { StartPlace = Destination; Destination = null; CurrentRoute = null; Home(); }
        // Save / unsave the current destination (stored on the phone with PlayerPrefs).
        public void ToggleSaved()
        {
            if (Destination == null) return;
            PlayerPrefs.SetInt(SaveKey(Destination), Saved(Destination) ? 0 : 1); PlayerPrefs.Save(); RefreshSaveLabels();
        }
        // Saved places screen: list every place the user has saved.
        public void SavedPlaces()
        {
            var places = building.places.Where(Saved).ToArray();
            FillList(savedResults, places, Details); savedEmpty.SetActive(places.Length == 0); Show(AppScreen.Saved);
        }
        public void Settings() => Show(AppScreen.Settings);
        // Settings switches: change the setting and remember it on the phone.
        public void PreferStepFree(bool value) { stepFree = value; PlayerPrefs.SetInt("wayforge.stepFree", value ? 1 : 0); PlayerPrefs.Save(); }
        public void Prefer2D(bool value) { map.View(value); PlayerPrefs.SetInt("wayforge.topDown", value ? 1 : 0); PlayerPrefs.Save(); RefreshMapLabels(); }
        // Map buttons, passed straight on to BuildingMap.
        public void ToggleMap() { map.View(!map.TopDown); RefreshMapLabels(); }
        public void NextFloor() { map.SetFloor((map.Floor + 1) % building.floors.Length); RefreshMapLabels(); }   // "%" wraps back to floor 0 after the top
        public void Recenter() => map.Recenter();
        public void ZoomIn() => map.Zoom(.85f);
        public void ZoomOut() => map.Zoom(1.15f);
        // Back button: where "back" goes depends on the current screen.
        public void Back()
        {
            // "switch" = pick one "case" based on the value; "break" ends that case.
            switch (CurrentScreen)
            {
                case AppScreen.Confirm: RefreshSearch(); Show(AppScreen.Search); break;
                case AppScreen.Search:
                    if (pickerBack == AppScreen.Guide && CurrentRoute != null) Guide();
                    else Show(pickerBack);
                    break;
                case AppScreen.Details: if (detailBack == AppScreen.Saved) SavedPlaces(); else Home(); break;
                case AppScreen.Guide: PreviewRoute(); break;
                default: Home(); break;   // any other screen goes Home
            }
        }
        // Update every floor-name label and the 2D/3D button text.
        void RefreshMapLabels()
        {
            foreach (var label in floorLabels) label.text = building.floors[map.Floor].name;
            foreach (var label in viewLabels) label.text = map.TopDown ? "3D" : "2D";   // the button shows the view you'd switch TO
        }
        void RefreshSaveLabels() { foreach (var label in saveLabels) label.text = Saved(Destination) ? "Remove from saved" : "Save this place"; }
        // Small helpers.
        string Floor(Place p) => building.floors[building.FloorOf(p)].name;                       // e.g. "Level 2"
        string Subtitle(Place p) => Floor(p) + " · " + p.code;                                    // e.g. "Level 2 · E2-02-01"
        string SaveKey(Place p) => "wayforge.saved." + building.buildingName + "." + p.id;        // name of the saved setting for this place
        bool Saved(Place p) => PlayerPrefs.GetInt(SaveKey(p), 0) == 1;                            // has the user saved it?
        // Replace the cards in a list with one card per place; tapping a card runs "action" for that place.
        void FillList(Transform container, Place[] places, Action<Place> action)
        {
            foreach (Transform child in container) { child.gameObject.SetActive(false); Destroy(child.gameObject); }   // remove old cards
            foreach (var place in places) Instantiate(placeCardPrefab, container).Bind(place, Floor(place), () => action(place));   // make a new card from the template
        }
    }
}

