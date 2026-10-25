/*!
 * \file mockApi.js
 * \brief pretend backend so the Studio works before the real server exists
 *
 * keeps buildings in the browser's localStorage (falls back to memory if
 * that's blocked). it has the same functions as realApi.js so the pages
 * don't care which one they're using.
 *
 * the one thing it can't do is turn pictures into a building, that needs
 * wf_cli on the server. so "upload pictures" here just copies the sample
 * building and gives it one floor per picture, enough to test the flow.
 *
 * \author Katie Lim
 */
import { parseWfb, toWfbText, summary, validate } from "../lib/wfb.js";
import { findRoute } from "../lib/route.js";

const KEY = "wayforge-studio-mock";
let memory = null; // used if localStorage isn't allowed

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* private window etc, just use memory */ }
  return memory || { buildings: {} };
}

function store(db) {
  memory = db;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* full or blocked */ }
}

// fake a bit of network delay so loading states actually show up
const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

const slug = (name) =>
  (name || "building").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "building";

function listItem(id, b) {
  const doc = parseWfb(b.wfb);
  return {
    id, name: doc.building.name || id, status: b.publishedAt ? (b.updatedAt > b.publishedAt ? "changed" : "published") : "draft",
    updatedAt: b.updatedAt, publishedAt: b.publishedAt || null, version: b.version || 0, ...summary(doc),
  };
}

async function sampleText() {
  const res = await fetch(import.meta.env.BASE_URL + "samples/sit-punggol.wfb");
  if (!res.ok) throw new Error("couldn't load the sample building");
  return res.text();
}

function save(db, id, wfbText) {
  db.buildings[id] = { ...(db.buildings[id] || {}), wfb: wfbText, updatedAt: new Date().toISOString() };
  store(db);
}

// first time (or after a reset): put the sample in so there's something to open
async function loadWithSample() {
  const db = load();
  if (!Object.keys(db.buildings).length) save(db, "sample-block", await sampleText());
  return db;
}

export const mockApi = {
  mode: "mock",

  async listBuildings() {
    await wait();
    const db = await loadWithSample();
    return Object.entries(db.buildings)
      .map(([id, b]) => listItem(id, b))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  // form = { name, floorHeight, latitude, longitude, floors: [File...], wfbFile }
  async createBuilding(form, onStep = () => {}) {
    const db = load();
    let doc;
    if (form.wfbFile) {
      onStep("reading the .wfb file");
      doc = parseWfb(await form.wfbFile.text());
    } else {
      // real server: wf_cli build out.wfb L1.png L2.png ... --name --floor-height --lat --lon
      onStep("uploading floor plans");
      await wait(500);
      onStep("reading walls, doors and rooms (mock, using the sample plan)");
      await wait(700);
      const sample = parseWfb(await sampleText());
      const count = Math.max(1, form.floors.length);
      doc = { ...sample, levels: [], links: [] };
      for (let i = 0; i < count; i++) {
        const lvl = structuredClone(sample.levels[i % sample.levels.length]);
        lvl.id = `L${i + 1}`;
        lvl.name = `Level ${i + 1}`;
        lvl.elevation = i * (Number(form.floorHeight) || 3.5);
        // a fresh upload has nothing tagged yet
        for (const r of lvl.rooms) { if (r.kind !== "corridor") r.kind = "unknown"; r.code = ""; r.name = ""; }
        doc.levels.push(lvl);
      }
      doc.source = { ...doc.source, file: form.floors.map((f) => f.name).join(", ") };
    }
    if (form.name) doc.building.name = form.name;
    if (form.latitude !== "" && form.latitude != null) doc.building.latitude = Number(form.latitude);
    if (form.longitude !== "" && form.longitude != null) doc.building.longitude = Number(form.longitude);

    let id = slug(doc.building.name), n = 2;
    while (db.buildings[id]) id = `${slug(doc.building.name)}-${n++}`;
    doc.building.id = id;
    onStep("saving");
    save(db, id, toWfbText(doc));
    await wait(200);
    return { id };
  },

  async getBuilding(id) {
    await wait();
    const b = (await loadWithSample()).buildings[id];
    if (!b) throw new Error(`building "${id}" not found`);
    return { ...listItem(id, b), wfb: b.wfb };
  },

  // real server would also rerun wf_cli graph here so the paths match the new walls
  async saveBuilding(id, wfbText) {
    await wait();
    const db = load();
    if (!db.buildings[id]) throw new Error(`building "${id}" not found`);
    parseWfb(wfbText); // throws if it's broken, don't save junk
    save(db, id, wfbText);
    return listItem(id, db.buildings[id]);
  },

  async deleteBuilding(id) {
    await wait();
    const db = load();
    delete db.buildings[id];
    store(db);
  },

  // publish = the Navigator/User website can now see this version
  async publishBuilding(id) {
    await wait(600);
    const db = load();
    const b = db.buildings[id];
    if (!b) throw new Error(`building "${id}" not found`);
    const errors = validate(parseWfb(b.wfb)).filter((p) => p.type === "error");
    if (errors.length) throw new Error(`fix ${errors.length} error(s) before publishing`);
    b.publishedAt = new Date().toISOString();
    b.updatedAt = b.publishedAt;
    b.version = (b.version || 0) + 1;
    b.published = b.wfb; // what the Navigator would get
    store(db);
    return listItem(id, b);
  },

  async route(id, wfbText, from, to, stepFree) {
    await wait(150);
    return findRoute(parseWfb(wfbText), from, to, stepFree);
  },

  // wipe everything, handy while testing
  async reset() {
    memory = null;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
