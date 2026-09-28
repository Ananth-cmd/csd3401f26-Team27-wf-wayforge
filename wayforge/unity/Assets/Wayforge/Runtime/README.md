# Wayforge Unity (M1 prototype)

| File | Owner | Job |
|---|---|---|
| `Runtime/NativeBridge.cs` | RTIS 2 (Kervin) | the only `DllImport` file; mirrors `core/Engine/wf_api/wf_api.h` |
| `Runtime/WayforgeDocument.cs` | IMGD 2 (Katie) | opens a `.wfb` through the bridge and keeps its walls and rooms |
| `Editor/StudioWindow.cs` | IMGD 2 (Katie) | Wayforge > Studio: Import image (room found automatically, or drag to draw it) or Open .wfb, zoom/pan, click a room, Make 3D |
| `Editor/BlockMaker.cs` | IMGD 2 (Katie) | turns each room into a solid block in the scene |
| `Samples/square_plan.png` | IMGD 2 (Katie) | demo picture: one square room, 20 m wide image |
| `Samples/square.wfb` | IMGD 2 (Katie) | test file: one 10 m x 10 m room, saved with `wf_doc` (IMGD 1) |

`wayforge.dll` goes in `Plugins/x86_64` (built from `core/`, not committed).

M1 note: finding the room in an image is a simple placeholder (box around the dark lines, `FindDarkBox`). The real image reading is T04.
