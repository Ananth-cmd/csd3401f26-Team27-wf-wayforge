/*!
 * \file registerSample.ts
 * \brief Registers a sample Wayforge building in the backend's local storage.
 *
 * Reads the existing expected.wfb test fixture from the repository and passes
 * it to buildingStorage, which saves a copy under a generated building ID.
 * This script is for local testing; it does not publish a building through Studio.
 *
 * Author: Kervin Ong Guan Cheng
 * Links: buildingStorage.ts and tools/testdata/expected.wfb.
 * Contribution: Sample-building registration for backend tests.
 * AI declaration: ChatGPT assisted with refining documentation comments.
 * \date 2026-11-07
 */


import path from "path";
import { saveBuildingFile } from "../services/buildingStorage";

// Locate an existing test building from the repository.
// Build an absolute path so this script works regardless of the terminal folder.
const sourcePath = path.resolve(
    __dirname,
    "../../../tools/testdata/expected.wfb"
);

// Register the building in our storage system.
/** Copy the sample .wfb to backend storage and print its new ID. */
async function main() {
    try {
        // The storage service chooses the ID and avoids overwriting an existing file.
        const buildingId = await saveBuildingFile(sourcePath);

        console.log("Building registered successfully!");
        console.log("Building ID:", buildingId);
    // Report a failed file operation and mark the process as unsuccessful.
    } catch (error) {
        console.error("Failed to register building:", error);
        process.exitCode = 1;
    }
}

main();
