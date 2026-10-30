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

// ── 公式的純文字念法 ─────────────────────────────
// Chrome 算按鈕名稱時不讀 <math> 裡的字，只有公式的選項按鈕會變成沒有名字，
// 所以從 KaTeX 產生的 MathML 轉回一行念得出來的文字（x²、H₂O、(√3+1)/2）

const SUP = { ...unicodeDigits('⁰¹²³⁴⁵⁶⁷⁸⁹'), '+': '⁺', '−': '⁻', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', '∘': '°' };
const SUB = { ...unicodeDigits('₀₁₂₃₄₅₆₇₈₉'), '+': '₊', '−': '₋', '-': '₋', '=': '₌', '(': '₍', ')': '₎' };

function unicodeDigits(chars) {
  return Object.fromEntries([...chars].map((c, i) => [i, c]));
}

/** 上下標每個字都有 Unicode 版就換過去，否則寫成 ^(…)、_(…) */
function script(s, map, mark) {
  const chars = [...s];
  return chars.length && chars.every((c) => map[c]) ? chars.map((c) => map[c]).join('') : mark + group(s);
}

/** 分子、分母、根號裡不只一個數或字母時加括號，免得 1/2a 有兩種念法 */
const group = (s) => (/^[−-]?(\d+(\.\d+)?|\p{L})$/u.test(s) ? s : `(${s})`);

function mathText(node) {
  const kids = [...node.children];
  const part = (i) => (kids[i] ? mathText(kids[i]) : '');
  const all = (sep = '') => kids.map(mathText).join(sep);
  switch (node.localName) {
    case 'annotation':
    case 'annotation-xml':
    case 'mphantom':
      return '';
    case 'semantics':
      return part(0);
    case 'mi':
    case 'mn':
    case 'mo':
    case 'mtext':
    case 'ms':
      // \sin x 之間的「函數套用」是看不見的字元，換成空白才不會念成 sinx
      return node.textContent.replace(/[⁡-⁤]/g, ' ');
    case 'mspace':
      return ' ';
    case 'mfrac':
      return `${group(part(0))}/${group(part(1))}`;
    case 'msqrt':
      return `√${group(all())}`;
    case 'mroot':
      return `${script(part(1), SUP, '')}√${group(part(0))}`;
    case 'msup':
      return part(0) + script(part(1), SUP, '^');
    case 'msub':
      return part(0) + script(part(1), SUB, '_');
    case 'msubsup': {
      const sub = script(part(1), SUB, '_');
      const sup = script(part(2), SUP, '^');
      // 左上下標（¹²₆C）沒有底：照寫法先上後下
      return part(0) ? part(0) + sub + sup : sup + sub;
    }
    case 'mtable':
      return all('; ');
    case 'mtr':
      return all(', ');
    default:
      return all();
  }
}

/** 已經畫好的題目文字（richHTML 的結果）轉成念得出來的一行純文字 */
export function plainText(root) {
  const walk = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) s += n.data;
      else if (n.nodeType !== Node.ELEMENT_NODE || n.getAttribute('aria-hidden') === 'true') continue;
      else if (n.localName === 'math') s += mathText(n);
      else s += n.localName === 'br' ? ' ' : walk(n);
    }
    return s;
  };
  return walk(root).replace(/\s+/g, ' ').trim();
}

/** 估計顯示長度（公式字元大約三個算一字），用來決定選項排成一欄或兩欄 */
export function visibleLength(text) {
  return splitMath(String(text)).segments.reduce((n, s) => n + (s.math ? Math.ceil(s.text.length / 3) : s.text.length), 0);
}
