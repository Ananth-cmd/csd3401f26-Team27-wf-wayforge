
import path from "path";
import { saveBuildingFile } from "../services/buildingStorage";

// Locate an existing test building from the repository.
const sourcePath = path.resolve(
    __dirname,
    "../../../tools/testdata/expected.wfb"
);

// Register the building in our storage system.
async function main() {
    try {
        const buildingId = await saveBuildingFile(sourcePath);

        console.log("Building registered successfully!");
        console.log("Building ID:", buildingId);
    } catch (error) {
        console.error("Failed to register building:", error);
        process.exitCode = 1;
    }
}

main();
