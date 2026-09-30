# Replacing a building model

The current project uses the three supplied OBJ models. See [IMPORTED-MODELS.md](IMPORTED-MODELS.md) for their configuration.

1. Import new model files into **Assets/WayforgeApp/Models**. For converter output, use the original tool's separate **Wayforge App → Export generated 3D model for Android app** command, then import that Unity package here.
2. Create a prefab for each floor with suitable materials and scale.
3. Replace the floor instances under **Building** in the Main scene.
4. Assign those scene objects to **BuildingMap → Floors**, in level order.
5. Assign matching prefabs in the Building data asset's Floors list, and assign that asset to **AppController → Building**.
6. Update places, waypoint positions and connections to match actual corridors and doorways. Confirm scale and stairs/lifts separately.
7. Save, validate and test the routes in Play mode.

The app uses saved navigation data; it does not infer routes from geometry at runtime. Earlier import helpers remain in **Archive/PreviousPrototype** as development history.
