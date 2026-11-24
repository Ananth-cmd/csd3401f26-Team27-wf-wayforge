/**
 * \file engineRoute.ts
 * \brief Type definitions for routes returned by the Wayforge C++ engine.
 *
 * Defines the JSON structure that the backend expects from the wf_cli route
 * command, including route steps, readable directions, and engine errors.
 * These types help TypeScript check how the backend accesses route data.
 * They do not validate JSON at runtime or calculate navigation paths.
 *
 * Author: Kervin Ong Guan Cheng
 * Links: Used by the Navigator route adapter to interpret the engine's output
 * before converting it into the format expected by the Navigator website.
 *
 * Contribution: Backend route response type definitions and documentation.
 * AI declaration: ChatGPT assisted with refining explanatory comments.
 */

// Describes one navigation point along the route calculated by the C++ engine.
export type EngineRouteStep = {
    level: string; // Floor ID, such as "L1".
    node: string;  // Navigation node ID within that floor, such as "n1".
    kind: string;  // Node type returned by the engine (room, door, etc.).
    x: number;     // Horizontal position on the floor plan.
    y: number;     // Vertical position on the floor plan.
    z: number;     // Height/elevation coordinate for this route point.
};

// Describes one human-readable navigation instruction from the C++ engine.
export type EngineDirection = {
    text: string;     // Instruction shown to the user, such as leaving a room.
    level: string;    // Floor on which the instruction applies.
    x: number;        // X position associated with this instruction.
    y: number;        // Y position associated with this instruction.
    distance: number; // Distance value supplied by the engine for this instruction.
};

// Describes a successful result from the wf_cli route command.
export type EngineRoute = {
    ok: true;                     // True when the engine successfully calculates a route.
    from: string;                 // Starting node reference, such as "L1:n1".
    to: string;                   // Destination node reference, such as "L1:n8".
    totalCost: number;            // Weighted route cost; not necessarily metres.
    stepFree: boolean;            // Whether the returned route avoids steps, as reported by the engine.
    steps: EngineRouteStep[];     // Ordered points making up the route.
    directions: EngineDirection[];// Readable instructions along the route.
};

// Describes an engine response when a route cannot be calculated.
export type EngineRouteError = {
    ok: false;     // False indicates that the engine reported a route error.
    error: string; // Explanation, e.g. an unknown destination node.
};
