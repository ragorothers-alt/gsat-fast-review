// 新題的出題順序：學測考得多、而且你還不熟的單元先出，每天的新題花在最有用的地方。
//   單元的優先度 = 學測裡的分量 ×（還要加強的程度 + 探索加成）
//   分量：各科照考卷分（每張考卷一樣重，見 blueprint.js），科內照各單元在歷屆學測的出題占比；
//   還要加強的程度：這個單元練過的題目裡，第一次就答對、之後也沒失手的比例越低，越要加強；
//   探索加成：練得少的單元先多試幾題，才知道熟不熟。
// 單元裡再依熟練度挑難度：還不熟先出基礎題，熟了改出難題與演算題。純邏輯，不碰 DOM。
import { UNIT_SHARE, subjectWeights } from './blueprint.js';
import { bundles } from './groups.js';
import { UNITS, unitKey } from './units.js';

/** 學測很少考的單元也保留一點分量：科內占比（%）的下限 */
const SHARE_FLOOR = 2;
/** 熟練度的先驗：還沒練過的單元當作一半會、一半不會（相當於先看過 PRIOR 題） */
const PRIOR = 2;
/** 探索加成：練過 n 題的單元加 EXPLORE / √(1 + n) */
const EXPLORE = 0.5;
/** 再熟的單元也偶爾出新題，免得生疏 */
const MIN_NEED = 0.08;

/**
 * 選的科目裡，各單元在學測的分量（合計為 1）
 * @returns {Map<string, number>} unitKey → 分量
 */
export function unitShares(subjects) {
  const sw = subjectWeights(subjects);
  const out = new Map();
  for (const subject of subjects) {
    const units = UNITS[subject] ?? [];
    const pct = units.map((u) => Math.max(SHARE_FLOOR, UNIT_SHARE[subject]?.[u] ?? 0));
    const total = pct.reduce((a, b) => a + b, 0);
    units.forEach((u, i) => out.set(unitKey(subject, u), ((sw[subject] ?? 0) * pct[i]) / total));
  }
  return out;
}

/**
 * 各單元練得怎麼樣：練過幾題（n）、其中第一次就答對而且之後沒失手的有幾題（known），估計的熟練度 p（0–1）
 * @param {(card: Card | undefined) => boolean} isKnown 答對過、從沒失手（srs.js 的 neverMissed）
 * @returns {Map<string, { n: number, known: number, p: number }>}
 */
export function unitSkill(bank, cards, subjects, isKnown) {
  const wanted = new Set(subjects);
  const out = new Map();
  for (const q of bank) {
    const c = cards[q.id];
    if (!c?.seen || !wanted.has(q.subject)) continue;
    const key = unitKey(q.subject, q.topic);
    const u = out.get(key) ?? out.set(key, { n: 0, known: 0, p: 0.5 }).get(key);
    u.n++;
    if (isKnown(c)) u.known++;
  }
  for (const u of out.values()) u.p = (u.known + PRIOR / 2) / (u.n + PRIOR);
  return out;
}

/** 單元的優先度：分量 ×（還要加強的程度 + 探索加成） */
export function unitPriority(share, skill) {
  const n = skill?.n ?? 0;
  const p = skill?.p ?? 0.5;
  return share * (Math.max(MIN_NEED, 1 - p) + EXPLORE / Math.sqrt(1 + n));
}

/** 單元裡各難度的權重：還不熟多出 level 1、2，熟了多出 level 3（含演算題） */
export function levelWeight(level, p) {
  if (level === 1) return 0.1 + (1 - p) ** 2;
  if (level === 3) return 0.1 + p ** 2;
  return 0.6;
}

