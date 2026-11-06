// 閱讀題組：讀一篇文章連答幾題（同一個 group、共用 passage）。純邏輯，不碰 DOM，方便測試。
// 每題仍各自排程（間隔重複照常一題一題算），只是出題時同組的題目排在一起、照題號順序出，
// 文章只在換到新的題組時從頭讀一次。

/** 題號的數字部分：同組的題目照它排（克漏字的空格順序與題號一致，驗證器會檢查） */
const idNumber = (q) => Number(q.id.slice(q.id.lastIndexOf('-') + 1));

/**
 * 把題目分成一包一包：沒有題組的一題一包；同組的題目併成一包，放在這組第一次出現的位置，包裡照題號排。
 * @param {object[]} list
 * @returns {object[][]}
 */
export function bundles(list) {
  const out = [];
  const byGroup = new Map();
  for (const q of list) {
    if (!q.group) {
      out.push([q]);
      continue;
    }
    const pack = byGroup.get(q.group);
    if (pack) pack.push(q);
    else {
      const fresh = [q];
      byGroup.set(q.group, fresh);
      out.push(fresh);
    }
  }
  for (const pack of byGroup.values()) pack.sort((a, b) => idNumber(a) - idNumber(b));
  return out;
}

/** 同組的題目排在一起（其他題目的順序不變） */
export const keepTogether = (list) => bundles(list).flat();

/**
 * 依序取到 size 題，題組不拆開：最後一包放不下也整包放進來（最多多出一組的題數）
 * @param {object[][]} packs
 */
export function takeBundles(packs, size) {
  const out = [];
  for (const pack of packs) {
    if (out.length >= size) break;
    out.push(...pack);
  }
  return out;
}

/** 題幹問的是文章裡的哪一個空格（__3__ → 3）；不是克漏字就是 null */
export function blankOf(q) {
  const m = q.group ? /__(\d+)__/.exec(q.q) : null;
  return m ? Number(m[1]) : null;
}

/** 文章裡有沒有克漏字的空格 */
export const isCloze = (passage) => /__\d+__/.test(passage);
