// 圖表題的圖：題目的 fig 欄位是資料（不是圖片），這裡把它畫成 SVG 或表格，並產生給螢幕閱讀器、複製給 AI 用的文字敘述。
// 純字串，不碰 DOM：驗證器（scripts/validate-questions.mjs）和測試也用得到。
// 種類：line 折線／曲線、scatter 散布圖、bar 長條圖、climate 氣候圖（月均溫折線＋月降水長條）、table 資料表。

export const FIG_TYPES = ['line', 'scatter', 'bar', 'climate', 'table'];
const KEYS = {
  line: ['type', 'title', 'x', 'y', 'series', 'marks'],
  scatter: ['type', 'title', 'x', 'y', 'series', 'marks'],
  bar: ['type', 'title', 'x', 'y', 'series'],
  climate: ['type', 'title', 'temp', 'rain'],
  table: ['type', 'title', 'cols', 'rows'],
};
const LIMITS = { title: 30, label: 16, name: 8, cat: 6, cell: 14, mark: 6, series: 4, barSeries: 3, points: 40, cats: 8, cols: 5, rows: 7 };
const MONTHS = 12;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isText = (x, max) => typeof x === 'string' && x.trim().length > 0 && visible(x) <= max;
/** 顯示長度：公式（$…$）大約三個字元算一字 */
function visible(text) {
  return String(text)
    .split('$')
    .reduce((n, part, i) => n + (i % 2 ? Math.ceil(part.length / 3) : part.length), 0);
}

/**
 * 檢查 fig 的格式，回傳錯誤訊息（空陣列表示沒問題）。
 * 畫在手機的題目卡上，所以數量都有上限：折線最多 4 條、每條 40 個點，長條最多 8 類 × 3 組，表格最多 5 欄 × 7 列。
 */
