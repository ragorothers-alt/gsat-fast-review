// 手繪風的小圖示：圖形放在 index.html 開頭的 SVG sprite（<symbol id="i-…">），這裡只產生引用它的標記。
// 描邊用 currentColor，跟著文字顏色走；是非題的 ok／ng 自帶綠／紅。

/** @param {string} name symbol id 去掉開頭的 i-，例如 'flag'、'star'、'ok' */
export function icon(name, cls = '') {
  return `<svg class="ico${cls ? ` ${cls}` : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
