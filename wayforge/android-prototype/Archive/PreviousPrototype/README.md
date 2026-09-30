# PATH / Wayforge — Android navigation prototype

A separate Unity 6 application based on the supplied **Wayforge-SIT** Figma screens, with SIT branding. The app consumes the **3D output** of the existing converter. It does not run or alter the C++ conversion tool.

## Edit visually

Open `Assets/WayforgeApp/Designer/Scenes/SIT-Editable.unity` through **Wayforge App → Open editable Canvas app**. Select **App behaviour - connect UI here**, then use its **Edit … screen** buttons. Text, colours, sizes and positions are editable in the Inspector. Builds preserve your scene edits. See [DESIGNER-GUIDE.md](Documentation/DESIGNER-GUIDE.md).

## Open and try

A built Android demo is available at `Builds/Wayforge-SIT-Models-v0.4.apk`. Screens captured from the actual editable app are in `Documentation/Screenshots/Designer`.

1. Activate a Unity Editor license in Unity Hub (a suitable Personal license is sufficient if you qualify).
2. Add **this folder, `wayforge/android-prototype`**, to Unity Hub. Use **6000.0.70f1**, with Android Build Support, SDK/NDK and OpenJDK installed. Do not open the repository root as the app project.
3. Choose **Wayforge App → Open prototype** and press **Play**. Use a portrait Game view, for example 390 × 844.
4. On the landing page choose **Enter your current location**, type a room name or code, select a match and confirm. Choose **Enter your destination**, type and select a match, then tap **Find route**. Compare Shortest / Step-free, start navigation, and confirm landmarks and floor changes until arrival. You can choose the destination first, too.

The app now displays the three supplied OBJ models from Way Forge Models.zip in level order. Demo room names, floor transfers and scale are illustrative. See [IMPORTED-MODELS.md](Documentation/IMPORTED-MODELS.md).

## Showcase your converter's 3D output

1. Open your **existing tool project** (`wayforge/unity`) in its normal Unity version. Use the existing picture import and **Make 3D** workflow unchanged.
2. Choose **Wayforge App → Export generated 3D model for Android app**. The separate bridge finds `Wayforge 3D` (or uses the selected model root). Save the `.unitypackage`.
3. Open **this Android prototype project**, then **Assets → Import Package → Custom Package** and import the exported package.
4. Select the imported `WayforgeBuilding.prefab` in the Project window. Choose **Wayforge App → Use selected model as building**.
5. Assign the resulting Building asset to the app controller, add your imported floor objects to the scene and assign them to BuildingMap's Floors list. Follow the visual steps in [DESIGNER-GUIDE.md](Documentation/DESIGNER-GUIDE.md).

The bridge creates a snapshot with persistent mesh/material assets and strips desktop scripts from the copy. It never edits the source model, converter, or Studio scripts. Export snapshots are placed in `Assets/WayforgeAppExports` in the tool project; the package includes the prefab's dependencies. Do not copy `wayforge.dll` or the entire tool into the Android project.

**Geometry is not a navigation graph.** Converted room shapes alone do not prove where a person can walk. The import command deliberately creates no guessed connections through walls. For an imported model, configure the Building asset as described in [MODEL-INTEGRATION.md](Documentation/MODEL-INTEGRATION.md). Until connected, routes between different rooms show “No available route”.

## What works

- Search by room name, room code or level, with category filters and empty results.
- Live 3D models, floor switching, 2D overhead view, orbit, pan, pinch zoom, zoom buttons and recenter.
- Explicit start selection and confirmation.
- Shortest and step-free routing over configured connections; blocked and one-way links.
- Highlighted routes, user-confirmed progress, floor transitions, lost-location recovery and arrival.
- Saved destinations and preferred route/map view persisted on the device.
- A fitted portrait design board, scrolling results, device safe-area padding and Android Back.

On a phone, drag to orbit in 3D; drag to pan in 2D; pinch to zoom. On desktop, right-drag pans, the wheel zooms, and the visible controls work with either input.

The app adapts the Figma palette, typography sizes, cards, navigation and supplied icon exports to editable Unity Canvas objects and prefabs. The map uses a live 3D viewport. Text uses Unity's bundled runtime font. OS status/navigation bars are not faked inside the UI.

## Build and install Android

Choose **Wayforge App → Build Android APK**. This sets up a portrait, ARM64, IL2CPP development build with package ID `com.wayforge.path.prototype`, minimum Android 8.0 / API 26, and writes:

`Builds/Wayforge-SIT-Models-v0.4.apk`

Install using Android's package installer or `adb install -r Builds/Wayforge-SIT-Models-v0.4.apk`. This is a locally debug-signed development prototype.

## Verification

Run **Wayforge App → Validate prototype** in a licensed editor. For source compilation and routing checks without opening the editor, run:

```powershell
./Tools/Check-Source.ps1
```

That script needs the installed Unity managed libraries and a .NET SDK. It compiles all app and bridge scripts against Unity's actual APIs, then executes the actual route planner with test graph data. See [VALIDATION.md](Documentation/VALIDATION.md) for the checks performed and remaining runtime checks.

## Boundaries

There is no live indoor positioning, camera QR decoding, AR navigation, cloud backend or automatic route-graph extraction. Start and progress are user-confirmed. Route times are estimates. Imported models require accurate metre scale and validated walkable links before use beyond a demo.

All app implementation is under this separate project. The only addition in the existing tool project is `Assets/WayforgeAppBridge/Editor/ExportAppModel.cs`; existing tool source files are unchanged.



