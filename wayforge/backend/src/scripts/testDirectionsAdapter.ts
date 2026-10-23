import { isEngineRoute, toNavigatorRoute } from "../services/navigatorAdapter";
import type { EngineRoute } from "../types/engineRoute";

const building = {
    levels: [{ id: "L1", edges: [{ a: "n1", b: "n8", stepFree: true }] }],
    links: []
};

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

function check(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
}

check(isEngineRoute(route), "Engine route validation failed");
const converted = toNavigatorRoute(route, building);
check(converted.nodes.join(",") === "L1:n1,L1:n8", "Nodes changed");
check(converted.passages.join(",") === "walk", "Passages changed");
check(converted.metres === 7.5, "Route cost changed");
check(JSON.stringify(converted.directions) === JSON.stringify(route.directions), "Directions not preserved");
check(!isEngineRoute({...route, directions: [{text:7}]}), "Invalid directions were not rejected");

const empty = toNavigatorRoute({...route, directions: []}, building);
check(empty.directions.length === 0, "Invented directions for empty response");
console.log("PASS: Directions preserved, route unchanged, invalid directions rejected");
