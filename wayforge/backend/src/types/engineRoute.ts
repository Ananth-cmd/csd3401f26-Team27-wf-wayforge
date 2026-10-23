
export type EngineRouteStep = {
    level: string;
    node: string;
    kind: string;
    x: number;
    y: number;
    z: number;
};

export type EngineDirection = {
    text: string;
    level: string;
    x: number;
    y: number;
    distance: number;
};

export type EngineRoute = {
    ok: true;
    from: string;
    to: string;
    totalCost: number;
    stepFree: boolean;
    steps: EngineRouteStep[];
    directions: EngineDirection[];
};

export type EngineRouteError = {
    ok: false;
    error: string;
};