export function checkFigure(fig) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!fig || typeof fig !== 'object' || Array.isArray(fig)) return ['fig 必須是物件'];
  if (!FIG_TYPES.includes(fig.type)) return [`fig.type 必須是 ${FIG_TYPES.join('、')} 其中之一`];
  for (const k of Object.keys(fig)) if (!KEYS[fig.type].includes(k)) err(`fig 有未知欄位 "${k}"`);
  if (fig.title !== undefined && !isText(fig.title, LIMITS.title)) err(`fig.title 要是 1–${LIMITS.title} 字的文字`);
  if (typeof fig.title === 'string' && fig.title.includes('$') && fig.type !== 'table') err('圖的標題不能用 LaTeX（只有表格可以）');

  const axis = (a, name, needLabel = true) => {
    if (!a || typeof a !== 'object') return err(`fig.${name} 必須是物件`);
    for (const k of Object.keys(a)) if (!['label', 'min', 'max', 'step', 'cats'].includes(k)) err(`fig.${name} 有未知欄位 "${k}"`);
    if (needLabel && (!isText(a.label, LIMITS.label) || a.label.includes('$'))) err(`fig.${name}.label 要是 1–${LIMITS.label} 字的文字（不能用 LaTeX，單位寫成 m/s、°C）`);
    for (const k of ['min', 'max', 'step']) if (a[k] !== undefined && !isNum(a[k])) err(`fig.${name}.${k} 必須是數字`);
    if (a.step !== undefined && !(a.step > 0)) err(`fig.${name}.step 必須大於 0`);
    if (isNum(a.min) && isNum(a.max) && a.min >= a.max) err(`fig.${name}.min 必須小於 max`);
  };
  const covers = (a, name, values) => {
    if (!a || !values.length || !values.every(isNum)) return;
    if (isNum(a.min) && Math.min(...values) < a.min) err(`fig.${name}.min 比資料的最小值大，有點畫不進去`);
    if (isNum(a.max) && Math.max(...values) > a.max) err(`fig.${name}.max 比資料的最大值小，有點畫不進去`);
    const s = scale(values, a);
    if (s.ticks.length < 2 || s.ticks.length > 11) err(`fig.${name} 的刻度有 ${s.ticks.length} 個，調整 min／max／step 讓它在 2–11 個`);
  };
  const names = (series) => {
    series.forEach((s, i) => {
      if (s.name !== undefined && (!isText(s.name, LIMITS.name) || s.name.includes('$'))) err(`fig.series[${i}].name 要是 1–${LIMITS.name} 字的文字`);
      if (series.length > 1 && s.name === undefined) err(`fig.series[${i}] 要有 name（不只一組資料時靠圖例分辨）`);
    });
    const used = series.map((s) => s.name).filter(Boolean);
    if (new Set(used).size !== used.length) err('fig.series 的 name 不可重複');
  };

  if (fig.type === 'line' || fig.type === 'scatter') {
    axis(fig.x, 'x');
    axis(fig.y, 'y');
    if (fig.x?.cats !== undefined || fig.y?.cats !== undefined) err('折線圖與散布圖的座標軸是數值，不用 cats');
    if (!Array.isArray(fig.series) || fig.series.length < 1 || fig.series.length > LIMITS.series) return [...errors, `fig.series 要有 1–${LIMITS.series} 組`];
    const min = fig.type === 'line' ? 2 : 3;
    fig.series.forEach((s, i) => {
      if (!s || typeof s !== 'object') return err(`fig.series[${i}] 必須是物件`);
      for (const k of Object.keys(s)) if (!['name', 'points', 'smooth', 'dashed'].includes(k)) err(`fig.series[${i}] 有未知欄位 "${k}"`);
      if (!Array.isArray(s.points) || s.points.length < min || s.points.length > LIMITS.points) return err(`fig.series[${i}].points 要有 ${min}–${LIMITS.points} 個點`);
      if (!s.points.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum))) return err(`fig.series[${i}].points 的每個點要是 [x, y] 兩個數字`);
      if (fig.type === 'line' && s.points.some((p, k) => k && p[0] <= s.points[k - 1][0])) err(`fig.series[${i}].points 的 x 要由小到大、不重複`);
      for (const k of ['smooth', 'dashed']) if (s[k] !== undefined && typeof s[k] !== 'boolean') err(`fig.series[${i}].${k} 必須是 true/false`);
      if (fig.type === 'scatter' && (s.smooth || s.dashed)) err('散布圖的 series 不用 smooth／dashed');
    });
    if (errors.length) return errors;
    names(fig.series);
    const pts = fig.series.flatMap((s) => s.points);
    if (fig.marks !== undefined) {
      if (!Array.isArray(fig.marks) || fig.marks.length < 1 || fig.marks.length > 4) err('fig.marks 要有 1–4 個標記點');
      else
        fig.marks.forEach((m, i) => {
          if (!m || !isNum(m.x) || !isNum(m.y) || !isText(m.label, LIMITS.mark) || m.label.includes('$')) err(`fig.marks[${i}] 要是 { x, y, label }，label 1–${LIMITS.mark} 字`);
          else pts.push([m.x, m.y]);
        });
    }
    covers(fig.x, 'x', pts.map((p) => p[0]));
    covers(fig.y, 'y', pts.map((p) => p[1]));
  } else if (fig.type === 'bar') {
    axis(fig.x, 'x', false);
    axis(fig.y, 'y');
    const cats = fig.x?.cats;
    if (fig.x?.label !== undefined && (!isText(fig.x.label, LIMITS.label) || fig.x.label.includes('$'))) err(`fig.x.label 要是 1–${LIMITS.label} 字的文字`);
    if (!Array.isArray(cats) || cats.length < 2 || cats.length > LIMITS.cats || !cats.every((c) => isText(c, LIMITS.cat) && !c.includes('$'))) return [...errors, `fig.x.cats 要有 2–${LIMITS.cats} 個類別，每個 1–${LIMITS.cat} 字`];
    if (new Set(cats).size !== cats.length) err('fig.x.cats 不可重複');
    if (!Array.isArray(fig.series) || fig.series.length < 1 || fig.series.length > LIMITS.barSeries) return [...errors, `長條圖的 fig.series 要有 1–${LIMITS.barSeries} 組`];
    fig.series.forEach((s, i) => {
      if (!s || typeof s !== 'object') return err(`fig.series[${i}] 必須是物件`);
      for (const k of Object.keys(s)) if (!['name', 'values'].includes(k)) err(`fig.series[${i}] 有未知欄位 "${k}"`);
      if (!Array.isArray(s.values) || s.values.length !== cats.length || !s.values.every((v) => isNum(v) && v >= 0)) err(`fig.series[${i}].values 要有 ${cats.length} 個不小於 0 的數字（和 cats 一一對應）`);
    });
    if (errors.length) return errors;
    names(fig.series);
    if (cats.length * fig.series.length > 18) err('長條太多（類別數 × 組數最多 18），手機上看不清楚');
    covers(fig.y, 'y', [0, ...fig.series.flatMap((s) => s.values)]);
  } else if (fig.type === 'climate') {
    const months = (a, name, ok) => {
      if (!Array.isArray(a) || a.length !== MONTHS || !a.every((v) => isNum(v) && ok(v))) err(`fig.${name} 要是 12 個月的數字`);
    };
    months(fig.temp, 'temp', (v) => v >= -60 && v <= 45);
    months(fig.rain, 'rain', (v) => v >= 0 && v <= 2000);
  } else {
    if (!Array.isArray(fig.cols) || fig.cols.length < 2 || fig.cols.length > LIMITS.cols || !fig.cols.every((c) => isText(c, LIMITS.cell))) return [...errors, `fig.cols 要有 2–${LIMITS.cols} 欄，每欄標題 1–${LIMITS.cell} 字`];
    if (!Array.isArray(fig.rows) || fig.rows.length < 2 || fig.rows.length > LIMITS.rows) return [...errors, `fig.rows 要有 2–${LIMITS.rows} 列`];
    fig.rows.forEach((r, i) => {
      if (!Array.isArray(r) || r.length !== fig.cols.length) return err(`fig.rows[${i}] 要有 ${fig.cols.length} 格（和 cols 一樣多）`);
      r.forEach((c, k) => {
        if (!(isNum(c) || isText(c, LIMITS.cell))) err(`fig.rows[${i}][${k}] 要是數字或 1–${LIMITS.cell} 字的文字`);
      });
    });
  }
  return errors;
}

