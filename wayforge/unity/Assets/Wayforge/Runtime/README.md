# Wayforge Unity

| File | Owner | What it does |
|---|---|---|
| `Runtime/NativeBridge.cs` | Kervin | connects Unity to the C++ core (wayforge.dll) |
| `Runtime/WayforgeDocument.cs` | Katie | holds the walls, doors and rooms of a plan, and opens .wfb files |
| `Editor/StudioWindow.cs` | Katie | the Wayforge > Studio window: import an image (finds the room and its door) or open a .wfb, see it in 2D |
| `Editor/RoomBuilder.cs` | Katie | builds the plan in 3D: floor, walls, and a beam over each door |
| `Samples/square_plan.png` | Katie | sample picture of one square room |
| `Samples/square.wfb` | Katie | sample plan with one square room, saved with wf_doc |

Put `wayforge.dll` in `Plugins/x86_64`.
