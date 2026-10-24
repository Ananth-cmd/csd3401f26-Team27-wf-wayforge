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

import { toNavigatorBuilding, UnsupportedWfbError } from "./services/navigatorBuildingAdapter";

import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const app = express();
// PORT and HOST can be set on the team server, defaults stay the same for local testing.
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";

// Katie's Studio backend, configurable for deployment.
const STUDIO_API_URL =
    process.env.STUDIO_API_URL || "http://127.0.0.1:8080";

// Allow the separately hosted Navigator development site to call this API.
// For any additional origins, set NAVIGATOR_ORIGINS as a comma-separated list.
// Keep this an allowlist rather than allowing all public sites.
const navigatorOrigins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.NAVIGATOR_ORIGINS || "")
        .split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
]);

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && navigatorOrigins.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
        res.sendStatus(origin && !navigatorOrigins.has(origin) ? 403 : 204);
        return;
    }
    next();
});

app.use(express.json());

// Check whether this backend is running.
app.get("/api/health", (_req, res) => {
    res.json({
        ok: true,
        message: "Wayforge backend is running"
    });
});

// List buildings stored locally in backend/storage/buildings.
app.get("/api/buildings", async (_req, res) => {
    try {
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

// Proxy the list of published buildings from Katie's Studio backend.
app.get("/api/published", async (_req, res) => {
    try {
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

        const buildings: unknown = await response.json();

        if (!Array.isArray(buildings)) {
            res.status(502).json({
                ok: false,
                error: "Invalid building list from Studio"
            });
            return;
        }

        res.json(buildings);
    } catch (error) {
        console.error("Studio connection error:", error);
        res.status(502).json({
            ok: false,
            error: "Could not communicate with Studio backend"
        });
    }
});

// Retrieve the actual published .wfb JSON from Katie's backend.
app.get("/api/published/:id/wfb", async (req, res) => {
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

        res.json(building);
    } catch (error) {
        console.error("Failed to retrieve building:", error);
        res.status(502).json({
            ok: false,
            error: "Could not retrieve published building"
        });
    }
});

// Convert the published .wfb into the data structure Shri's Navigator expects.
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
        const published: unknown = await response.json();
        res.json(toNavigatorBuilding(published));
    } catch (error) {
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

        if (stepFree !== "0" && stepFree !== "1") {
            res.status(400).json({
                ok: false,
                error: "stepFree must be 0 or 1"
            });
            return;
        }

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

            const args = ["route", buildingPath, from, to];
            if (stepFree === "1") {
                args.push("--step-free");
            }

            const route = await runWfCli(args);

            // Existing API clients still receive the original wf_cli response.
            if (!req.path.startsWith("/api/navigator/")) {
                res.json(route);
                return;
            }

            // Navigator currently needs nodes, passages, metres and minutes.
            if (!isEngineRoute(route) || !isPublishedWfb(building)) {
                res.status(502).json({
                    ok: false,
                    error: "Invalid route or building data"
                });
                return;
            }

            try {
                const navigatorRoute = toNavigatorRoute(route, building);
                res.json(navigatorRoute);
            } catch (error) {
                console.error("Navigator conversion error:", error);
                res.status(501).json({
                    ok: false,
                    error: "Route conversion not yet supported for this building"
                });
            }
        } catch (error) {
            // Valid request, but the engine could not find a route.
            if (error instanceof WfCliResponseError) {
                res.status(422).json(error.details);
                return;
            }

            console.error("Published route error:", error);
            res.status(502).json({
                ok: false,
                error: "Could not calculate published route"
            });
        } finally {
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