// ── 座標軸 ─────────────────────────────────────────

/** 數字去掉浮點誤差（0.30000000000000004 → 0.3） */
export const fmt = (v) => String(+v.toFixed(6)).replace('-', '−');

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pow;
}

/**
 * 座標軸的範圍與刻度：沒指定就從資料取整齊的範圍（約 5 格）；資料都不小於 0、而且最小值不到最大值的一半時從 0 開始
 * @param {number[]} values
 * @param {{ min?: number, max?: number, step?: number }} [axis]
 */
export function scale(values, axis = {}) {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) (lo -= 1), (hi += 1);
  if (axis.min === undefined && lo >= 0 && lo <= hi / 2) lo = 0;
  const step = axis.step ?? niceStep(((axis.max ?? hi) - (axis.min ?? lo)) / 5);
  const min = axis.min ?? Math.floor(lo / step + 1e-9) * step;
  const max = axis.max ?? Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let i = 0; i <= 200; i++) {
    const t = min + i * step;
    if (t > max + step * 1e-6) break;
    ticks.push(+t.toFixed(9));
  }
  return { min, max, step, ticks };
}

// ── 畫圖 ─────────────────────────────────────────

const W = 320;
const H = 186;
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const r1 = (v) => +v.toFixed(1);
/** 各組資料的線型與點的形狀：不靠顏色也分得出來 */
const DASH = ['', '6 3', '2 3', '8 3 2 3'];

function marker(k, x, y, cls) {
  const s = 3.2;
  if (k === 1) return `<rect class="${cls}" x="${r1(x - s)}" y="${r1(y - s)}" width="${2 * s}" height="${2 * s}"/>`;
  if (k === 2) return `<path class="${cls}" d="M${r1(x)} ${r1(y - s - 1)}L${r1(x + s + 0.6)} ${r1(y + s)}L${r1(x - s - 0.6)} ${r1(y + s)}Z"/>`;
  if (k === 3) return `<path class="${cls}" d="M${r1(x)} ${r1(y - s - 1)}L${r1(x + s + 1)} ${r1(y)}L${r1(x)} ${r1(y + s + 1)}L${r1(x - s - 1)} ${r1(y)}Z"/>`;
  return `<circle class="${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${s}"/>`;
}

