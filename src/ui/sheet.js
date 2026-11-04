// 底部彈出面板（.sheet）的共同行為，像原生的對話框一樣：
// - 打開時焦點移進面板，背後的畫面與其他面板設成 inert（鍵盤、螢幕閱讀器都碰不到）
// - 面板可以疊（例如單元面板上再開重點卡）：Esc 只關最上層，作答的快捷鍵也不會穿過面板
// - 關閉時焦點回到打開它的按鈕
const stack = [];

/** 最上層開著的面板；沒有就是 null */
export function topSheet() {
  return stack.at(-1)?.sheet ?? null;
}

/**
 * @param {HTMLElement} sheet
 * @param {{ focus?: HTMLElement | null }} [opts] focus：打開後要聚焦的元素，預設是面板的標題列（不會跳出手機鍵盤）
 */
export function openSheet(sheet, { focus = null } = {}) {
  if (!stack.some((e) => e.sheet === sheet)) stack.push({ sheet, opener: document.activeElement });
  sheet.hidden = false;
  sync();
  const target = focus ?? sheet.querySelector('[role="dialog"]') ?? sheet;
  if (!target.hasAttribute('tabindex') && !target.matches('button, input, select, textarea, a[href]')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

/** 關閉面板；是最上層的話，焦點回到打開它的地方 */
export function closeSheet(sheet) {
  sheet.hidden = true;
  const i = stack.findIndex((e) => e.sheet === sheet);
  if (i < 0) return;
  const [{ opener }] = stack.splice(i, 1);
  sync();
  if (i === stack.length && opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus({ preventScroll: true });
}

/** 一次收起所有面板（例如從重點卡直接開始練習） */
export function closeAllSheets() {
  for (const { sheet } of [...stack].reverse()) closeSheet(sheet);
  for (const sheet of document.querySelectorAll('.sheet')) sheet.hidden = true;
}

/** 面板開著時，背後的東西都設成 inert；提示訊息（#toast）照常讓螢幕閱讀器念 */
function sync() {
  const top = topSheet();
  for (const el of document.body.children) {
    if (el.id === 'toast' || el.tagName === 'SCRIPT') continue;
    el.inert = !!top && el !== top;
  }
}

/** 面板的 Esc：只有最上層的面板會關（capture 階段先攔下，作答畫面的 Esc 不會同時結束這一輪）。單元測試沒有 window 就略過 */
globalThis.window?.addEventListener(
  'keydown',
  (e) => {
    const top = topSheet();
    if (!top || e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    top.dispatchEvent(new CustomEvent('sheet-close'));
  },
  { capture: true },
);
