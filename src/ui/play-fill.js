// 演算題填答的數字鍵盤：按鍵表、鍵盤的 HTML、按一個鍵之後答案字串怎麼變。
// 只有字串處理，不碰作答狀態（填到哪、能不能按，由 ui/play.js 管）

/** 填答的按鍵（四欄）：[鍵, 顯示的字, 給螢幕閱讀器的名稱] */
const FILL_KEYS = [
  ['7', '7'], ['8', '8'], ['9', '9'], ['back', '⌫', '刪除'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−', '負號'],
  ['1', '1'], ['2', '2'], ['3', '3'], ['/', '／', '分數線'],
  ['0', '0'], ['.', '.', '小數點'],
];
/** 填答最多幾個字 */
export const FILL_MAX = 12;

/** 作答區的內容：上面是填好的答案與單位，下面是數字鍵盤、「送出」和「改用選項作答」 */
export function fillHTML() {
  return `<div class="fill-box"><output class="fill-value" aria-label="你填的答案"></output><span class="fill-unit"></span></div>
      <div class="fill-keys">${FILL_KEYS.map(([k, label, name]) => `<button type="button" class="fill-key" data-k="${k}"${name ? ` aria-label="${name}"` : ''}>${label}</button>`).join('')}<button type="button" class="fill-key fill-send" data-k="ok">送出</button></div>
      <button type="button" class="fill-switch">算不出來？改用選項作答</button>`;
}

/**
 * 按一個填答鍵之後的答案字串：數字、小數點、負號（切換）、分數線、刪除。
 * @param {string} text 目前填的字
 * @param {string} k 鍵：'0'–'9'、'.'、'-'、'/'、'back'；其他的鍵不改變內容
 * @returns {string | null} 新的字串；超過 FILL_MAX 個字時是 null（這一鍵不算）
 */
export function typeFillKey(text, k) {
  let t = text;
  if (k === 'back') t = t.slice(0, -1);
  else if (k === '-') t = t.startsWith('-') ? t.slice(1) : `-${t}`;
  else if (k === '/') t += /\d$/.test(t) && !t.includes('/') ? '/' : '';
  else if (k === '.') {
    // 分子、分母各自最多一個小數點；還沒有數字就補 0
    const part = t.split('/').pop().replace('-', '');
    if (!part.includes('.')) t += part ? '.' : '0.';
  } else if (/^\d$/.test(k)) t += k;
  return t.length > FILL_MAX ? null : t;
}

/**
 * 實體鍵盤的按鍵對應到哪個填答鍵：數字、小數點、負號、分數線照打，Backspace 刪除、Enter 送出（'ok'）。
 * @param {string} key KeyboardEvent.key
 * @returns {string | null} 不是填答用的鍵時是 null
 */
export function fillKeyFor(key) {
  return { Backspace: 'back', Enter: 'ok' }[key] ?? (/^[\d./-]$/.test(key) ? key : null);
}