/** 平滑曲線（Catmull-Rom 轉三次貝茲） */
function smoothPath(p) {
  let d = `M${r1(p[0][0])} ${r1(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[i];
    const c = p[i + 1];
    const e = p[Math.min(p.length - 1, i + 2)];
    d += `C${r1(b[0] + (c[0] - a[0]) / 6)} ${r1(b[1] + (c[1] - a[1]) / 6)} ${r1(c[0] - (e[0] - b[0]) / 6)} ${r1(c[1] - (e[1] - b[1]) / 6)} ${r1(c[0])} ${r1(c[1])}`;
  }
  return d;
}

/** 畫框、格線、刻度與軸標題；回傳 SVG 片段。right：右邊另一條軸（氣候圖的降水量） */
function frame({ box, xs, ys, xLabel, yLabel, xTicks, right }) {
  const { l, r, t, b } = box;
  let s = '';
  for (const v of ys.ticks) {
    const y = r1(b - ((v - ys.min) / (ys.max - ys.min)) * (b - t));
    s += `<line class="fig-grid" x1="${l}" y1="${y}" x2="${r}" y2="${y}"/><text class="fig-tick" x="${l - 5}" y="${y + 3.5}" text-anchor="end">${fmt(v)}</text>`;
  }
  for (const [x, label, grid] of xTicks) {
    if (grid) s += `<line class="fig-grid" x1="${r1(x)}" y1="${t}" x2="${r1(x)}" y2="${b}"/>`;
    s += `<text class="fig-tick" x="${r1(x)}" y="${b + 13}" text-anchor="middle">${esc(label)}</text>`;
  }
  if (right) {
    for (const v of right.scale.ticks) {
      const y = r1(b - ((v - right.scale.min) / (right.scale.max - right.scale.min)) * (b - t));
      s += `<text class="fig-tick" x="${r + 5}" y="${y + 3.5}">${fmt(v)}</text>`;
    }
    s += `<text class="fig-label" transform="translate(${W - 3} ${(t + b) / 2}) rotate(-90)" text-anchor="middle">${esc(right.label)}</text>`;
  }
  s += `<path class="fig-axis" d="M${l} ${t}V${b}H${r}${right ? `V${t}` : ''}"/>`;
  // 橫軸跨過 0 時把 y = 0 那條線畫深一點
  if (ys.min < 0 && ys.max > 0) {
    const y0 = r1(b - ((0 - ys.min) / (ys.max - ys.min)) * (b - t));
    s += `<line class="fig-axis" x1="${l}" y1="${y0}" x2="${r}" y2="${y0}"/>`;
  }
  if (xs && xs.min < 0 && xs.max > 0) {
    const x0 = r1(l + ((0 - xs.min) / (xs.max - xs.min)) * (r - l));
    s += `<line class="fig-axis" x1="${x0}" y1="${t}" x2="${x0}" y2="${b}"/>`;
  }
  if (xLabel) s += `<text class="fig-label" x="${(l + r) / 2}" y="${H - 5}" text-anchor="middle">${esc(xLabel)}</text>`;
  s += `<text class="fig-label" transform="translate(11 ${(t + b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
  return s;
}

