// vite.config.js - dev server + build settings for the Studio website
//
// the 3D preview uses Ananth's Unity WebGL viewer. when it's been built
// (Unity: Wayforge > Build WebGL Viewer, output in wayforge/viewer/Build/WebGL)
// this config serves it at /viewer/ while you run `npm run dev`, and copies
// it into dist/viewer/ on `npm run build`, so nobody has to copy it by hand.
// if it isn't built yet the site still works, the 3D tab just says so.
//
// the /api proxy is for later when the backend is up. while VITE_API_URL
// isn't set the site just uses the mock api in src/api/mockApi.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const VIEWER_BUILD = path.resolve(__dirname, "../viewer/Build/WebGL");

// unity's files are gzipped with a fallback, so they're sent as plain bytes
// (no Content-Encoding). the loader unzips them itself
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };

function wayforgeViewer() {
  return {
    name: "wayforge-viewer",
    configureServer(server) {
      server.middlewares.use("/viewer", (req, res, next) => {
        if (!fs.existsSync(VIEWER_BUILD)) return next(); // not built, fall back to public/viewer
        const rel = decodeURIComponent((req.url || "/").split("?")[0]);
        const file = path.join(VIEWER_BUILD, rel === "/" ? "index.html" : rel);
        if (!file.startsWith(VIEWER_BUILD) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        const ext = path.extname(file.replace(/\.(gz|br|unityweb)$/, ""));
        res.setHeader("Content-Type", TYPES[ext] || "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(VIEWER_BUILD)) {
        console.log("  (3D viewer not built yet, skipping dist/viewer)");
        return;
      }
      fs.cpSync(VIEWER_BUILD, path.resolve(__dirname, "dist/viewer"), { recursive: true });
      console.log("  copied the 3D viewer into dist/viewer");
    },
  };
}

export default defineConfig({
  plugins: [react(), wayforgeViewer()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
