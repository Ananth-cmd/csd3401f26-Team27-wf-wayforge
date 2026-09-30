# Wayforge navigation prototype

Open this folder (`wayforge/android-prototype`) in Unity Hub with Unity 6000.0.70f1. Open **Assets/WayforgeApp/Scenes/Main.unity** and press Play.

The existing **Builds/Wayforge-SIT-Models-v0.4.apk** was not rebuilt or changed during the project cleanup.

## Project folders

| Folder under Assets/WayforgeApp | Contents |
| --- | --- |
| Scenes | Main app scene |
| Scripts | Seven scripts for app behaviour and navigation |
| UI | Interface prefabs, materials and map texture |
| Models | Three supplied levels and navigation data |
| Resources/Icons | Interface icons |
| Editor | Screen preview, build tools and checks; excluded from the APK |

Earlier interface code and one-time setup scripts are retained in **Archive/PreviousPrototype**, outside Unity's Assets folder. They are development history, not active code.

## Edit the design

Select **AppController**, then click a screen button in the Inspector. Expand **Canvas → Safe area → Screens** and select an element to edit its Text, Image or Rect Transform. Save changes outside Play mode.

Read [DESIGNER-GUIDE.md](Documentation/DESIGNER-GUIDE.md) for common edits and a breakdown of the seven scripts. [IMPORTED-MODELS.md](Documentation/IMPORTED-MODELS.md) explains the supplied models and demo-route assumptions.

## Check or build

**Wayforge App → Validate prototype** checks building data. **Wayforge App → Build Android APK** builds the saved Main scene without recreating its layout. Android Build Support must be installed.

`Tools/Check-Source.ps1` compiles the code and tests route calculation. `Tools/Check-ApkShaders.ps1` checks a built APK for the required UI shaders. Verification history is in [VALIDATION.md](Documentation/VALIDATION.md).

The original converter is unchanged. Room names, floor transfers and scale are illustrative; location and journey progress are confirmed manually.
