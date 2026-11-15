// 圖表放大：題目卡上的圖（折線、散布、長條、氣候圖）下面一顆「放大」，點了開面板：
// 圖照面板寬度放大、小手機上稍微左右捲（刻度約 14px 以上，看得清楚），下面列出圖的數據表讀確切數值。
// 小手機、特大字時題目卡把圖縮到 272px，刻度只剩 8 px 多；鍵盤也按得到（一般的按鈕）
import { figureRows } from '../figure.js';
import { closeSheet, openSheet } from './sheet.js';

/** 圖的元素 → 題目的 fig（畫數據表用） */
const figs = new WeakMap();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * 在 root 裡的圖（不含資料表）加上「放大」按鈕。題目卡每換一題重畫，要再加一次
 * @param {HTMLElement} root
 * @param {object | undefined} fig 題目的 fig 欄位
 */
export function addFigZoom(root, fig) {
  const el = root.querySelector('.fig');
  if (!fig || fig.type === 'table' || !el?.querySelector('.fig-svg')) return;
  figs.set(el, fig);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fig-zoom-btn';
  btn.textContent = '放大';
  btn.setAttribute('aria-label', '放大圖表、看數據');
  // 不疊在圖上（會蓋到資料點）：有圖例就排在圖例那一行的最後，沒有就在圖下面自成一小行、靠右
  const legend = el.querySelector('.fig-legend');
  const holder = document.createElement(legend ? 'li' : 'div');
  holder.className = legend ? 'fig-zoom-li' : 'fig-zoom-row';
  holder.append(btn);
  (legend ?? el).append(holder);
}

export function initFigZoom() {
  const sheet = /** @type {HTMLElement} */ (document.querySelector('#fig-sheet'));
  const box = /** @type {HTMLElement} */ (document.querySelector('#fig-zoom'));
  const table = /** @type {HTMLElement} */ (document.querySelector('#fig-data'));
  const title = /** @type {HTMLElement} */ (document.querySelector('#fig-sheet-title'));

  function open(el) {
    const fig = figs.get(el);
    const copy = /** @type {HTMLElement} */ (el.cloneNode(true));
    copy.querySelector('.fig-zoom-li, .fig-zoom-row')?.remove();
    // 放大的圖不用再念一次整串數據（下面有表）：保留圖的名稱就好
    copy.querySelector('.fig-svg')?.setAttribute('aria-label', fig?.title ? `圖表「${fig.title}」` : '圖表');
    box.replaceChildren(copy);
    title.textContent = fig?.title || '圖表';
    const rows = fig ? figureRows(fig) : null;
    table.hidden = !rows;
    table.innerHTML = rows
      ? `<caption>圖的數據</caption><thead><tr>${rows.cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.rows
          .map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`)
          .join('')}</tbody>`
      : '';
    openSheet(sheet, { focus: document.querySelector('#fig-sheet-close') });
    box.scrollLeft = 0;
  }

  document.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target)?.closest?.('.fig-zoom-btn');
    const el = btn?.closest('.fig');
    if (el) open(el);
  });
  const close = () => closeSheet(sheet);
  document.querySelector('#fig-sheet-close')?.addEventListener('click', close);
  sheet.addEventListener('sheet-close', close);
  sheet.addEventListener('click', (e) => e.target === sheet && close());
}
