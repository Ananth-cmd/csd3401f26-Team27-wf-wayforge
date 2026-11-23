/*!
\file server.ts

\brief Wayforge backend API for Studio and Navigator
Runs the Express server that connects Studio's published building data to
Wayforge's C++ routing engine and the Navigator website. It lets other parts
of the project request building information and calculate navigation routes
without directly running the C++ command-line program themselves.

The server gets published .wfb files from Studio, passes them to wf_cli for
routing, and converts the resulting building and route JSON into formats
that Navigator can use. Route requests can optionally use the --step-free
flag, while the engine is responsible for calculating the actual path.

The backend also checks request parameters, handles errors from Studio and
wf_cli, allows configured browser origins, and removes temporary route files
after each request. More detailed data conversion is handled by the service
files rather than directly in this server.

Links: Uses services/wfCli.ts to run the C++ engine,
services/buildingStorage.ts for local building files,
services/navigatorAdapter.ts for route conversion, and
services/navigatorBuildingAdapter.ts for building conversion.
Connects Studio's published-building endpoints to Navigator's API endpoints.

\author Kervin Ong Guan Cheng

Contribution: Backend API routing and integration between Studio,
Wayforge's C++ engine, and Navigator; published building retrieval;
request validation, error handling, route conversion and API responses.

AI declaration: ChatGPT was used to help refine the comments.

\date 2026-11-07
*/

// Express handles HTTP requests from Studio-related tools and Navigator.
import express from "express";

// Communicate with the C++ Wayforge CLI.
import {
    runWfCli,
    WfCliResponseError
} from "./services/wfCli";

// Manage buildings stored locally by this backend.
import {
    listSavedBuildings,
    getSavedBuildingPath
} from "./services/buildingStorage";

// Convert engine routes into Navigator's route format (real multi-floor links still need verification).
import {
    isEngineRoute,
    isPublishedWfb,
    toNavigatorRoute
} from "./services/navigatorAdapter";

// The building adapter maps a published .wfb into Navigator's geometry and graph layout.
// UnsupportedWfbError identifies a building format the adapter cannot safely convert.
import { toNavigatorBuilding, UnsupportedWfbError } from "./services/navigatorBuildingAdapter";

// Temporary file utilities: wf_cli reads .wfb files from disk rather than HTTP JSON.
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

// Create the HTTP server and choose local defaults unless deployment values are provided.
const app = express();
// PORT and HOST can be set on the team server, defaults stay the same for local testing.
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// Studio backend.
const STUDIO_API_URL =
    process.env.STUDIO_API_URL || "http://127.0.0.1:8080";

// Allow the separately hosted Navigator development site to call this API.
// For any additional origins, set NAVIGATOR_ORIGINS as a comma-separated list.
// Keep this an allowlist rather than allowing all public sites.
// Build the list of website origins permitted to read this API from a browser.
// A Set avoids duplicate origin entries.
const navigatorOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.NAVIGATOR_ORIGINS || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
]);

// CORS middleware: attach browser access headers only for approved origins.
// OPTIONS requests are preflight checks sent by browsers before some API calls.
app.use((req, res, next) => {
    // The Origin header identifies the website making the browser request.
    const origin = req.headers.origin;
    if (origin && navigatorOrigins.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    // End preflight requests here rather than passing them to an API handler.
    if (req.method === "OPTIONS") {
        res.sendStatus(origin && !navigatorOrigins.has(origin) ? 403 : 204);
        return;
    }
    next();
});

// Parse incoming application/json request bodies for any routes that need them.
app.use(express.json());

// Check whether this backend is running.
// This endpoint is a quick way to confirm port, host and server availability.
app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        message: "Wayforge backend is running"
    });
});

// List buildings stored locally in backend/storage/buildings.
app.get("/api/buildings", async (_req, res) => {
    try {
        // Local storage is separate from Studio's published-building catalogue.
        const buildings = await listSavedBuildings();
        res.json({ buildings });
    } catch (error) {
        console.error("Storage error:", error);
        res.status(500).json({
            ok: false,
            error: "Failed to list buildings"
        });
    }
});

