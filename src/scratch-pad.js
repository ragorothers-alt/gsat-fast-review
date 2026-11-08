// 草稿區的資料：每題一頁、頁裡的筆劃、復原與重做、整條擦掉、紙能往下捲多遠、拉直線時的角度對齊。
// 純邏輯，不碰 DOM；畫面與手勢在 ui/scratch.js。座標是「頁面座標」：x 從紙的左緣、y 從這頁頂端算起（CSS px）。

/** 寫到可視高度的一半以下才能往下捲；最多捲到最低的筆跡停在畫面上方 30% 處，下面空出七成接著寫 */
export const SCROLL_FROM = 0.5;
export const KEEP_ABOVE = 0.3;
/** 記住的頁數上限：超過就丟掉最久沒翻到的頁（目前這頁不丟） */
export const MAX_PAGES = 80;
/** 拉直線：畫了至少這麼長，筆停在原地（HOLD_SLOP px 內）這麼久 */
export const HOLD_MS = 500;
export const HOLD_MIN = 24;
export const HOLD_SLOP = 4;
/** 拉直線時接近水平、垂直或 45° 就對齊（度） */
export const SNAP_DEG = 6;

/** 一本草稿：key → 頁；Map 的順序就是最近翻到的順序 */
export function createBook(max = MAX_PAGES) {
  return { pages: new Map(), key: null, max };
}

/**
 * 翻到 key 這一頁（沒有就開新頁）。離開的那頁沒寫過東西就不留。
 * @returns 這一頁：{ entries: 依序的筆劃與清空記號, redo: 復原掉的, scroll: 往下捲了多少 }
 */
export function openPage(book, key) {
  const prev = book.pages.get(book.key);
  if (prev && book.key !== key && !prev.entries.length && !prev.redo.length) book.pages.delete(book.key);
  let page = book.pages.get(key);
  if (page) book.pages.delete(key);
  else page = { entries: [], redo: [], scroll: 0 };
  book.pages.set(key, page);
  book.key = key;
  for (const k of book.pages.keys()) {
    if (book.pages.size <= book.max) break;
    if (k !== key) book.pages.delete(k);
  }
  return page;
}

/** 這頁現在看得到的筆劃：最後一次清空之後的，扣掉整條擦掉的 */
export function visible(page) {
  let i = page.entries.length;
  while (i > 0 && !page.entries[i - 1].clear) i--;
  const shown = page.entries.slice(i);
  const gone = new Set();
  for (const e of shown) if (e.erase) for (const s of e.erase) gone.add(s);
  return shown.filter((e) => !e.erase && !gone.has(e));
}

/** 畫完一筆：之前復原掉的就不能再重做 */
export function addStroke(page, stroke) {
  page.entries.push(stroke);
  page.redo = [];
}

/** 整條擦掉：記一筆「擦掉這幾條」（一次拖過去擦掉的算一步，復原就全部回來） */
export function eraseStrokes(page, strokes) {
  if (!strokes.length) return false;
  page.entries.push({ erase: strokes });
  page.redo = [];
  return true;
}

/** 清空：記一個清空記號（可以復原），捲回頂端 */
export function clearPage(page) {
  if (!visible(page).length) return false;
  page.entries.push({ clear: true, scroll: page.scroll });
  page.redo = [];
  page.scroll = 0;
  return true;
}

/** 復原最後一筆（或最後一次清空，回到清空前捲到的位置） */
export function undo(page) {
  const e = page.entries.pop();
  if (!e) return false;
  page.redo.push(e);
  if (e.clear) page.scroll = e.scroll;
  return true;
}

export function redo(page) {
  const e = page.redo.pop();
  if (!e) return false;
  if (e.clear) {
    e.scroll = page.scroll;
    page.scroll = 0;
  }
  page.entries.push(e);
  return true;
}

/** 筆跡最低處（頁面座標，含筆寬）；橡皮擦不算，沒有筆跡是 0 */
export function inkBottom(page) {
  let bottom = 0;
  for (const s of visible(page)) {
    if (s.tool === 'eraser') continue;
    for (const p of s.pts) bottom = Math.max(bottom, p.y + p.w / 2);
  }
  return bottom;
}

/** 最多能往下捲多少（可視高度 viewH） */
export function maxScroll(page, viewH) {
  const bottom = inkBottom(page);
  return bottom > viewH * SCROLL_FROM ? bottom - viewH * KEEP_ABOVE : 0;
}

/** 捲到 y：不能捲到頂端以上，也不能超過能捲的範圍；已經在範圍外（例如復原掉下面的筆跡）就停在原地，不跳 */
export function clampScroll(page, y, viewH) {
  return Math.min(Math.max(0, y), Math.max(maxScroll(page, viewH), page.scroll));
}

// ── 整條擦掉：橡皮擦拖過的線段碰到哪幾條筆劃 ─────────
/** 整條擦掉的橡皮擦半徑（px）：離筆劃邊緣這麼近就算碰到 */
export const STROKE_ERASE_R = 10;

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** 點 p 到線段 ab 的距離 */
function pointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 線段 ab 與 cd 的最短距離（交叉時是 0） */
export function segmentDistance(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}

/** 筆劃的外框（含筆寬），算一次記在筆劃上 */
function bounds(s) {
  if (!s.box) {
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of s.pts) {
      box.x0 = Math.min(box.x0, p.x - p.w / 2);
      box.y0 = Math.min(box.y0, p.y - p.w / 2);
      box.x1 = Math.max(box.x1, p.x + p.w / 2);
      box.y1 = Math.max(box.y1, p.y + p.w / 2);
    }
    s.box = box;
  }
  return s.box;
}

/** 橡皮擦從 a 拖到 b（半徑 r）碰到的筆劃；橡皮擦的筆劃（擦一塊留下的）不算 */
export function hitStrokes(strokes, a, b, r = STROKE_ERASE_R) {
  const x0 = Math.min(a.x, b.x) - r;
  const x1 = Math.max(a.x, b.x) + r;
  const y0 = Math.min(a.y, b.y) - r;
  const y1 = Math.max(a.y, b.y) + r;
  return strokes.filter((s) => {
    if (s.tool === 'eraser' || !s.pts?.length) return false;
    const box = bounds(s);
    if (box.x0 > x1 || box.x1 < x0 || box.y0 > y1 || box.y1 < y0) return false;
    const p = s.pts;
    if (p.length === 1) return pointToSegment(p[0], a, b) <= r + p[0].w / 2;
    for (let i = 1; i < p.length; i++) if (segmentDistance(p[i - 1], p[i], a, b) <= r + Math.max(p[i - 1].w, p[i].w) / 2) return true;
    return false;
  });
}

export function pathLength(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return n;
}

/** 拉直線的終點：從 a 到 b 的方向接近水平、垂直或 45° 時對齊，長度不變 */
export function snapLine(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { x: b.x, y: b.y };
  const step = Math.PI / 4;
  const angle = Math.atan2(dy, dx);
  const near = Math.round(angle / step) * step;
  if (Math.abs(angle - near) > (SNAP_DEG * Math.PI) / 180) return { x: b.x, y: b.y };
  const round = (v) => Math.round(v * 100) / 100;
  return { x: round(a.x + Math.cos(near) * len), y: round(a.y + Math.sin(near) * len) };
}
