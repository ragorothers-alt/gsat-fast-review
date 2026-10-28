// 把題目文字（含 $...$ 公式）轉成 HTML
import katex from 'katex';
import { splitMath } from '../rich-text.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

export function richHTML(text) {
  return splitMath(String(text))
    .segments.map((seg) =>
      seg.math
        ? katex.renderToString(seg.text, { throwOnError: false, strict: 'ignore' })
        : escape(seg.text).replace(/\n/g, '<br>'),
    )
    .join('');
}

/** 估計顯示長度（公式字元大約三個算一字），用來決定選項排成一欄或兩欄 */
export function visibleLength(text) {
  return splitMath(String(text)).segments.reduce((n, s) => n + (s.math ? Math.ceil(s.text.length / 3) : s.text.length), 0);
}
