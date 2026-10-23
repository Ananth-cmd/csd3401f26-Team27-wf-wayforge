// Run in backend/: node checkDirections.mjs
// Requires Studio on :8080 and Wayforge backend on :3000.
import assert from "node:assert/strict";

const base = process.env.BACKEND_URL || "http://127.0.0.1:3000";
const id = process.env.BUILDING_ID || "backend-integration-test";
const from = process.env.ROUTE_FROM || "L1:n1";
const to = process.env.ROUTE_TO || "L1:n8";
const q = new URLSearchParams({from, to, stepFree: "1"});

async function request(endpoint) {
    const response = await fetch(`${base}${endpoint}`, {signal: AbortSignal.timeout(15000)});
    const data = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
    return data;
}

try {
    const [engine, navigator] = await Promise.all([
        request(`/api/published/${encodeURIComponent(id)}/route?${q}`),
        request(`/api/navigator/${encodeURIComponent(id)}/route?${q}`)
    ]);

    assert.equal(engine.ok, true);
    assert.ok(Array.isArray(engine.directions), "Engine omitted directions");
    assert.ok(engine.directions.length > 0, "Sample engine route has no readable directions to test");
    assert.deepEqual(navigator.directions, engine.directions, "Navigator directions differ from the engine");
    assert.equal(navigator.nodes.length, navigator.passages.length + 1);

    console.log("PASS: Navigator API preserves the engine's readable directions");
    for (const [i, direction] of navigator.directions.entries()) {
        console.log(`${i + 1}. ${direction.text} (floor ${direction.level})`);
    }
    console.log("Note: Navigator UI needs to render route.directions to show these instructions.");
} catch (error) {
    console.error("FAIL:", error.message);
    process.exitCode = 1;
}
