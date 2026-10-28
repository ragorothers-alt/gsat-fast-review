// 題目文字格式：一般文字中以 `$...$` 夾住 LaTeX 行內公式，`\$` 代表字面上的錢字號。
// 只做切割，不碰 DOM，驗證腳本與 App 共用。

/**
 * @param {string} text
 * @returns {{ segments: { math: boolean, text: string }[], balanced: boolean }}
 */
export function splitMath(text) {
  const segments = [];
  let buf = '';
  let inMath = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && text[i + 1] === '$' && !inMath) {
      buf += '$';
      i++;
      continue;
    }
    if (ch === '$') {
      if (buf) segments.push({ math: inMath, text: buf });
      buf = '';
      inMath = !inMath;
      continue;
    }
    buf += ch;
  }
  // 未閉合的 `$` 之後全部當一般文字顯示
  if (buf) segments.push({ math: false, text: inMath ? '$' + buf : buf });
  return { segments, balanced: !inMath };
}
