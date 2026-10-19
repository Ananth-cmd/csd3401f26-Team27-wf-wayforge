/*!
 * \file api.js
 * \brief picks the real backend or the mock one. pages only import from here.
 *
 * - VITE_API_URL set (.env.local)  -> always the real backend at that url
 * - otherwise it asks /api/health once at start up. if the Studio backend
 *   (npm run server) answers, it uses that, if not it falls back to the mock
 *   so the site still works with no server at all
 *
 * main.jsx waits for api.ready before showing the page
 *
 * \author Katie Lim
 */
import { mockApi } from "./mockApi.js";
import { realApi } from "./realApi.js";

let chosen = null;

async function pick() {
  if (import.meta.env.VITE_API_URL) return realApi;
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (res.ok && (await res.json()).ok) return realApi;
  } catch { /* no backend running, that's fine */ }
  return mockApi;
}

const ready = pick().then((a) => { chosen = a; return a; });

// every call waits until we know which backend to use
export const api = new Proxy({}, {
  get(_, key) {
    if (key === "then") return undefined; // so nobody mistakes api for a promise
    if (key === "ready") return ready;
    if (key === "mode") return chosen ? chosen.mode : "checking";
    return async (...args) => (await ready)[key](...args);
  },
});