function plotXY(fig) {
  const pts = [...fig.series.flatMap((s) => s.points), ...(fig.marks ?? []).map((m) => [m.x, m.y])];
  const xs = scale(pts.map((p) => p[0]), fig.x);
  const ys = scale(pts.map((p) => p[1]), fig.y);
  const box = { l: 44, r: W - 14, t: 10, b: H - 36 };
  const px = (x) => box.l + ((x - xs.min) / (xs.max - xs.min)) * (box.r - box.l);
  const py = (y) => box.b - ((y - ys.min) / (ys.max - ys.min)) * (box.b - box.t);
  let s = frame({ box, xs, ys, xLabel: fig.x.label, yLabel: fig.y.label, xTicks: xs.ticks.map((v) => [px(v), fmt(v), true]) });
  fig.series.forEach((ser, k) => {
    const p = ser.points.map(([x, y]) => [px(x), py(y)]);
    if (fig.type === 'line') {
      const d = ser.smooth ? smoothPath(p) : 'M' + p.map((q) => `${r1(q[0])} ${r1(q[1])}`).join('L');
      const dash = ser.dashed ? '4 3' : DASH[k];
      s += `<path class="fig-line fig-c${k + 1}" d="${d}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    }
    if (hasDots(fig, ser)) s += p.map((q) => marker(k, q[0], q[1], `fig-dot fig-c${k + 1}`)).join('');
  });
  for (const m of fig.marks ?? []) {
    const x = px(m.x);
    const y = py(m.y);
    const left = x > box.r - 40;
    s += `<circle class="fig-mark" cx="${r1(x)}" cy="${r1(y)}" r="3"/><text class="fig-mark-label" x="${r1(x + (left ? -6 : 6))}" y="${r1(Math.max(box.t + 9, y - 6))}"${left ? ' text-anchor="end"' : ''}>${esc(m.label)}</text>`;
  }
  return s;
}

function plotBar(fig) {
  const ys = scale([0, ...fig.series.flatMap((s) => s.values)], { min: 0, ...fig.y });
  const box = { l: 44, r: W - 12, t: 10, b: H - (fig.x.label ? 36 : 22) };
  const cats = fig.x.cats;
  const band = (box.r - box.l) / cats.length;
  const n = fig.series.length;
  const bw = Math.min(26, (band * 0.76) / n);
  const py = (y) => box.b - ((y - ys.min) / (ys.max - ys.min)) * (box.b - box.t);
  let s = frame({ box, ys, xLabel: fig.x.label, yLabel: fig.y.label, xTicks: cats.map((c, i) => [box.l + band * (i + 0.5), c, false]) });
  fig.series.forEach((ser, k) => {
    ser.values.forEach((v, i) => {
      const x = box.l + band * (i + 0.5) - (bw * n) / 2 + bw * k;
      const y = py(v);
      s += `<rect class="fig-bar fig-c${k + 1}" x="${r1(x + 0.5)}" y="${r1(y)}" width="${r1(bw - 1)}" height="${r1(Math.max(0, box.b - y))}"/>`;
    });
  });
  return s;
}

function plotClimate(fig) {
  const ts = scale(fig.temp, {});
  const rs = scale([0, ...fig.rain], { min: 0 });
  const box = { l: 40, r: W - 42, t: 10, b: H - 36 };
  const band = (box.r - box.l) / MONTHS;
  const cx = (i) => box.l + band * (i + 0.5);
  const ty = (v) => box.b - ((v - ts.min) / (ts.max - ts.min)) * (box.b - box.t);
  const ry = (v) => box.b - ((v - rs.min) / (rs.max - rs.min)) * (box.b - box.t);
  let s = frame({ box, ys: ts, xLabel: '月份', yLabel: '月均溫 (°C)', xTicks: fig.temp.map((_, i) => [cx(i), String(i + 1), false]), right: { scale: rs, label: '月降水量 (mm)' } });
  s += fig.rain.map((v, i) => `<rect class="fig-bar fig-c2" x="${r1(cx(i) - band * 0.36)}" y="${r1(ry(v))}" width="${r1(band * 0.72)}" height="${r1(Math.max(0, box.b - ry(v)))}"/>`).join('');
  const p = fig.temp.map((v, i) => [cx(i), ty(v)]);
  s += `<path class="fig-line fig-c1" d="M${p.map((q) => `${r1(q[0])} ${r1(q[1])}`).join('L')}"/>` + p.map((q) => marker(0, q[0], q[1], 'fig-dot fig-c1')).join('');
  return s;
}

/** 圖例的小圖示：長條是色塊；線是一小段同樣線型的線，圖上有畫點的才加上點 */
const swatch = (k, { bar = false, dots = true, dash = DASH[k] } = {}) =>
  `<svg class="fig-key" viewBox="0 0 22 10" aria-hidden="true">${bar ? `<rect class="fig-bar fig-c${k + 1}" x="4" y="1" width="14" height="8"/>` : `<path class="fig-line fig-c${k + 1}" d="M1 5H21"${dash ? ` stroke-dasharray="${dash}"` : ''}/>${dots ? marker(k, 11, 5, `fig-dot fig-c${k + 1}`) : ''}`}</svg>`;
/** 這組資料在圖上有沒有畫出每個點：曲線（很多點連成的函數圖形）不畫，資料點才畫 */
const hasDots = (fig, ser) => fig.type === 'scatter' || (!ser.smooth && ser.points.length <= 12);

/**
 * 圖表的 HTML。rich：把一段文字（可能含 $…$ 公式）轉成 HTML 的函式，只有表格的儲存格與標題會用到；
 * 沒給就只做跳脫（測試用）。
 */
export function figureHTML(fig, rich = esc) {
  const title = fig.title ? `<figcaption class="fig-title">${fig.type === 'table' ? rich(fig.title) : esc(fig.title)}</figcaption>` : '';
  if (fig.type === 'table') {
    const head = fig.cols.map((c) => `<th scope="col">${rich(String(c))}</th>`).join('');
    const body = fig.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${rich(typeof c === 'number' ? fmt(c) : c)}</td>` : `<th scope="row">${rich(typeof c === 'number' ? fmt(c) : c)}</th>`)).join('')}</tr>`).join('');
    return `<figure class="fig fig-table-wrap">${title}<table class="fig-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></figure>`;
  }
  const inner = fig.type === 'bar' ? plotBar(fig) : fig.type === 'climate' ? plotClimate(fig) : plotXY(fig);
  let legend = '';
  if (fig.type === 'climate') legend = `<ul class="fig-legend"><li>${swatch(0)}月均溫</li><li>${swatch(1, { bar: true })}月降水量</li></ul>`;
  else if (fig.series.some((s) => s.name)) {
    const key = (s, k) => (fig.type === 'bar' ? swatch(k, { bar: true }) : swatch(k, { dots: hasDots(fig, s), dash: fig.type === 'scatter' ? '0 99' : s.dashed ? '4 3' : DASH[k] }));
    legend = `<ul class="fig-legend">${fig.series.map((s, k) => `<li>${key(s, k)}${esc(s.name ?? '')}</li>`).join('')}</ul>`;
  }
  return `<figure class="fig">${title}<svg class="fig-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(figureText(fig))}">${inner}</svg>${legend}</figure>`;
}

