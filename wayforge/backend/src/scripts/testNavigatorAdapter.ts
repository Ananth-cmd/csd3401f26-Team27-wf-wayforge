
import {
    isEngineRoute,
    isPublishedWfb,
    toNavigatorRoute
} from "../services/navigatorAdapter";

const BASE_URL = "http://127.0.0.1:3000";

async function main() {

    // Get the actual published building from our backend.
    const buildingResponse = await fetch(
        `${BASE_URL}/api/published/backend-integration-test/wfb`
    );

    // Request a real navigation route.
    const routeResponse = await fetch(
        `${BASE_URL}/api/published/backend-integration-test/route?from=L1:n1&to=L1:n8&stepFree=1`
    );

    // Check HTTP responses.
    if (!buildingResponse.ok || !routeResponse.ok) {
        throw new Error("Failed to retrieve building or route");
    }

    // Read the returned JSON data.
    const building: unknown = await buildingResponse.json();
    const route: unknown = await routeResponse.json();

    // Check that the engine returned valid route data.
    if (!isEngineRoute(route)) {
        throw new Error("Invalid engine route");
    }

    // Check the building's navigation graph.
    if (!isPublishedWfb(building)) {
        throw new Error("Invalid published building");
    }

    // Convert the engine route for Navigator.
    const navigatorRoute = toNavigatorRoute(
        route,
        building
    );

    // Display the converted route.
    console.log("Navigator route:");
    console.log(JSON.stringify(navigatorRoute, null, 2));
}

main().catch(error => {
    console.error("Adapter test failed:", error);
    process.exitCode = 1;
});
