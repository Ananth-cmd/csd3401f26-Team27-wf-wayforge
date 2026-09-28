# Wayforge Unity

| File | Owner | What it does |
|---|---|---|
| `Runtime/NativeBridge.cs` | Kervin | connects Unity to the C++ core (wayforge.dll) |
| `Runtime/WayforgeDocument.cs` | Katie | asks the core for the walls, doors and rooms of an image or .wfb file |
| `Editor/StudioWindow.cs` | Katie | the Wayforge > Studio window: import an image or open a .wfb, see it in 2D |
| `Editor/RoomBuilder.cs` | Katie | builds the plan in 3D: floor, walls, and a beam over each door |
| `Samples/square_plan.png` | Katie | sample picture: one 10 m square room with a door |
| `Samples/square.wfb` | Katie | sample plan with one square room, saved with wf_doc |

Import image uses the C++ core: wf_image (Ananth) cleans the picture, wf_vector (Kervin) traces the lines,
wf_read (Shrinivasan) finds the walls, doors and rooms.

Put `wayforge.dll` (built from `core/`) in `Plugins/x86_64`.
