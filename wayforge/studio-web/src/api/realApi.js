/*!
 * \file realApi.js
 * \brief talks to the Studio server (server/server.mjs)
 *
 * the endpoints are in API.md in this folder. the pages only call these
 * functions, so if a url changes it only changes here.
 *
 * \author Katie Lim
 */

const BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

async function call(path, options = {}) {
  const res = await fetch(BASE + path, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error((body && body.error) || `${res.status} ${res.statusText}`);
  return body;
}

export const realApi = {
  mode: "server",

  listBuildings: () => call("/buildings"),

  async createBuilding(form, onStep = () => {}) {
    const fd = new FormData();
    fd.append("name", form.name || "");
    fd.append("floorHeight", form.floorHeight || "3.5");
    if (form.latitude !== "") fd.append("latitude", form.latitude);
    if (form.longitude !== "") fd.append("longitude", form.longitude);
    if (form.scale) fd.append("scale", String(form.scale)); // metres per pixel, from the measure tool
    if (form.wfbFile) fd.append("wfb", form.wfbFile);
    // order matters, the first picture becomes L1, second L2 ...
    (form.floors || []).forEach((f) => fd.append("floors", f));
    onStep("Reading the floor plans");
    return call("/buildings", { method: "POST", body: fd });
  },

  async getBuilding(id) {
    const info = await call(`/buildings/${encodeURIComponent(id)}`);
    const res = await fetch(`${BASE}/buildings/${encodeURIComponent(id)}/wfb`);
    if (!res.ok) throw new Error(`couldn't download the .wfb (${res.status})`);
    return { ...info, wfb: await res.text() };
  },

  saveBuilding: (id, wfbText) =>
    call(`/buildings/${encodeURIComponent(id)}/wfb`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: wfbText,
    }),

  deleteBuilding: (id) => call(`/buildings/${encodeURIComponent(id)}`, { method: "DELETE" }),

  publishBuilding: (id) => call(`/buildings/${encodeURIComponent(id)}/publish`, { method: "POST" }),

  async reset() { /* nothing to reset on the real server */ },
};
