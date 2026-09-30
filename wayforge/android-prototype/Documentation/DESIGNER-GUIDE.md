# Editing the app

Open **Assets/WayforgeApp/Scenes/Main.unity**. Stop Play mode before making changes you want to keep.

1. Select **AppController** in the Hierarchy.
2. Click **Edit Home**, **Edit Search**, or another screen in the Inspector.
3. Expand that screen under **Canvas → Safe area → Screens**.
4. Select an element, edit its Inspector and save the scene.

**Text** controls wording, font size and colour. **Image** controls backgrounds and artwork. **Rect Transform** controls position and size. Use the Rect tool (T) to drag elements in the Scene view. The 390 × 844 design board scales to fit the phone.

Location names, route instructions and progress are filled in during Play mode. Edit their appearance in the scene and their content through the building data. Static headings keep your wording.

## Reusable elements

**UI/Prefabs** contains the main button, secondary button, place card, map panel and bottom navigation. Double-click a prefab to edit its shared design. Search results use **PlaceCard**.

Select a Button and expand **On Click()** to see its action on AppController. Moving or renaming an object preserves its references; deleting and replacing it may require reconnecting fields.

## The seven scripts

| Script in Scripts | Purpose |
| --- | --- |
| CanvasNavigator.cs | Screen changes, search, selections and journey progress |
| BuildingDefinition.cs | Building data and route calculation |
| BuildingMap.cs | Floor display, camera controls and route lines |
| PlaceCard.cs | Place name and click action for a result row |
| MapGestures.cs | Map dragging and zooming |
| SafeArea.cs | Keeps the interface within the phone's usable screen area |
| DesignFrame.cs | Fits the design board to the available space |

The scene already contains the interface and models. Scripts do not rebuild them at startup. Only changing search rows and route lines are created as needed.

## Models and rooms

**Building** contains the three floor instances. Their prefabs and **Navigation.asset** are in **Models/WayForge/Prepared**. Select Navigation.asset to edit room names, descriptions, waypoint positions and connections. Geometry and waypoint coordinates must stay aligned.

Read [IMPORTED-MODELS.md](IMPORTED-MODELS.md) for the demo scale and transfer assumptions.

## Test and build

Press Play to test; the app starts at Home. Choose a start and destination, confirm the location and follow the route. Stop Play mode before saving design changes.

To build later, save and choose **Wayforge App → Build Android APK**. The current v0.4 APK was preserved during cleanup.
