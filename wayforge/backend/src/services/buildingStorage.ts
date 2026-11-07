/*!
 * \file buildingStorage.ts
 * \brief Manages locally saved Wayforge .wfb building files.
 *
 * Creates the local storage folder, lists saved building IDs, resolves an ID
 * to a validated file path, and copies sample files into storage with unique IDs.
 * This storage is separate from the published buildings hosted by Studio.
 *
 * Links: server.ts; scripts/registerSample.ts
 *
 * \author Kervin Ong Guan Cheng
 * Contribution: Wayforge backend support and integration
 * AI declaration: ChatGPT assisted with refining documentation comments.
 * \date 2026-11-07
 */

import { randomUUID } from "crypto";
import { constants } from "fs";
import { copyFile, mkdir, readdir, stat } from "fs/promises";
import path from "path";

// Folder where our backend stores building files.
// Resolve storage relative to this source folder, not the current terminal folder.
const storageDir = path.resolve(
    __dirname,
    "../../storage/buildings"
);

// Get the IDs of all saved buildings.
/**
 * List local .wfb filenames without their extensions.
 * The directory is created the first time it is accessed.
 */
export async function listSavedBuildings(): Promise<string[]> {

    // Make sure the storage folder exists.
    await mkdir(storageDir, { recursive: true });

    // Read the files inside the folder.
    const files = await readdir(storageDir, {
        withFileTypes: true
    });

    // Only include .wfb building files.
    return files
        .filter(file =>
            file.isFile() && file.name.endsWith(".wfb")
        )
        .map(file => path.parse(file.name).name);
}

// Find a saved building using its ID.
/**
 * Find a local building using a safe ID.
 * Returns null if the ID is invalid or the file is missing; unexpected I/O
 * errors are propagated to the API for handling.
 */
export async function getSavedBuildingPath(
    id: string
): Promise<string | null> {

    // Reject IDs containing unexpected characters.
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return null;
    }

    const buildingPath = path.join(
        storageDir,
        `${id}.wfb`
    );

    try {
        const fileInfo = await stat(buildingPath);

        return fileInfo.isFile() ? buildingPath : null;
    } catch (error) {
        // Return null when the file does not exist.
        if (
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            return null;
        }

        throw error;
    }
}

// Save a building file and generate a unique ID.
/**
 * Register an existing .wfb in local storage under a random UUID.
 * COPYFILE_EXCL prevents accidentally overwriting an existing building.
 */
export async function saveBuildingFile(
    sourcePath: string
): Promise<string> {

    await mkdir(storageDir, { recursive: true });

    // Generate a unique building ID.
    const id = randomUUID();

    const destination = path.join(
        storageDir,
        `${id}.wfb`
    );

    // Copy the building into storage without overwriting.
    await copyFile(
        sourcePath,
        destination,
        constants.COPYFILE_EXCL
    );

    // Return the ID so websites can reference the building.
    return id;
}
