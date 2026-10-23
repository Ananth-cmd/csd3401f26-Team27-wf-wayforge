// Run with: node checkIntegration.mjs
// Requires the Studio server on :8080 and the user's backend on :3000.
const base = process.env.BACKEND_URL || 'http://127.0.0.1:3000';
const id = process.env.BUILDING_ID || 'backend-integration-test';
const start = process.env.ROUTE_FROM || 'L1:n1';
const end = process.env.ROUTE_TO || 'L1:n8';

async function get(path) {
  const r = await fetch(base + path, {signal: AbortSignal.timeout(10000)});
  const body = await r.json();
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(body)}`);
  return body;
}
try {
  const cors = await fetch(base + '/api/health', {
    headers: { Origin: 'http://localhost:5173' },
    signal: AbortSignal.timeout(10000)
  });
  if (cors.headers.get('access-control-allow-origin') !== 'http://localhost:5173') {
    throw new Error('Browser CORS permission missing for localhost:5173');
  }
  const health = await get('/api/health');
  if (health.ok !== true) throw new Error('Health check did not return ok:true');
  const list = await get('/api/published');
  if (!Array.isArray(list) || !list.some(b => b.id === id)) throw new Error(`Published building ${id} missing`);
  const raw = await get(`/api/published/${encodeURIComponent(id)}/wfb`);
  if (!Array.isArray(raw.levels) || !raw.building) throw new Error('Raw building invalid');
  const nav = await get(`/api/navigator/${encodeURIComponent(id)}/building`);
  if (!Array.isArray(nav.nodes) || !Array.isArray(nav.edges) || !Array.isArray(nav.links)) throw new Error('Navigator building missing graph arrays');
  const q = new URLSearchParams({from:start, to:end, stepFree:'1'});
  const route = await get(`/api/navigator/${encodeURIComponent(id)}/route?${q}`);
  if (!Array.isArray(route.nodes) || !Array.isArray(route.passages) || route.passages.length !== Math.max(0,route.nodes.length-1)) {
    throw new Error('Invalid Navigator route shape');
  }
  const ids = new Set(nav.nodes.map(n=>n.id));
  for (const n of route.nodes) if (!ids.has(n)) throw new Error(`Route node ${n} not in Navigator building`);
  console.log('PASS: CORS, health, published listing, .wfb, Navigator building and route compatibility');
  console.log(`Building ${id}: ${nav.levels.length} floor(s), ${nav.nodes.length} nodes, ${nav.links.length} inter-floor links`);
  console.log(`Route: ${route.nodes.join(' -> ')} | ${route.passages.join(', ')} | weighted cost ${route.metres}`);
  if (nav.levels.some(l=>l.floors.length===0)) {
    console.log('NOTICE: Some floor slab outlines are empty; Navigator 3D viewer may need floor polygons from engine/viewer');
  }
} catch (error) {
  console.error('FAIL:', error.message);
  process.exitCode = 1;
}
