/*!
 * \file testDirectionsAdapter.ts
 * \brief Checks that Navigator route conversion preserves engine directions.
 *
 * Uses a small in-memory building and an example engine route to verify that
 * nodes, passages, weighted cost, and human-readable instructions survive
 * conversion. It also checks that malformed directions are rejected and
 * that an empty instruction list stays empty. No servers are required.
 *
 * Author: Kervin Ong Guan Cheng
 * Links: navigatorAdapter.ts and engineRoute.ts.
 * Contribution: Route-direction adapter regression tests.
 * AI declaration: ChatGPT assisted with refining documentation comments.
 * \date 2026-11-07
 */

import { isEngineRoute, toNavigatorRoute } from "../services/navigatorAdapter";
import type { EngineRoute } from "../types/engineRoute";

// Minimal same-floor graph with one usable walking edge.
const building = {
    levels: [{ id: "L1", edges: [{ a: "n1", b: "n8", stepFree: true }] }],
    links: []
};

// Example response shaped like the JSON returned by wf_cli route.
const route: EngineRoute = {
    ok: true,
    from: "L1:n1",
    to: "L1:n8",
    totalCost: 7.5,
    stepFree: true,
    steps: [
        { level: "L1", node: "n1", kind: "room", x: 2.5, y: 9.5, z: 0 },
        { level: "L1", node: "n8", kind: "door", x: 0, y: 2.45, z: 0 }
    ],
    directions: [
        { text: "Leave the room through the door", level: "L1", x: 0, y: 2.45, distance: 7.48 },
        { text: "Arrive at the corridor", level: "L1", x: 0, y: 2.45, distance: 0 }
    ]
};

/** Fail the test immediately when a required condition is false. */
function check(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
}

// Verify the engine response shape before passing it to the converter.
check(isEngineRoute(route), "Engine route validation failed");
const converted = toNavigatorRoute(route, building);
// The adapter must retain the node order, connection type, and route cost.
check(converted.nodes.join(",") === "L1:n1,L1:n8", "Nodes changed");
check(converted.passages.join(",") === "walk", "Passages changed");
check(converted.metres === 7.5, "Route cost changed");
// Instructions should be forwarded without changing their text or positions.
check(JSON.stringify(converted.directions) === JSON.stringify(route.directions), "Directions not preserved");
// Reject a malformed instruction instead of treating it as valid output.
check(!isEngineRoute({...route, directions: [{text:7}]}), "Invalid directions were not rejected");

// An empty directions array must remain empty; do not invent guidance.
const empty = toNavigatorRoute({...route, directions: []}, building);
check(empty.directions.length === 0, "Invented directions for empty response");
console.log("PASS: Directions preserved, route unchanged, invalid directions rejected");
