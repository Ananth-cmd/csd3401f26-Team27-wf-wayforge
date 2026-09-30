# Edit the app visually in Unity

Open the **wayforge/android-prototype** folder in Unity Hub using Unity **6000.0.70f1**. Choose **Wayforge App → Open editable Canvas app**.

The main file is **Assets/WayforgeApp/Designer/Scenes/SIT-Editable.unity**. This is a saved, editable scene. Building the APK does not recreate it.

## Your everyday design workflow

1. Stop Play mode. Changes made during Play mode are temporary.
2. Select **App behaviour - connect UI here** in the Hierarchy.
3. In the Inspector, click **Edit Home screen**, **Edit Search screen**, or another screen button.
4. Expand **SIT App Canvas → Safe area → Design board - 390 x 844 → [screen]**.
5. Select an element. Use **Text** to change its wording, font size or colour; **Image** to change background colour or artwork; **Rect Transform** to change its position and size. Use the Rect tool (T) and 2D Scene view to drag and resize visually.
6. Save the scene. Press Play to try the complete journey. The app starts at Home regardless of which screen you were designing.

The board uses a 390 × 844 portrait layout and fits inside the phone's safe area. Keep essential controls inside the board. Search and saved-place results scroll.

Objects labelled **edit me** are static design content. Objects labelled **Dynamic** are populated with the selected location, route or navigation instruction during Play mode. You can edit their appearance, but the app supplies their text. Nothing regenerates your scene layout during Play mode.

## Reusable components

Open **Assets/WayforgeApp/Designer/Prefabs** in the Project window:

| Prefab | What you can change |
| --- | --- |
| Primarybutton | Main action colour, shape, text style and spacing |
| Secondarybutton | Secondary action appearance |
| PlaceCard | Search/saved result appearance, icon and text positions |
| MapPanel | Map viewport and floor, view, recenter and zoom controls |
| BottomNavigation | Explore, Saved and Settings layout |
| Level 1, Level 2, Level 3 | The illustrative building geometry |

Double-click a prefab to edit it. Prefab changes propagate to instances unless that property has an instance override. Scene-specific labels, sizes and button actions are intentionally overridden. Search result rows appear during Play mode and use **PlaceCard**; edit that prefab to redesign them.

Select a Button and expand **On Click()** in the Inspector to see its action. Existing actions are saved connections to the app controller. You can connect a new Button to the controller and choose actions such as **Home**, **ChooseStart**, **ChooseDestination**, **PreviewRoute** or **Back** without writing code. Preserve required references when replacing objects; moving or renaming them is fine.

## Current supplied models

The active scene now uses your three supplied models and **ImportedModels/WayForge/Prepared/Navigation.asset**. See [IMPORTED-MODELS.md](IMPORTED-MODELS.md) for locations and demo-route assumptions. The previous sample data described below is retained for reference.

## Building and navigation data

**Designer/Data/SIT Campus.asset** contains editable floor names, place names, room codes, descriptions, waypoint positions and walkable connections. The supplied building is illustrative; it is not a conversion of your own picture.

To display your converted building, export it using the existing separate bridge and import the package into this app project (see the README). The **Use selected model as building** command creates a Building data asset from its room objects. Then:

1. Drag the imported floor prefab into the scene under **Building - editable floor prefabs** and remove the illustrative floor instances.
2. On that group's **Building Map** component, set **Floors** to the imported scene floor objects, in the same order as the Building asset's Floors list. Keep the existing camera, markers and preview texture references.
3. Assign the imported Building asset to **App behaviour - connect UI here → Building**.
4. Add surveyed doorway/corridor waypoints and walkable connections in the data asset. Model geometry alone does not provide safe routes.
5. Update static sample-specific labels, such as “Explore Board Room,” for your building. Save and test.

Floor geometry and waypoint coordinates must match. Navigation currently uses a manually confirmed starting location and landmark progress; it does not track the phone indoors.

## What the scripts do

| File | Responsibility |
| --- | --- |
| CanvasNavigator.cs | Screen changes, location search, button actions and journey state |
| PlaceCard.cs | Puts place data into a reusable result row |
| MapGestures.cs | Drag, pinch, zoom and map viewport sizing |
| SafeArea.cs | Keeps the interface clear of phone cutouts |
| DesignFrame.cs | Fits the portrait design board to available space |
| BuildingMap.cs | Displays floors, highlights paths and moves the map camera |
| BuildingDefinition.cs | Editable building data and route calculation |
| CanvasDesigner.cs (Editor) | One-time creation of the initial scene and the screen-preview Inspector; not included in the APK |
| CanvasFlowCheck.cs (Editor) | Automated flow verification; not included in the APK |

**NavigationApp.cs**, the old **Scenes/Navigation.unity**, and the UI Toolkit style files belong to the earlier prototype. The editable scene uses **CanvasNavigator**, so you do not need to edit the older UI code. DemoBuilding supplies the initial sample building; saved floor prefabs are what this scene displays.

## Make a new APK

Save your scene, then choose **Wayforge App → Build Android APK**. The output is **Builds/Wayforge-SIT-Models-v0.4.apk**. Original converter code remains separate and unchanged.


