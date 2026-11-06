// 演算題的填答：選項都是數值的演算題，可以不看選項、自己算出答案填進去（像學測的選填題），
// 這裡把選項（LaTeX 分數、小數、帶單位）和玩家填的答案轉成數字比對。純邏輯，不碰 DOM。

/**
 * 選項的數值：整數、小數、分數（a/b 或 \frac{a}{b}），可帶負號與共同的單位；
 * 根號、π、科學記號這類不好在手機上填的回傳 null。
 * @returns {{ value: number, unit: string } | null}
 */
export function choiceValue(choice) {
  const s = String(choice)
    .replace(/\$/g, '')
    .replace(/\\[,;!: ]|\\quad/g, '')
    .replace(/\\%/g, '%')
    // \frac{a}{b}、\frac ab、\frac5{24}：分子分母可以是大括號或單一位數
    .replace(/\\[dt]?frac\s*(?:\{(-?[\d.]+)\}|(\d))\s*(?:\{([\d.]+)\}|(\d))/g, (_, a1, a2, b1, b2) => `${a1 ?? a2}/${b1 ?? b2}`)
    .replace(/\\text\{([^}]*)\}|\\mathrm\{([^}]*)\}/g, '$1$2')
    .replace(/[−–]/g, '-')
    .replace(/\s+/g, '');
  const m = s.match(/^(-?)(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?(.*)$/);
  if (!m) return null;
  const [, sign, a, b, unit] = m;
  // 數字後面只能接單位：還有數字或公式記號（\sqrt、×10^、π）的不算單純數值
  if (unit.length > 8 || /[\d\\^_{}×π√()（）,，、]/.test(unit)) return null;
  if (b !== undefined && Number(b) === 0) return null;
  return { value: (sign ? -1 : 1) * (b !== undefined ? Number(a) / Number(b) : Number(a)), unit };
}

/** 這題能不能用填答作答：演算題、四個選項都是同單位的數值 */
export function fillable(q) {
  if (!q?.scratch || q.type !== 'mc') return false;
  const vals = q.choices.map(choiceValue);
  return vals.every(Boolean) && new Set(vals.map((v) => v.unit)).size === 1;
}

/** 填答的單位（顯示在輸入框後面），沒有單位是空字串 */
export function fillUnit(q) {
  return choiceValue(q.choices[0])?.unit ?? '';
}

/** 玩家填的字（數字、小數點、負號、分數線）轉成數值；格式不對回傳 null */
export function parseTyped(text) {
  const m = String(text).trim().replace(/[−–]/g, '-').match(/^(-?)(\d+(?:\.\d+)?|\.\d+)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const [, sign, a, b] = m;
  if (b !== undefined && Number(b) === 0) return null;
  return (sign ? -1 : 1) * (b !== undefined ? Number(a) / Number(b) : Number(a));
}

/**
 * 填的答案和哪個選項的數值相同（原始選項索引）；都不同回傳 -1。
 * 比的是數值，所以 0.75、3/4、.75 都算同一個答案；不接受四捨五入的近似值（選項設計成算得出精確值）
 */
export function matchTyped(q, value) {
  return q.choices.findIndex((c) => {
    const v = choiceValue(c);
    return v && Math.abs(v.value - value) <= 1e-9 * Math.max(1, Math.abs(v.value));
  });
}
