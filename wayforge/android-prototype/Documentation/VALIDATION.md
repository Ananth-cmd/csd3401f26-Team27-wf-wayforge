# Validation record

## Android pink-screen correction (v0.3.1)

The v0.3 Editor walkthrough did not catch an Android shader-packaging defect. Its Graphics Settings had an empty Always Included Shaders list, and inspecting the shipped APK confirmed that `UI/Default` was absent from `assets/bin/Data/Resources/unity_builtin_extra`. Default Canvas materials were not sufficient to retain that shader automatically.

`CanvasShaderBuildGuard` now explicitly retains `UI/Default` and `UI/DefaultETC1`, both during project setup and before any player build. Unity's internal GUI/Text shader must not be added manually: it is a protected engine resource, and adding it causes a DontSave build error. The correction changes build settings only; scene layout and converter code are preserved.

`Tools/Check-ApkShaders.ps1 -Apk <path>` checks the actual packaged shader asset. The original v0.3 APK fails this regression check. Source compilation and 14 route checks pass. No Android device was connected for a physical rendering check.

The corrected `Builds/Wayforge-SIT-Designer-v0.3.1.apk` built successfully (40,747,792 bytes, version 0.3.1 / code 4). Its packaged shader check passes for both required UI shaders. The build log confirms Android shader compilation/serialization. The editable scene's SHA-256 is unchanged from v0.3.

## Editable Canvas v0.3

Checked on 2026-09-30 with Unity 6000.0.70f1. The saved `Designer/Scenes/SIT-Editable.unity` scene contains nine native Canvas screens, persistent Inspector button connections, reusable UI prefabs, saved floor prefabs and editable building data. Runtime behaviour does not reconstruct the layout. Existing converter source has no changes.

Android build succeeded: `Builds/Wayforge-SIT-Designer-v0.3.apk` (40,740,184 bytes). The scene's SHA-256 stayed `35A93033DA180278A03903F2EC9B8C7DF45C5C21B2FAF37F61812017E69D6367` through the build, verifying that building did not recreate or alter it.

All 45 Canvas flow assertions passed in Play mode, including an actual UI raycast onto the starting-location card, persistent button connections, typed location/destination search, explicit confirmation, shortest and step-free routes, recovery cancellation/replanning, all checkpoints to arrival, same-location routing and unmatched search. A manually edited static headline survived screen changes. No runtime errors occurred. The 14 route-planner checks also passed.

Captured and visually inspected Home, Confirm, Route, Guide, Arrival and Settings under `Screenshots/Designer`. Fixed sprite import and progress-fill layout issues found during inspection. Source compilation passed; the standalone compiler reports an expected warning for a field assigned by Unity serialization.

Repeat the Canvas walkthrough using batch-mode entry point `WayforgeApp.Editor.CanvasFlowCheck.Run` (without `-quit`; the test exits Unity itself). The older `PrototypeVisualCheck` targets the legacy UI Toolkit scene only. Phone touch/keyboard behaviour and a real converted building remain device/integration checks.

## SIT v0.2 flow update

Result: all 21 updated flow assertions and all 14 managed routing checks passed. The Android APK built successfully at `Builds/Wayforge-SIT-v0.2.apk`, version 0.2.0 / version code 2, package ID `com.wayforge.path.prototype`.

The landing page now has separate current-location and destination pickers with typed name/code search. Both must be selected before Find route is enabled. The start must be explicitly confirmed; cancelling leaves the previous location intact. Route endpoints can be edited, and lost-location recovery recalculates a route from the newly confirmed start. Map-view switching no longer rebuilds the screen or resets progress. Main navigation actions stay in a fixed bottom area. Android Back follows the screen's Back destination.

The updated Play-mode walkthrough exercises typed destination-first selection, start search by name and code, confirmation cancellation, shortest and step-free routes, map switching, lost-location recovery, floor changes and arrival, save/unsave, already-at-destination, unmatched search, blocked-route handling, destination replacement and editing location from Settings. Native phone keyboard/touch testing remains a separate device check.

Checked on 2026-09-30 against installed Unity 6000.0.70f1.

## Passed

- All app runtime scripts, editor setup/build commands and the independent exporter compiled against the actual Unity 6 managed assemblies with no compilation diagnostics.
- The actual route planner passed 14 executable checks: valid graph, shortest staircase path, computed distance, step-free lift path, longer accessible detour, reverse routes, already at destination, unknown start, blocked lift, stairs remaining available, one-way links, disconnected graph, negative edge costs and duplicate IDs.
- Twelve Figma icons downloaded as local PNG assets. No temporary Figma asset URLs are referenced by the runtime.
- Unity Editor validation passed after license activation, including actual asset imports.
- Play-mode checks exercised the real UI button callbacks for destination → start confirmation → route comparison → step-free guidance → every landmark/floor → arrival. The full journey completed without runtime exceptions. This is a callback-level check, not a physical touch-input test.
- Captured and inspected Explore, destination, confirmation, route alternatives, guidance, arrival, empty search and Settings at 390 × 844. Screenshots are under `Documentation/Screenshots`.
- Android development APK built successfully using Unity's installed SDK/NDK/OpenJDK and IL2CPP, targeting ARM64. Output: `Builds/Wayforge-Prototype.apk` (approximately 40 MB).
- Source diff checks found no modifications to existing files under `wayforge/core` or `wayforge/unity/Assets/Wayforge`.

The command to repeat source/routing verification is `Tools/Check-Source.ps1`.

## Remaining device/integration checks

Physical Android touch/keyboard input, device safe areas and the export/import round-trip of a user-generated building require follow-up on the actual device/model. The repository contained no saved converted building. The model bridge compiled successfully; it has not been run on a supplied building output.

## Runtime acceptance checklist

1. Open prototype and press Play at 390 × 844 and a taller Android aspect ratio. Verify text/icons, safe-area padding, scrolling and live geometry.
2. Search `Board`, `L2-03`, a floor name, and a nonexistent name. Exercise every category and the empty saved list.
3. Open Board Room, choose Main entrance, back out before confirming, then repeat and confirm. The start must change only on confirmation.
4. Compare shortest/stair and step-free/lift routes, including highlighted corridor segments and estimated distances.
5. Follow the complete route, confirm each floor, use lost-location recovery, and reach arrival.
6. Save/unsave a place and change preferences; restart to check persistence.
7. Orbit, pan, pinch, zoom, recenter, switch floors and toggle 2D/3D on a phone.
8. Generate a model with the original tool; export/import it, confirm room geometry/materials, author doorway/corridor links and try a route.
9. Build/install the APK on ARM64 Android, repeat the journey and test Android Back and keyboard search.
