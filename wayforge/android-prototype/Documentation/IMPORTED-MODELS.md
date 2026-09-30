# Your three supplied levels

The app now uses `Level 1.obj`, `Level 2.obj` and `Level 3.obj` from **Way Forge Models.zip**, mapped to Level 1, Level 2 and Level 3 respectively. Original OBJ and MTL files are retained byte-for-byte under `Assets/WayforgeApp/Models/WayForge`.

Open the existing **Main.unity** scene. Under **Building**, each level is now an instance of the corresponding prefab in **Models/WayForge/Prepared**. Each contains its imported model, so you can select and edit its appearance in Unity. The former sample floor prefabs are retained in Archive/PreviousPrototype.

The supplied materials were black. The prepared prefabs use lighter walls and contrasting green floors so the layout and navigation lines are visible. The original MTL files are unchanged. Model geometry has not been remodelled.

## Demo navigation

As requested, room names and navigation locations are illustrative. Each level has **Demo room A**, **Demo room B** and **Demo room C**, searchable by name or the codes **L1-01 … L3-03**. Demo stairs and demo lift transfers connect the levels. Those transfer positions do not claim to identify actual stairs or lifts in the building.

The paths were fitted to open space between the supplied walls, including door gaps, rather than reusing the old building's paths. Intermediate checkpoints and links are saved in **Prepared/Navigation.asset** and remain editable in its Inspector. The route planner uses this saved data at runtime; it does not regenerate paths or the scene.

The exports declare centimetres but their walls are approximately 57 coordinate units high. For a useful prototype, import scale **0.05** gives walls approximately 2.9 Unity metres tall and floor extents approximately 31 × 37 metres. This is an assumed demo scale, not a measured building dimension. Distances and times are illustrative until you confirm actual dimensions and floor-transfer locations.

## Editing and restoring

- Change room labels, descriptions, waypoint positions and connections in **Prepared/Navigation.asset**.
- Change floor/wall colours in the materials alongside the prepared prefabs.
- Keep floor geometry and waypoint coordinates aligned when resizing or moving models.
- Use the normal screen editing workflow in [DESIGNER-GUIDE.md](DESIGNER-GUIDE.md).
- A copy of the previous scene is retained at **Documentation/Backups/SIT-before-imported-models.unity**. The previous sample data and prefabs are retained in Archive/PreviousPrototype.

The original 2D-to-3D converter code is unchanged. The new Android build is **Builds/Wayforge-SIT-Models-v0.4.apk**.

