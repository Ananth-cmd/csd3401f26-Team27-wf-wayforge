# Runtime (app side)

`NativeBridge.cs` and `WayforgeDocument.cs` are shared by the Editor tool and the Android app.
The navigation app scripts (BuildingLoader, RouteRenderer, StepPrompter, PoiSearch) come in the
App phase (weeks 11-13) and will live here. They read `StreamingAssets/*.wfb` and never write it.
