/*!
 * \file testNavigatorAdapter.ts
 * \brief Tests route conversion against data retrieved from the backend.
 *
 * Fetches the published test building and its C++-calculated route through
 * the backend HTTP endpoints, validates their basic shapes, and converts
 * the route into Navigator's response format. Requires the backend and
 * Studio services to be running and backend-integration-test to be published.
 *
 * Author: Kervin Ong Guan Cheng
 * Links: navigatorAdapter.ts, backend HTTP API, Studio published data.
 * Contribution: Live single-floor adapter integration test.
 * AI declaration: ChatGPT assisted with refining documentation comments.
 * \date 2026-11-07
 */


import {
    isEngineRoute,
    isPublishedWfb,
    toNavigatorRoute
} from "../services/navigatorAdapter";

// Default local address of the independent Wayforge backend.
const BASE_URL = "http://127.0.0.1:3000";

/** Fetch a published sample, validate both responses, and print the adapted route. */
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
    // Confirm that the real route can be converted into Navigator's expected format.
    const navigatorRoute = toNavigatorRoute(
        route,
        building
    );

    // Display the converted route.
    console.log("Navigator route:");
    console.log(JSON.stringify(navigatorRoute, null, 2));
}

// Surface any failed request or conversion as a non-zero process exit code.
main().catch(error => {
    console.error("Adapter test failed:", error);
    process.exitCode = 1;
});