// ── 文字敘述 ─────────────────────────────────────────

const KIND = { line: '折線圖', scatter: '散布圖', bar: '長條圖', climate: '氣候圖', table: '表' };

/** 圖表的文字敘述：螢幕閱讀器念的、複製給 AI 的（AI 看不到圖，要把數據寫出來） */
export function figureText(fig) {
  const head = `${KIND[fig.type]}${fig.title ? `「${fig.title}」` : ''}`;
  if (fig.type === 'table') return `${head}：${fig.cols.join('｜')}；${fig.rows.map((r) => r.map((c) => (typeof c === 'number' ? fmt(c) : c)).join('｜')).join('；')}`;
  if (fig.type === 'climate') return `${head}（1–12 月）：月均溫 ${fig.temp.map(fmt).join('、')} °C；月降水量 ${fig.rain.map(fmt).join('、')} mm`;
  if (fig.type === 'bar') {
    const rows = fig.x.cats.map((c, i) => `${c} ${fig.series.map((s) => `${s.name ? `${s.name} ` : ''}${fmt(s.values[i])}`).join('、')}`);
    return `${head}，${fig.x.label ? `橫軸：${fig.x.label}，` : ''}縱軸：${fig.y.label}。${rows.join('；')}`;
  }
  const series = fig.series.map((s) => `${s.name ? `${s.name}：` : ''}${s.points.map((p) => `(${fmt(p[0])}, ${fmt(p[1])})`).join('、')}`);
  const marks = fig.marks?.length ? `。標記的點：${fig.marks.map((m) => `${m.label}(${fmt(m.x)}, ${fmt(m.y)})`).join('、')}` : '';
  return `${head}，橫軸：${fig.x.label}，縱軸：${fig.y.label}。${series.join('；')}${marks}`;
}
