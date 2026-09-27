# Runtime (shared by the Editor tool and the app)

| File | Owner | Job |
|---|---|---|
| `NativeBridge.cs` | RTIS 2 | the only `DllImport` file; one declaration per function in `core/Engine/wf_api/wf_api.h` |
| `IWayforgeDocument.cs` | IMGD 2 | the interface Studio's UI talks to |
| `WayforgeDocument.cs` | IMGD 2 | the real document: reads the C++ core (wf_doc) through NativeBridge |
| `WfTypes.cs` | IMGD 2 | plain C# structs for walls, rooms, openings, nodes, edges |
| `PolygonUtil.cs` | IMGD 2 | ear-clipping triangulation for room fills (2D canvas and 3D floors) |

The Editor's `DocumentProvider` hands out `WayforgeDocument` when `wayforge.dll` loads and the fake
`StubWayforgeDocument` when it doesn't. The navigation app scripts come in the App phase and will
live here too. They read `StreamingAssets/*.wfb` and never write it.
