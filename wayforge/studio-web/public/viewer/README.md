The 3D preview uses the Unity WebGL viewer in `wayforge/viewer` (Ananth).

You normally don't need to put anything in this folder:

1. Open `wayforge/viewer` in Unity 6000.6.0f1 (needs WebGL Build Support).
2. Run **Wayforge > Build WebGL Viewer**. The output lands in `wayforge/viewer/Build/WebGL/`.
3. `npm run dev` serves that folder at `/viewer/`, and `npm run build` copies it into `dist/viewer/`
   (see `vite.config.js`). Upload `dist` as usual and the server has it too.

Only if the viewer was built somewhere else, copy the build output in here by hand instead.
The Studio still works without it, the 3D tab just shows a message.
