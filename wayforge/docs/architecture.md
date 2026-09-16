# Wayforge architecture

Three rules:
1. The C++ core is engine-agnostic (no Unity anything; runs headless on Ubuntu, CI proves it).
2. `building.wfb` is the single source of truth. The tool writes it, the app reads it.
3. The app never writes to it.

```
 Unity Editor (Studio)  /  Android app
            NativeBridge.cs        (only file with DllImport)
   wayforge.dll / libwayforge.so   (wf_api: flat C API, SHARED)
  wf_graph  wf_read  wf_vector  wf_image   (STATIC)
              wf_doc                        (STATIC)
              wf_core                       (STATIC, no third-party deps)
```
Dependencies point downward only. TODO: fill in as each library is implemented.
