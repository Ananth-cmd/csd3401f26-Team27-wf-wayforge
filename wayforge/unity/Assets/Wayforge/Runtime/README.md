# Wayforge Unity

| File | Owner | What it does |
|---|---|---|
| `Runtime/NativeBridge.cs` | Kervin | connects Unity to the C++ core (wayforge.dll) |
| `Runtime/WayforgeDocument.cs` | Katie | asks the core for the walls, doors and rooms of an image or .wfb file |
| `Runtime/PlanGeometry.cs` | Katie | room maths: area, centre, and cutting a room into triangles |
| `Editor/StudioWindow.cs` | Katie | the Wayforge > Studio window: import an image or open a .wfb, see it in 2D |
| `Editor/RoomBuilder.cs` | Katie | builds the plan in 3D: floor, walls, and a beam over each door |

Import image uses the C++ core: wf_image (Ananth) cleans the picture, wf_vector (Kervin) traces the lines,
wf_read (Katie) finds the walls, doors and rooms.

Put `wayforge.dll` (built from `core/`) in `Plugins/x86_64`. Building `core/` in Visual Studio copies it there for you.
