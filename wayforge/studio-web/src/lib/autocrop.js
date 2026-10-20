/*!
 * \file autocrop.js
 * \brief guess where the floor plan is on a drawing sheet, so the border,
 *        title block, sheet notes and labels don't turn into walls
 *
 * how it works (on a shrunk copy of the picture, so it's quick):
 *  1. mark the dark pixels
 *  2. rows/columns that are dark almost all the way across are the sheet
 *     border or the title block line. the plan sits inside those, above the
 *     title block line
 *  3. inside that area, group dark pixels that touch (on a coarse grid so
 *     door gaps and thin lines still join up). the biggest group is the
 *     building. other big groups (a second tower) are kept, small ones
 *     (text, north arrow, scale bar) are dropped
 *  4. crop = box around what's kept, plus a little margin
 *
 * it's a guess, so the crop can always be fixed by hand afterwards
 *
 * \author Katie Lim
 */

const WORK = 1000;      // longest side of the shrunk copy we look at
const CELL = 6;         // grid cell size (in shrunk pixels) for grouping
const DARK = 140;       // brightness below this counts as ink

export async function autoCrop(url) {
  const img = await loadImage(url);
  const W0 = img.naturalWidth, H0 = img.naturalHeight;
  const k = Math.min(1, WORK / Math.max(W0, H0));
  const W = Math.max(1, Math.round(W0 * k)), H = Math.max(1, Math.round(H0 * k));

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;

  // 1. ink mask
  const ink = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const g = 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
    ink[i] = g < DARK ? 1 : 0;
  }

  // 2. frame lines: rows / columns that are mostly ink
  const rowFull = (y) => { let n = 0; for (let x = 0; x < W; x++) n += ink[y * W + x]; return n > W * 0.6; };
  const colFull = (x) => { let n = 0; for (let y = 0; y < H; y++) n += ink[y * W + x]; return n > H * 0.6; };
  let top = 0, bottom = H - 1, left = 0, right = W - 1;
  for (let y = 0; y < H * 0.2; y++) if (rowFull(y)) top = y + 1;
  for (let x = 0; x < W * 0.2; x++) if (colFull(x)) left = x + 1;
  for (let x = W - 1; x > W * 0.8; x--) if (colFull(x)) right = x - 1;
  // bottom: the highest full-width line in the lower 45% (title block top), or the border
  for (let y = H - 1; y > H * 0.55; y--) if (rowFull(y)) bottom = y - 1;
  // title blocks are often only as wide as the inner frame, check against that width too
  const innerW = right - left;
  for (let y = Math.floor(H * 0.55); y < bottom; y++) {
    let n = 0; for (let x = left; x <= right; x++) n += ink[y * W + x];
    if (n > innerW * 0.85) { bottom = y - 1; break; }
  }
  // stay a few pixels inside the frame lines
  top += 3; left += 3; right -= 3; bottom -= 3;
  if (right - left < W * 0.2 || bottom - top < H * 0.2) { top = 0; left = 0; right = W - 1; bottom = H - 1; }

  // 3. coarse grid inside the frame, then group touching cells
  const gw = Math.ceil((right - left + 1) / CELL), gh = Math.ceil((bottom - top + 1) / CELL);
  const grid = new Uint8Array(gw * gh);
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (ink[y * W + x]) grid[Math.floor((y - top) / CELL) * gw + Math.floor((x - left) / CELL)] = 1;
    }
  }
  const label = new Int32Array(gw * gh).fill(-1);
  const groups = [];
  const stack = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!grid[s] || label[s] !== -1) continue;
    const g = { cells: 0, x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
    label[s] = groups.length; stack.push(s);
    while (stack.length) {
      const c = stack.pop();
      const cx = c % gw, cy = (c - cx) / gw;
      g.cells++;
      if (cx < g.x0) g.x0 = cx; if (cx > g.x1) g.x1 = cx;
      if (cy < g.y0) g.y0 = cy; if (cy > g.y1) g.y1 = cy;
      // 8 neighbours. a cell is CELL px wide, so gaps up to about one cell (doors) still join
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = ny * gw + nx;
        if (grid[n] && label[n] === -1) { label[n] = groups.length; stack.push(n); }
      }
    }
    groups.push(g);
  }
  if (!groups.length) return null;

  // 4. keep the big groups. size = how much area the group covers, so a long
  // thin dimension line counts as small and a building counts as big
  const area = (g) => (g.x1 - g.x0 + 1) * (g.y1 - g.y0 + 1);
  const score = (g) => Math.min(g.cells * 4, area(g));
  const best = Math.max(...groups.map(score));
  const keep = groups.filter((g) => score(g) >= best * 0.15 && (g.x1 - g.x0) > 4 && (g.y1 - g.y0) > 4);
  let x0 = Math.min(...keep.map((g) => g.x0)), y0 = Math.min(...keep.map((g) => g.y0));
  let x1 = Math.max(...keep.map((g) => g.x1)), y1 = Math.max(...keep.map((g) => g.y1));

  // back to full size picture pixels, with a small margin
  const margin = 0.012 * Math.max(W, H);
  const fx0 = Math.max(0, left + x0 * CELL - margin), fy0 = Math.max(0, top + y0 * CELL - margin);
  const fx1 = Math.min(W, left + (x1 + 1) * CELL + margin), fy1 = Math.min(H, top + (y1 + 1) * CELL + margin);
  const crop = {
    x: Math.round(fx0 / k), y: Math.round(fy0 / k),
    w: Math.round((fx1 - fx0) / k), h: Math.round((fy1 - fy0) / k),
  };
  // if the "crop" is basically the whole picture, there was nothing to cut
  if (crop.w * crop.h > W0 * H0 * 0.92) return null;
  return crop;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("couldn't read the picture"));
    i.src = url;
  });
}
