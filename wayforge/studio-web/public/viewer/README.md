Put the Unity WebGL build of the 3D viewer here.

1. Open `wayforge/viewer` in Unity 6000.6.0f1 (needs WebGL Build Support).
2. Build it (see docs/viewer.md). The output lands in `wayforge/viewer/Build/WebGL/`.
3. Copy everything inside that folder into this folder, so you end up with
   `public/viewer/index.html`, `public/viewer/wayforge-viewer.js`, `public/viewer/Build/...`

The Studio site still works without it, the 3D tab just shows a message.
