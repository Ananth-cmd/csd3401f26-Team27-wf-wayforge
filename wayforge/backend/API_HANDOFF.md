# Step 22 — Navigator handoff and browser integration

**Status (23 Oct 2026):** Backend routes and data conversion pass live single-floor integration; synthetic multi-floor adapter tests pass. This does **not** mean Navigator is connected or real multi-floor navigation has been verified.

## Files
- Replace `backend/src/server.ts` with this package's `server.ts` (keeps existing API endpoints, adds a constrained CORS allowlist for Vite on port 5173).
- Replace `backend/checkIntegration.mjs` with this package's updated check (adds CORS verification).
- Keep the working Step 21 adapters, tests, and other backend code unchanged.

## Fast test
1. Run Studio `npm.cmd run server` from `studio-web/` (port 8080).
2. Restart backend `npx.cmd tsx src/server.ts` from `backend/` (port 3000).
3. Run `npx.cmd tsc --noEmit` and `node checkIntegration.mjs`.
4. In a browser, visit `http://127.0.0.1:3000/api/navigator/backend-integration-test/building`.

## Browser setup
Navigator's Vite dev server normally runs on `http://localhost:5173`. If it runs on another origin, start the backend with `NAVIGATOR_ORIGINS` set to that exact origin (comma-separated for multiple origins). On Windows CMD: `set NAVIGATOR_ORIGINS=http://localhost:5174,http://127.0.0.1:5174`. Restart the backend after changing it. **Do not** use `*` for a deployed public API. For deployment, prefer a reverse proxy serving `/api` under the same origin as Navigator.

## Frontend action for Shri (no frontend files changed here)
Shri needs to replace local `fetch(\`${import.meta.env.BASE_URL}building.json\`)` with a request to the backend's `GET /api/navigator/:id/building`, and update `getRoute()` to request `GET /api/navigator/:id/route?from=...&to=...&stepFree=1|0` rather than call local `findRoute`. The two input points must be node IDs such as `L1:n1`, not room display names. Use the same published building ID for both calls. Show a user-friendly message for non-2xx responses, especially 422 and 501. A deployed frontend cannot call `127.0.0.1:3000` on the **end-user's machine**; it needs an accessible API origin or same-origin reverse proxy.

## Important limitations
- `metres` currently carries the C++ engine's weighted route **cost**, not reliably distance in physical metres; `minutes` is a prototype estimate. Do not label them as precise physical distances/ETAs in the UI.
- Some `levels[].floors` may be empty; a floor slab is not guaranteed to render until geometry is supplied by upstream data/viewer.
- Multi-floor adapters were tested with synthetic data; genuine .wfb inter-floor link structure has not been verified. The engine must be tested with a real multi-floor published building.
- Backend remains bound to `127.0.0.1` and `wfCli.ts` may use a Windows-only executable path; deployment teammate must handle listening interface, reverse proxy, configuration and Linux CLI.

---

# Wayforge M2 Point 4 — Backend API handoff

**Owner:** Point 4 backend integration. No modifications to Studio/Navigator sources required for the backend changes. The frontend owner will have to update its API configuration / `src/api.ts` to consume this server.

## Architecture
- Katie's Studio server: `http://127.0.0.1:8080` (holds draft/published files)
- Independent Point 4 Express server: `http://127.0.0.1:3000` (retrieves published data; runs C++ `wf_cli` to calculate routes)
- Shri's Navigator currently reads `public/building.json` and uses a client-side route planner; backend routes are **not yet displayed in Navigator** until the frontend integrates them.
- Publishing happens on Studio. Navigator must use **published** data and published routes.

## Endpoints on Point 4 backend
| HTTP | Endpoint | Response |
|---|---|---|
| GET | `/api/health` | Health JSON |
| GET | `/api/published` | Array of Studio's published building metadata |
| GET | `/api/published/:id/wfb` | Original published Wayforge `.wfb` JSON |
| GET | `/api/published/:id/route?from=L1:n1&to=L1:n8&stepFree=1` | Raw `wf_cli` route JSON (steps, directions, weighted cost) |
| GET | `/api/navigator/:id/building` | Navigator Building shape (`levels`, `nodes`, `edges`, `links`, `pois`) |
| GET | `/api/navigator/:id/route?from=L1:n1&to=L1:n8&stepFree=1` | Navigator Route shape (`nodes`, `passages`, `metres`, `minutes`) |
| GET | `/api/buildings` | Local prototype's registered .wfb ID list, **not** published list |
| GET | `/api/buildings/:id` | Local prototype's `wf_cli info`, **not** published info |

For the Navigator integration, use **`/api/published`** for discovery, **`/api/navigator/:id/building`** for display data and **`/api/navigator/:id/route`** for directions. Node IDs include floors, e.g. `L1:n1`, `L2:n1`; keep them unchanged in requests. Use `stepFree=1` to require accessibility and `stepFree=0` for unrestricted routing.

Successful route response (example):
```json
{"nodes":["L1:n1","L1:n8"],"passages":["walk"],"metres":7.5,"minutes":1}
```

The `metres` property follows Shri's prototype API name and currently contains **weighted C++ route cost**, which may include penalties; it is **not necessarily physical walking distance**. `minutes` is a simple prototype estimate, not a guaranteed ETA.

## Supported / not yet verified
- **Verified with actual single-floor sample:** Studio upload + publish; retrieving published .wfb; C++ route; step-free flag; unknown destinations; converting graph and route into Navigator's shape.
- **Unit-tested with synthetic 3-floor graph only:** lift and stair transitions in the supplied `wfbLinks.ts` adapters. Their real-world `.wfb` link representation needs to be checked with a generated three-floor building. The adapters reject unknown shapes rather than invent accessible routes.
- **Not verified:** Real 3D floor slabs (`floors` may be empty), actual Navigator frontend calling endpoints, cross-origin configuration, persistent deployment/VM and live indoor geolocation.

## Quick test
1. Run Studio: from `studio-web/`, `npm.cmd run server`.
2. Run Point 4 server: from `backend/`, `npx.cmd tsc --noEmit` then `npx.cmd tsx src/server.ts`.
3. Copy `checkIntegration.mjs` into `backend/` and run `node checkIntegration.mjs`.
4. For multi-floor verification use a published three-floor building with real stairs/lift nodes, and test both `stepFree=0` and `stepFree=1` routes. Confirm the latter contains no `stairs` passage. Inspect raw `.wfb` `links` if adapter reports an unsupported schema.

## Deployment team notes
- Current backend binds `127.0.0.1` and `wfCli.ts` uses a Windows executable path; neither is VM/Linux production-ready without configuration.
- Set the Studio upstream base URL with `STUDIO_API_URL`.
- Agree on how the browser will access port 3000 through the reverse proxy, and enable appropriate cross-origin policy or serve frontend/API on the same origin.
- Use Linux `wf_cli` via an environment-configurable path; add request limits, authentication/authorization and health monitoring before exposing upload/admin endpoints.
