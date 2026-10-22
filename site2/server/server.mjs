/**
 * \file server.mjs
 * \brief Site 2 backend - placeholder Node server behind nginx
 *
 * nginx (deploy/nginx-site2.conf) serves the frontend from /var/www/site2/current and
 * forwards every /api/... request here. Only listens on 127.0.0.1, so it is not reachable
 * from the internet directly.
 *
 * Endpoints:
 *   GET /api/health  -> {"status":"ok", ...}   used to check browser -> nginx -> backend works
 *
 * Settings (environment variables, set in deploy/site2-backend.service):
 *   HOST        address to listen on            (default 127.0.0.1)
 *   PORT        port to listen on               (default 8081)
 *   SITE2_DATA  folder for saved data           (default ./data)
 *
 * No npm packages: only Node's built-in modules, so there is nothing to install.
 *
 * \author Joel Chua (c.jialiang@digipen.edu)
 *
 * Contribution: Joel Chua 100%
 *   - Placeholder backend with a health check, ready for site 2's real API
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
 *
 * \date 2026-10-21
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8081);
const DATA = path.resolve(process.env.SITE2_DATA || "./data");

// Make sure the data folder exists before any feature tries to save into it.
fs.mkdirSync(DATA, { recursive: true });

const startedAt = new Date().toISOString();

// Send a JSON reply with the given HTTP status code.
function sendJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, { status: "ok", service: "site2-backend", startedAt });
    }

    // Add site 2's real endpoints above this line.
    sendJson(res, 404, { error: "not found", path: url.pathname });
});

server.listen(PORT, HOST, () => {
    console.log(`site2-backend listening on http://${HOST}:${PORT} (data: ${DATA})`);
});
