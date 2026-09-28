# Wayforge Unity

| File | Owner | What it does |
|---|---|---|
| `Runtime/NativeBridge.cs` | Kervin | connects Unity to the C++ core (wayforge.dll) |
| `Runtime/WayforgeDocument.cs` | Katie | holds the walls and rooms of a plan, and opens .wfb files |
| `Editor/StudioWindow.cs` | Katie | the Wayforge > Studio window: import an image or open a .wfb, see it in 2D |
| `Editor/BlockMaker.cs` | Katie | turns every room into a block in the scene |
| `Samples/square_plan.png` | Katie | sample picture of one square room |
| `Samples/square.wfb` | Katie | sample plan with one square room, saved with wf_doc |

Put `wayforge.dll` in `Plugins/x86_64`.