/** 題組算在哪個單元：組裡最多題的單元（一樣多就取前面那題的） */
function packUnit(pack) {
  const count = new Map();
  for (const q of pack) {
    const key = unitKey(q.subject, q.topic);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  let best = null;
  for (const [key, n] of count) if (!best || n > count.get(best)) best = key;
  return best;
}

/** 考點的鍵：科目/考點代號（q.kp）；還沒標考點的題目是 null */
export const conceptKey = (q) => (q.kp ? `${q.subject}/${q.kp}` : null);

/**
 * 各考點練得怎麼樣：題庫裡有幾題（size）、其中作答過幾題（seen）。
 * 跨單元綜合的題目標的是別的單元的考點，所以考點照科目算、不分單元。
 * @returns {Map<string, { size: number, seen: number }>} conceptKey → 題數
 */
export function conceptStats(bank, cards, subjects) {
  const wanted = new Set(subjects);
  const out = new Map();
  for (const q of bank) {
    const key = conceptKey(q);
    if (!key || !wanted.has(q.subject)) continue;
    const c = out.get(key) ?? out.set(key, { size: 0, seen: 0 }).get(key);
    c.size++;
    if (cards[q.id]?.seen) c.seen++;
  }
  return out;
}

/**
 * 考點練過的程度（越小越該先出）：沒練過是 0；練過的除以考點大小的平方根——題目多的考點變化也多，
 * 每個考點都碰過一輪之後，大的考點多分到一些
 */
const conceptLoad = (c) => (c ? c.seen / Math.sqrt(c.size) : 0);

/** 題組算在哪個考點：組裡第一題有標的考點 */
const packConcept = (pack) => pack.map(conceptKey).find(Boolean) ?? null;

/**
 * 新題的出題順序：每個位置先依單元優先度抽一個單元，再出這個單元裡最該出的題目——
 * 先看考點：還沒練過的考點先出，同一個考點不連著出好幾題（conceptLoad 最小的；沒標考點的題目不比這一項）；
 * 考點一樣該出時照難度：單元裡的題目事先依難度權重做加權隨機排序（每題的鍵是 u^(1/權重)，大的先出）。
 * 一個單元隨機抽 15 題平均只碰到 11 個考點，照考點出就是 15 個：同樣的題數，練到的觀念多兩三成。
 * 閱讀題組整組一起出：一組算一個候選，歸到組裡最多題的單元，難度權重取各題的平均。
 * @param {Question[]} fresh 還沒做過的題目（已依模式篩好）
 * @param {{ shares: Map<string, number>, skill: Map<string, { n: number, p: number }>, concepts?: Map<string, { size: number, seen: number }>, size: number, rng?: () => number }} opts
 *   concepts：conceptStats 的結果；沒給就不看考點
 * @returns {Question[]} 最多 size 題（最後一個題組放不下時整組照出）；同組的題目排在一起
 */
export function orderFresh(fresh, { shares, skill, concepts = new Map(), size, rng = Math.random }) {
  // 這一輪排進去的題目也算練過，同一個考點才不會在同一輪連出
  const load = new Map([...concepts].map(([key, c]) => [key, { ...c }]));
  /** 這個單元裡最該出的那一包的位置：考點最沒練過的，一樣就取排在前面的 */
  const pick = (packs) => {
    let best = 0;
    let bestLoad = Infinity;
    for (let i = 0; i < packs.length && bestLoad > 0; i++) {
      const key = packConcept(packs[i]);
      const v = key ? conceptLoad(load.get(key)) : 0;
      if (v < bestLoad) [best, bestLoad] = [i, v];
    }
    return best;
  };
  const groups = new Map();
  for (const pack of bundles(fresh)) {
    const key = packUnit(pack);
    (groups.get(key) ?? groups.set(key, []).get(key)).push(pack);
  }
  const pools = [...groups].map(([key, packs]) => {
    const p = skill.get(key)?.p ?? 0.5;
    const weight = (pack) => pack.reduce((a, q) => a + levelWeight(q.level, p), 0) / pack.length;
    const ranked = packs.map((pack) => [rng() ** (1 / weight(pack)), pack]).sort((a, b) => b[0] - a[0]);
    // 不在學測藍圖裡的單元（理論上不會有）給極小的權重：別的單元都出完了才出
    return { w: unitPriority(shares.get(key) ?? 0, skill.get(key)) || 1e-9, packs: ranked.map(([, pack]) => pack) };
  });
  const out = [];
  let total = pools.reduce((a, u) => a + u.w, 0);
  while (out.length < size && pools.length) {
    let r = rng() * total;
    let i = 0;
    while (i < pools.length - 1 && (r -= pools[i].w) > 0) i++;
    const pool = pools[i];
    const [pack] = pool.packs.splice(pick(pool.packs), 1);
    for (const key of new Set(pack.map(conceptKey))) {
      const c = key && load.get(key);
      if (c) c.seen++;
    }
    out.push(...pack);
    if (!pool.packs.length) {
      pools.splice(i, 1);
      total -= pool.w;
    }
  }
  return out;
}