// Read summary data for a locally saved building using wf_cli info.
app.get("/api/buildings/:id", async (req, res) => {
    let buildingPath: string | null;

    try {
        // Resolve the ID to an existing .wfb path without trusting arbitrary file paths.
        buildingPath = await getSavedBuildingPath(req.params.id);
    } catch (error) {
        console.error("Storage error:", error);
        res.status(500).json({
            ok: false,
            error: "Failed to access building storage"
        });
        return;
    }

    if (!buildingPath) {
        res.status(404).json({
            ok: false,
            error: "Building not found"
        });
        return;
    }

    try {
        // "info" tells the C++ CLI to describe this saved building as JSON.
        const buildingInfo = await runWfCli(["info", buildingPath]);
        res.json(buildingInfo);
    } catch (error) {
        console.error("Wayforge CLI error:", error);
        res.status(502).json({
            ok: false,
            error: "Failed to read building"
        });
    }
});

// Proxy the list of published buildings from Studio backend.
app.get("/api/published", async (_req, res) => {
    try {
        // Ask Studio for its published-building list; give up after ten seconds.
        const response = await fetch(`${STUDIO_API_URL}/api/published`, {
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            res.status(502).json({
                ok: false,
                error: "Studio backend returned an error"
            });
            return;
        }

        // Network JSON is untrusted until we check its expected top-level shape.
        const buildings: unknown = await response.json();

        if (!Array.isArray(buildings)) {
            res.status(502).json({
                ok: false,
                error: "Invalid building list from Studio"
            });
            return;
        }

        // Forward the published list so Navigator can discover available buildings.
        res.json(buildings);
    } catch (error) {
        console.error("Studio connection error:", error);
        res.status(502).json({
            ok: false,
            error: "Could not communicate with Studio backend"
        });
    }
});

// Retrieve the actual published .wfb JSON from backend.
app.get("/api/published/:id/wfb", async (req, res) => {
    // The ID is used in a Studio URL, so restrict it to expected characters.
    const buildingId = req.params.id;

    if (!/^[a-z0-9-]+$/.test(buildingId)) {
        res.status(400).json({
            ok: false,
            error: "Invalid building ID"
        });
        return;
    }

    try {
        const response = await fetch(
            `${STUDIO_API_URL}/api/published/${buildingId}/wfb`,
            { signal: AbortSignal.timeout(10000) }
        );

        if (response.status === 404) {
            res.status(404).json({
                ok: false,
                error: "Published building not found"
            });
            return;
        }

        if (!response.ok) {
            res.status(502).json({
                ok: false,
                error: "Studio failed to return the building"
            });
            return;
        }

        // Studio returns a whole .wfb document, not Navigator's converted format.
        const building: unknown = await response.json();

        if (
            typeof building !== "object" ||
            building === null ||
            !("building" in building) ||
            !("levels" in building) ||
            !Array.isArray(building.levels)
        ) {
            res.status(502).json({
                ok: false,
                error: "Invalid building data from Studio"
            });
            return;
        }

        // Preserve the original .wfb for callers that need the engine's native data.
        res.json(building);
    } catch (error) {
        console.error("Failed to retrieve building:", error);
        res.status(502).json({
            ok: false,
            error: "Could not retrieve published building"
        });
    }
});

// Convert the published .wfb into the data structure Navigator expects.
// Navigator requests this endpoint instead of reading a local building.json.
app.get("/api/navigator/:id/building", async (req, res) => {
    const buildingId = typeof req.params.id === "string" ? req.params.id : "";
    if (!/^[a-z0-9-]+$/.test(buildingId)) {
        res.status(400).json({ ok: false, error: "Invalid building ID" });
        return;
    }

    try {
        const response = await fetch(
            `${STUDIO_API_URL}/api/published/${buildingId}/wfb`,
            { signal: AbortSignal.timeout(10000) }
        );
        if (response.status === 404) {
            res.status(404).json({ ok: false, error: "Published building not found" });
            return;
        }
        if (!response.ok) {
            res.status(502).json({ ok: false, error: "Studio could not return the published building" });
            return;
        }
        // The adapter handles levels, walls, nodes, edges, rooms and inter-floor links.
        // It can reject unsupported .wfb structures instead of guessing the geometry.
        const published: unknown = await response.json();
        res.json(toNavigatorBuilding(published));
    } catch (error) {
        // 501 means the published building uses a conversion not supported yet.
        if (error instanceof UnsupportedWfbError) {
            res.status(501).json({ ok: false, error: error.message });
            return;
        }
        console.error("Navigator building conversion error:", error);
        res.status(502).json({ ok: false, error: "Unable to convert published building" });
    }
});

// Calculate a route against the published building.
// /api/published/:id/route returns the original engine format.
// /api/navigator/:id/route returns the current Navigator Route format.
app.get(
    [
        "/api/published/:id/route",
        "/api/navigator/:id/route"
    ],
    async (req, res) => {
        // A route parameter may be typed as a string or string array.
        // Only a single string is a valid building ID.
        const buildingId = typeof req.params.id === "string" ? req.params.id : "";
        // Start and destination identify navigation nodes, e.g. L1:n1 and L1:n8.
        const { from, to } = req.query;
        const stepFree = req.query.stepFree ?? "0";

        if (!/^[a-z0-9-]+$/.test(buildingId)) {
            res.status(400).json({
                ok: false,
                error: "Invalid building ID"
            });
            return;
        }

        if (
            typeof from !== "string" || !from.trim() ||
            typeof to !== "string" || !to.trim()
        ) {
            res.status(400).json({
                ok: false,
                error: "Starting point and destination are required"
            });
            return;
        }

        // Only these two query values are accepted; other values are invalid input.
        if (stepFree !== "0" && stepFree !== "1") {
            res.status(400).json({
                ok: false,
                error: "stepFree must be 0 or 1"
            });
            return;
        }

        // Keep a reference so the temporary directory can be deleted in finally.
        let temporaryDir: string | null = null;

        try {
            // Always use the published file: Navigator must route on what it shows.
            const response = await fetch(
                `${STUDIO_API_URL}/api/published/${buildingId}/wfb`,
                { signal: AbortSignal.timeout(10000) }
            );

            if (response.status === 404) {
                res.status(404).json({
                    ok: false,
                    error: "Published building not found"
                });
                return;
            }

            if (!response.ok) {
                throw new Error("Studio could not provide the building");
            }

            const building: unknown = await response.json();

            if (
                typeof building !== "object" ||
                building === null ||
                !("building" in building) ||
                !("levels" in building) ||
                !Array.isArray(building.levels)
            ) {
                throw new Error("Invalid published building data");
            }

            // wf_cli accepts a file path, so create a temporary .wfb.
            temporaryDir = await mkdtemp(path.join(tmpdir(), "wayforge-route-"));
            const buildingPath = path.join(temporaryDir, "published.wfb");
            await writeFile(buildingPath, JSON.stringify(building), "utf8");

            // CLI command: wf_cli route <file> <start> <destination> [--step-free].
            const args = ["route", buildingPath, from, to];
            if (stepFree === "1") {
                // Pass the accessibility requirement to the engine; it selects the route.
                args.push("--step-free");
            }

            // The service starts wf_cli, parses its JSON and reports engine failures.
            const route = await runWfCli(args);

            // Existing API clients still receive the original wf_cli response.
            // Shared handler, different response format depending on the URL.
            if (!req.path.startsWith("/api/navigator/")) {
                res.json(route);
                return;
            }

            // Navigator currently needs nodes, passages, metres and minutes.
            // Validate the basic data needed by the adapter before accessing fields.
            if (!isEngineRoute(route) || !isPublishedWfb(building)) {
                res.status(502).json({
                    ok: false,
                    error: "Invalid route or building data"
                });
                return;
            }

            try {
                // Convert path nodes and passages, and preserve directions if provided.
                // Route cost should not be assumed to equal physical metres.
                const navigatorRoute = toNavigatorRoute(route, building);
                res.json(navigatorRoute);
            } catch (error) {
                console.error("Navigator conversion error:", error);
                // An unsupported conversion is different from a failed CLI command.
                res.status(501).json({
                    ok: false,
                    error: "Route conversion not yet supported for this building"
                });
            }
        } catch (error) {
            // Valid request, but the engine could not find a route.
            if (error instanceof WfCliResponseError) {
                // 422: the engine understood the request but could not produce that route.
                res.status(422).json(error.details);
                return;
            }

            console.error("Published route error:", error);
            res.status(502).json({
                ok: false,
                error: "Could not calculate published route"
            });
        } finally {
            // Cleanup must happen whether routing succeeded, failed or returned early.
            if (temporaryDir) {
                await rm(temporaryDir, {
                    recursive: true,
                    force: true
                }).catch(console.error);
            }
        }
    }
);

// Start the backend server.
app.listen(PORT, HOST, () => {
    console.log(`Wayforge backend running at http://${HOST}:${PORT}`);
});
