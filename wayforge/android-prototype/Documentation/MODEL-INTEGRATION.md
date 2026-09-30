# Model and route authoring

## One-floor import

Export the converter's generated model with the bridge, import the package here, select the prefab and run **Use selected model as building**. This creates `Resources/Building.asset` with one floor, a place for each `Room …` group, and an initial waypoint at each room centre. Room names can be edited in this app asset without changing the tool.

The import uses the generated `Rooms/Room …/Floor` hierarchy. For arbitrary external models without that hierarchy it creates one model place as a starting point; add the remaining places manually. The exporter targets the tool's static MeshFilter/MeshRenderer output, not animated/skinned characters or procedural runtime textures.

## Walkable graph

Select the Building asset and edit its arrays in the Inspector:

1. **Waypoints:** add one at the starting landmark, each corridor junction, each doorway, and each lift/stair landing. Give each a unique ID and a useful label. Floor is zero-based.
2. **Position:** use coordinates relative to the exported floor model's root. X/Z form the plan; Y is just above the walking surface. Keep one Unity unit equal to one metre. For the tool's output, root position/rotation are normalised by the exporter; generated scale is already 1.
3. **Connections:** enter From/To waypoint IDs. Connect only segments verified to remain inside walkable corridors and door gaps. Link the room-centre waypoint via the doorway, not directly to another room centre. Set Bidirectional off for a one-way link, or Blocked for a closure.
4. **Passage:** Corridor, Stairs or Lift. Step-free routing excludes Stairs. Cross-floor edges must connect the appropriate paired landings. Extra Metres is an optional nonnegative equivalent-distance penalty; the demo uses it to represent the lift detour/wait. ETA is an approximate distance-based estimate.
5. **Places:** give each destination a unique ID, name, code, category (`Rooms`, `Facilities`, `Food`), description and a Waypoint ID. Enable Starting Point only for recognisable locations users can confirm.
6. Run **Wayforge App → Validate prototype**; then walk through each route visually in Play mode. Schema checks cannot prove that graph links avoid walls or that a lift is accessible.

## Multiple floors

Export one model for each floor. Import all packages, then add Floor entries to the Building asset and assign each prefab. The importer preserves an existing Building asset rather than overwriting it. Set the waypoint Floor index to match the array. Floors are displayed separately in a common local frame, so each prefab should be aligned and use a local ground height. The demo assumes approximately four metres between storeys for cross-floor distance estimates.

The Floor button cycles through all configured floors. Guidance returns to the active step's floor; after confirming a floor change the next step displays the new floor.

## Returning to the demo

Move or rename the `Building.asset` out of any Resources folder. With no `Resources/Building` asset the app uses the built-in illustrative building. Keep your imported assets; they do not need to be deleted.

## Independence from the tool

The app has no assembly or native-library reference to Wayforge's converter. The bridge uses Unity's public asset APIs on a temporary copy of the generated model. Exporting persists generated meshes/materials, packages the static prefab and dependencies, and destroys only its own temporary copy. Repeat conversion in the existing tool normally; export a new snapshot to update the app.
