// 題庫與考前重點卡共用的文字檢查：非空、沒有控制字元、$ 成對、LaTeX 解析得了、長度（公式約三個字元算一個字）
import katex from 'katex';
import { splitMath } from '../src/rich-text.js';

const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f]/;
const CJK = /[㐀-鿿]/;

/** \mathrm{...} 的最外層有 + 或箭頭：KaTeX 把整組當成一塊，不能在中間換行 */
export function equationInMathrm(tex) {
  for (let at = tex.indexOf('\\mathrm{'); at >= 0; at = tex.indexOf('\\mathrm{', at + 1)) {
    let depth = 0;
    for (let i = at + 8; i < tex.length; i++) {
      const ch = tex[i];
      if (ch === '{') depth++;
      else if (ch === '}' && depth-- === 0) break;
      else if (depth === 0 && ((ch === '+' && tex[i - 1] !== '^') || /^\\(rightarrow|rightleftharpoons|longrightarrow|to)(?![a-zA-Z])/.test(tex.slice(i)))) return true;
    }
  }
  return false;
}

/**
 * @param {unknown} value 要檢查的文字
 * @param {string} field 錯誤訊息裡的欄位名稱
 * @param {number} max 超過就是錯誤；warnAt：超過就警告
 * @param {(m: string) => void} err
 * @param {(m: string) => void} warn
 */
export function checkText(value, field, max, warnAt, err, warn) {
  if (typeof value !== 'string' || !value.trim()) return err(`${field} 必須是非空字串`);
  if (CONTROL_CHARS.test(value)) {
    return err(`${field} 含控制字元——多半是 JSON 裡的 LaTeX 反斜線沒有寫成兩個（例如 "\\frac" 要寫 "\\\\frac"）`);
  }
  const { segments, balanced } = splitMath(value);
  if (!balanced) err(`${field} 的 $ 沒有成對`);
  let visible = 0;
  for (const seg of segments) {
    if (!seg.math) {
      visible += seg.text.length;
      continue;
    }
    visible += Math.ceil(seg.text.length / 3);
    if (seg.text.includes('\n')) err(`${field} 的公式內不可換行`);
    try {
      katex.renderToString(seg.text, { throwOnError: true, strict: 'ignore' });
    } catch (e) {
      err(`${field} 的 LaTeX 無法解析：$${seg.text}$ — ${e.message.split('\n')[0]}`);
    }
    if (CJK.test(seg.text.replace(/\\text\{[^}]*\}/g, ''))) warn(`${field} 的公式內有中文，請改用 \\text{} 或移到 $ 外`);
    if (equationInMathrm(seg.text)) {
      err(`${field} 的整條方程式包在同一個 \\mathrm{} 裡，手機上無法換行；請每個化學式各自包，例如 $\\mathrm{H_2}+\\mathrm{Cl_2}\\rightarrow\\mathrm{2HCl}$`);
    }
  }
  if (visible > max) err(`${field} 太長（約 ${visible} 字，上限 ${max}）`);
  else if (visible > warnAt) warn(`${field} 偏長（約 ${visible} 字，建議 ≤ ${warnAt}）`);
}
