/*!
 * \file server.mjs
 * \brief small backend for the Studio website. it runs wf_cli for real so an
 *        uploaded blueprint actually turns into a 2D/3D building
 *
 * it does what API.md says, nothing more:
 *   POST /api/buildings            pictures -> wf_cli build -> .wfb
 *   PUT  /api/buildings/:id/wfb    save edits -> wf_cli graph (rebuild walking paths)
 *   GET  /api/buildings/:id/route  wf_cli route
 *   POST /api/buildings/:id/publish  copy the draft to the published version
 *   GET  /api/published...         what the Navigator reads
 *
 * no npm packages, just node. buildings are folders in server/data/<id>/:
 *   meta.json  draft.wfb  published.wfb  src/L1.png ...
 *
 * run it:   npm run server        (port 8080, or PORT=xxxx)
 * wf_cli is found from WF_CLI, or by looking in wayforge/build for wf_cli / wf_cli.exe
 *
 * this is the Studio's own simple backend so the site works end to end.
 * if the team's real backend (item 4) ends up different, the site only
 * talks to it through src/api/realApi.js
 *
 * \author Katie Lim
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { summary, validate } from "../src/lib/wfb.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.WF_DATA || path.join(HERE, "data");
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "127.0.0.1"; // only nginx / vite talk to it
const MAX_UPLOAD = 60 * 1024 * 1024; // 60 MB, big scans add up

fs.mkdirSync(DATA, { recursive: true });

// ---------- finding and running wf_cli ----------

function findCli() {
  if (process.env.WF_CLI && fs.existsSync(process.env.WF_CLI)) return process.env.WF_CLI;
  const exe = process.platform === "win32" ? "wf_cli.exe" : "wf_cli";
  const root = path.resolve(HERE, "../../build");
  // the usual places the CMake presets put it
  for (const preset of ["desktop-release", "desktop", "vs2022/Release", "vs2022/Debug"]) {
    for (const sub of ["Sandbox/wf_cli", "Sandbox/wf_cli/Release", "Sandbox/wf_cli/Debug"]) {
      const p = path.join(root, preset, sub, exe);
      if (fs.existsSync(p)) return p;
    }
  }
  // otherwise look through wayforge/build. some folders can't be read, skip those instead of crashing
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === exe) found.push(p);
    }
  };
  walk(root, 0);
  return found[0] || null;
}

const CLI = findCli();

function runCli(args, timeout = 180000) {
  return new Promise((resolve, reject) => {
    if (!CLI) return reject(new Error("wf_cli not found. Build the core first, or set WF_CLI to its path"));
    execFile(CLI, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message).toString().trim().split("\n").slice(-4).join(" ");
        return reject(Object.assign(new Error(msg || "wf_cli failed"), { stdout: stdout.toString() }));
      }
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

// ---------- storage ----------

const dirOf = (id) => path.join(DATA, id);
const safeId = (id) => /^[a-z0-9-]+$/.test(id);
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1));

function slug(name) {
  return (name || "building").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "building";
}

function newId(name) {
  let id = slug(name), n = 2;
  while (fs.existsSync(dirOf(id))) id = `${slug(name)}-${n++}`;
  return id;
}

// what the building list shows, worked out from the draft file
function info(id) {
  const dir = dirOf(id);
  const meta = readJson(path.join(dir, "meta.json"));
  const doc = readJson(path.join(dir, "draft.wfb"));
  const status = meta.publishedAt ? (meta.updatedAt > meta.publishedAt ? "changed" : "published") : "draft";
  return { id, name: doc.building.name || id, status, updatedAt: meta.updatedAt, publishedAt: meta.publishedAt || null,
    version: meta.version || 0, sources: meta.sources || [],
    // metres per pixel of the uploaded pictures, so the site can line them up under the plan
    scale: meta.scale || (meta.sources?.length ? 0.02 : null), ...summary(doc) };
}

function listIds() {
  return fs.readdirSync(DATA, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(DATA, e.name, "draft.wfb")))
    .map((e) => e.name);
}

// ---------- tiny multipart reader (so we don't need any npm package) ----------

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("upload too big (max 60 MB)"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// returns { fields: {name: value}, files: [{field, filename, data}] }
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!m) throw Object.assign(new Error("expected multipart/form-data"), { status: 400 });
  const boundary = Buffer.from("--" + (m[1] || m[2]));
  const out = { fields: {}, files: [] };
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === "--") break; // last boundary
    const headEnd = buf.indexOf("\r\n\r\n", start);
    const next = buf.indexOf(boundary, headEnd);
    if (headEnd === -1 || next === -1) break;
    const head = buf.slice(start + 2, headEnd).toString();
    const body = buf.slice(headEnd + 4, next - 2); // drop the \r\n before the boundary
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    if (name) {
      if (filename !== undefined) out.files.push({ field: name, filename, data: body });
      else out.fields[name] = body.toString();
    }
    pos = next;
  }
  return out;
}

// ---------- handlers ----------

async function createBuilding(req) {
  const form = parseMultipart(await readBody(req), req.headers["content-type"]);
  const f = form.fields;
  const floors = form.files.filter((x) => x.field === "floors" && x.data.length);
  const wfb = form.files.find((x) => x.field === "wfb" && x.data.length);
  if (!floors.length && !wfb) throw Object.assign(new Error("add at least one floor plan picture or a .wfb"), { status: 400 });

  const id = newId(f.name || "building");
  const dir = dirOf(id);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const now = new Date().toISOString();
  const meta = { createdAt: now, updatedAt: now, version: 0, sources: [] };

  try {
    if (wfb) {
      const doc = JSON.parse(wfb.data.toString());
      if (!doc.building || !Array.isArray(doc.levels)) throw Object.assign(new Error("that file isn't a .wfb"), { status: 400 });
      if (f.name) doc.building.name = f.name;
      writeJson(path.join(dir, "draft.wfb"), doc);
    } else {
      // keep the pictures (L1.png, L2.png ...) so we can show them under the plan later
      const files = floors.map((x, i) => {
        const ext = (path.extname(x.filename) || ".png").toLowerCase().replace(/[^.a-z]/g, "");
        const p = path.join(dir, "src", `L${i + 1}${ext}`);
        fs.writeFileSync(p, x.data);
        meta.sources.push({ level: `L${i + 1}`, file: path.basename(p), original: x.filename });
        return p;
      });
      const args = ["build", path.join(dir, "draft.wfb"), ...files, "--name", f.name || "Building",
        "--floor-height", String(Number(f.floorHeight) || 3.5)];
      if (Number(f.scale) > 0) args.push("--scale", String(Number(f.scale)));
      meta.scale = Number(f.scale) > 0 ? Number(f.scale) : 0.02; // 0.02 = wf_cli's default
      if (f.latitude) args.push("--lat", String(Number(f.latitude)));
      if (f.longitude) args.push("--lon", String(Number(f.longitude)));
      const { stdout } = await runCli(args);
      meta.buildLog = stdout.trim().split("\n").slice(-12);
    }
    const doc = readJson(path.join(dir, "draft.wfb"));
    doc.building.id = id;
    writeJson(path.join(dir, "draft.wfb"), doc);
    writeJson(path.join(dir, "meta.json"), meta);
    return { status: 201, body: { id, log: meta.buildLog || [] } };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true }); // don't leave half made buildings around
    throw e;
  }
}

async function saveBuilding(id, req) {
  const dir = dirOf(id);
  const text = (await readBody(req, 30 * 1024 * 1024)).toString();
  let doc;
  try { doc = JSON.parse(text); } catch { throw Object.assign(new Error("that isn't valid JSON"), { status: 400 }); }
  if (!doc.building || !Array.isArray(doc.levels)) throw Object.assign(new Error("that isn't a .wfb"), { status: 400 });
  const draft = path.join(dir, "draft.wfb");
  writeJson(draft, doc);
  // walls or doors may have moved, so rebuild the walking paths. tags and stair links are kept
  let warning = null;
  try { await runCli(["graph", draft, "-o", draft], 60000); } catch (e) { warning = "saved, but the paths couldn't be rebuilt: " + e.message; }
  const meta = readJson(path.join(dir, "meta.json"));
  meta.updatedAt = new Date().toISOString();
  writeJson(path.join(dir, "meta.json"), meta);
  return { body: { ...info(id), warning } };
}

function publish(id) {
  const dir = dirOf(id);
  const doc = readJson(path.join(dir, "draft.wfb"));
  const errors = validate(doc).filter((p) => p.type === "error");
  if (errors.length) throw Object.assign(new Error(`fix ${errors.length} error(s) before publishing: ${errors[0].text}`), { status: 400 });
  fs.copyFileSync(path.join(dir, "draft.wfb"), path.join(dir, "published.wfb"));
  const meta = readJson(path.join(dir, "meta.json"));
  meta.publishedAt = new Date().toISOString();
  meta.updatedAt = meta.publishedAt;
  meta.version = (meta.version || 0) + 1;
  writeJson(path.join(dir, "meta.json"), meta);
  return { body: info(id) };
}

async function route(id, q) {
  const args = ["route", path.join(dirOf(id), "draft.wfb"), q.get("from") || "", q.get("to") || ""];
  if (q.get("stepFree") === "1") args.push("--step-free");
  try {
    const { stdout } = await runCli(args, 30000);
    return { body: JSON.parse(stdout) };
  } catch (e) {
    // wf_cli prints {ok:false,error} on a failed route, pass that on as a normal answer
    try { return { body: JSON.parse(e.stdout) }; } catch { return { body: { ok: false, error: e.message } }; }
  }
}

// ---------- routing ----------

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".bmp": "image/bmp", ".svg": "image/svg+xml" };

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // ["api","buildings",id,...]
  if (parts[0] !== "api") return send(res, 404, { error: "not found" });
  const [, area, id, sub, extra] = parts;
  const m = req.method;

  if (area === "health") return send(res, 200, { ok: true, wfCli: CLI ? (await runCli(["--version"]).then((r) => r.stdout.trim()).catch(() => "error")) : null });

  if (area === "buildings") {
    if (!id && m === "GET") return send(res, 200, listIds().map(info).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    if (!id && m === "POST") { const r = await createBuilding(req); return send(res, r.status || 200, r.body); }
    if (!id || !safeId(id) || !fs.existsSync(path.join(dirOf(id), "draft.wfb"))) return send(res, 404, { error: `building "${id}" not found` });
    if (!sub && m === "GET") return send(res, 200, info(id));
    if (!sub && m === "DELETE") { fs.rmSync(dirOf(id), { recursive: true, force: true }); return send(res, 200, { ok: true }); }
    if (sub === "wfb" && m === "GET") return sendFile(res, path.join(dirOf(id), "draft.wfb"), "application/json");
    if (sub === "wfb" && m === "PUT") { const r = await saveBuilding(id, req); return send(res, 200, r.body); }
    if (sub === "publish" && m === "POST") return send(res, 200, publish(id).body);
    if (sub === "route" && m === "GET") return send(res, 200, (await route(id, url.searchParams)).body);
    if (sub === "source" && extra && m === "GET") {
      const s = (readJson(path.join(dirOf(id), "meta.json")).sources || []).find((x) => x.level === extra);
      if (!s) return send(res, 404, { error: "no picture for that level" });
      const p = path.join(dirOf(id), "src", s.file);
      return sendFile(res, p, TYPES[path.extname(p)] || "application/octet-stream");
    }
  }

  // for the Navigator / user website: only published buildings
  if (area === "published" && m === "GET") {
    if (!id) {
      return send(res, 200, listIds().filter((x) => fs.existsSync(path.join(dirOf(x), "published.wfb"))).map((x) => {
        const doc = readJson(path.join(dirOf(x), "published.wfb"));
        const meta = readJson(path.join(dirOf(x), "meta.json"));
        return { id: x, name: doc.building.name, latitude: doc.building.latitude, longitude: doc.building.longitude, version: meta.version };
      }));
    }
    const p = path.join(dirOf(id), "published.wfb");
    if (safeId(id) && sub === "wfb" && fs.existsSync(p)) return sendFile(res, p, "application/json");
  }
  return send(res, 404, { error: "not found" });
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function sendFile(res, p, type) {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  fs.createReadStream(p).pipe(res);
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
  });
}).on("error", (e) => {
  // most likely something else is already using the port
  console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is already in use. Close the other server window, or run with PORT=8081` : e);
  process.exit(1);
}).listen(PORT, HOST, () => {
  console.log(`Wayforge Studio backend on http://${HOST}:${PORT}`);
  console.log(`  data:   ${DATA}`);
  console.log(`  wf_cli: ${CLI || "NOT FOUND - build the core first, or set WF_CLI"}`);
});
