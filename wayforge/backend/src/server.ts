
import express from "express";

// Our service for communicating with the C++ engine.
import { runWfCli } from "./services/wfCli";

// Our service for managing saved buildings.
import {
    listSavedBuildings,
    getSavedBuildingPath
} from "./services/buildingStorage";

const app = express();
const PORT = 3000;

app.use(express.json());

// Check whether the backend is running.
app.get("/api/health", (req, res) => {
    res.json({
        ok: true,
        message: "Wayforge backend is running"
    });
});

// List all buildings saved in storage.
app.get("/api/buildings", async (req, res) => {

    try {
        const buildings = await listSavedBuildings();

        res.json({
            buildings: buildings
        });

    } catch (error) {
        console.error("Storage error:", error);

        res.status(500).json({
            ok: false,
            error: "Failed to list buildings"
        });
    }
});

// Retrieve information about a saved building.
app.get("/api/buildings/:id", async (req, res) => {

    let buildingPath: string | null;

    try {
        // Find the saved building using its ID.
        buildingPath = await getSavedBuildingPath(
            req.params.id
        );
    } catch (error) {
        console.error("Storage error:", error);

        res.status(500).json({
            ok: false,
            error: "Failed to access building storage"
        });
        return;
    }

    // Return 404 if the building doesn't exist.
    if (!buildingPath) {
        res.status(404).json({
            ok: false,
            error: "Building not found"
        });
        return;
    }

    try {
        // Ask the C++ engine to read the building.
        const buildingInfo = await runWfCli([
            "info",
            buildingPath
        ]);

        // Return building information to the website.
        res.json(buildingInfo);

    } catch (error) {
        console.error("Wayforge CLI error:", error);

        res.status(502).json({
            ok: false,
            error: "Failed to read building"
        });
    }
});

// Start the backend server.
app.listen(PORT, "127.0.0.1", () => {
    console.log(
        `Wayforge backend running at http://localhost:${PORT}`
    );
});
