// 間隔重複（Leitner 盒子）與出題順序。純邏輯，不碰 DOM，方便測試。
import { orderFresh, unitShares, unitSkill } from './priority.js';
import { isUnitOff, unitKey } from './units.js';

export const MINUTE = 60_000;
export const DAY = 86_400_000;
// 第 n 盒答對後隔多久再出現。答錯過的題目隔 16 天還答得對，就拉長到 35 天：已經記牢的題目少複習幾次，
// 時間留給新題與還不熟的題目（以前停在 16 天，失手過的題目越積越多）
export const INTERVALS = [1 * MINUTE, 10 * MINUTE, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
export const MAX_BOX = INTERVALS.length - 1;
/** 答錯過的題目隔開時間答對到這一盒（隔 16 天），熟練度就算滿 */
export const LEARNED_BOX = 5;

/**
 * 依作答結果更新一張卡片的排程。
 * 按「不會？看解答」（skip）在排程上等同答錯：回到第 0 盒、1 分鐘後到期；
 * 只是不算進答錯次數（wrong），也不打斷畫面的節奏。
 * 答對後自己標「猜的」（guess）等同不會；標「不太確定」（unsure）10 分鐘後再考，
 * 兩者都不算答對次數，所以會留在錯題本，之後隔開時間答對才離開。
 * 還沒到期就又答對（例如連刷好幾輪錯題）不升盒、排程照舊：間隔重複要隔開時間答對才算數。
 * missed：失手過就記 1，之後不再變回 0（同步合併時取較大值，見 everMissed）。
 * @param {object|undefined} card 舊紀錄（沒看過則為 undefined）
 * @param {'right'|'wrong'|'skip'|'guess'|'unsure'} outcome skip = 不會、直接看解答
 * @param {number} now
 */
export function schedule(card, outcome, now) {
  const c = { box: 0, due: 0, seen: 0, right: 0, wrong: 0, parked: false, ...card };
  c.missed = everMissed(card) || outcome !== 'right' ? 1 : 0;
  c.seen++;
  c.last = now;
  if (outcome === 'right') {
    c.right++;
    c.parked = false;
    // 還沒到期：記下這次答對，但盒子與到期時間不變
    if (card && now < card.due) return c;
    // 第一次見到就答對：直接跳到隔天再考
    c.box = c.seen === 1 ? 2 : Math.min(MAX_BOX, c.box + 1);
  } else if (outcome === 'unsure') {
    c.box = 1;
    c.parked = false;
  } else {
    if (outcome === 'wrong') c.wrong++;
    // parked：最近一次是按「不會」或自己說是猜的
    c.parked = outcome === 'skip' || outcome === 'guess';
    c.box = 0;
  }
  c.due = now + INTERVALS[c.box];
  return c;
}

/**
 * 錯題本：答錯或按過「不會」（seen > right），而且還沒升到第 3 盒——
 * 也就是之後要隔開時間再答對兩三次，才算真的學會、離開錯題本。
 */
export function isWeak(card) {
  return !!card && (card.parked || ((card.wrong > 0 || card.seen > card.right) && card.box < 3));
}

/**
 * 失手過：答錯、按過「不會」或標成猜的、不太確定。
 * 新紀錄看 missed；舊紀錄沒有這個欄位，從次數與盒子推回來：從沒失手的題目一定在第 2 盒以上、答對次數等於作答次數。
 */
export function everMissed(card) {
  return !!card && !!(card.missed || card.wrong || card.right < card.seen || card.parked || card.box < 2);
}

/**
 * 答對過、而且從沒失手：已經會了，之後不再出。只要失手過一次，就照間隔重複繼續複習。
 */
export function neverMissed(card) {
  return !!card && card.seen > 0 && !everMissed(card);
}

/** 熟練度 0–1：每題的盒子數平均（到 LEARNED_BOX 算滿），沒看過算 0；答對過、從沒失手的不再複習，算滿 */
export function mastery(questions, cards) {
  if (!questions.length) return 0;
  let sum = 0;
  for (const q of questions) {
    const c = cards[q.id];
    sum += neverMissed(c) ? LEARNED_BOX : Math.min(c?.box ?? 0, LEARNED_BOX);
  }
  return sum / (questions.length * LEARNED_BOX);
}

/**
 * 到期的複習先出，但每 NEW_EVERY 題留一題給新題：複習多的時候少排新題，免得複習越積越多；
 * 又不會整輪都是複習、完全沒有新進度。一邊出完了就全出另一邊。
 */
export const NEW_EVERY = 4;
/** 到期的複習和新題都夠時，複習占一輪的比例（forecast.js 推演用） */
export const REVIEW_SHARE = 1 - 1 / NEW_EVERY;

/**
 * 組出一輪的題目順序：到期該複習的題目優先，每 NEW_EVERY 題穿插一題新題，其餘依到期時間補上。
 * 新題依學測分量與單元熟練度排（priority.js）：考得多、還不熟的單元先出。
 * 答對過、從沒失手的題目不再出（neverMissed）。
 * @param {object[]} bank
 * @param {Record<string, object>} cards
 * @param {{ subjects: string[], excludedUnits?: string[], onlyUnits?: string[] | null, exclude?: Iterable<string>, formulaOnly?: boolean, quickOnly?: boolean, weakOnly?: boolean, size: number, now: number, rng?: () => number }} opts
 *   excludedUnits：關掉的單元（結合了它的跨單元題也不出，見 isUnitOff）；onlyUnits：只出這些單元（兩者都是 unitKey 格式）
 *   exclude：這次先不出的題目 id（例如剛答過的、被回報的）；quickOnly：不出要動筆的演算題（q.scratch）和多選題
 */
export function buildQueue(
  bank,
  cards,
  { subjects, excludedUnits = [], onlyUnits = null, exclude = [], formulaOnly = false, quickOnly = false, weakOnly = false, size, now, rng = Math.random },
) {
  const wanted = new Set(subjects);
  const off = new Set(excludedUnits);
  const only = onlyUnits && new Set(onlyUnits);
  const skip = new Set(exclude);
  const pool = bank.filter((q) => {
    const key = unitKey(q.subject, q.topic);
    return (
      wanted.has(q.subject) &&
      !isUnitOff(q, off) &&
      (!only || only.has(key)) &&
      !skip.has(q.id) &&
      (!formulaOnly || q.formula) &&
      !(quickOnly && (q.scratch || q.type === 'ms')) &&
      !neverMissed(cards[q.id])
    );
  });

  if (weakOnly) {
    const weak = pool.filter((q) => isWeak(cards[q.id]));
    return shuffle(weak, rng)
      .sort((a, b) => cards[a.id].due - cards[b.id].due)
      .slice(0, size);
  }

  const due = [];
  const unseen = [];
  const later = [];
  for (const q of pool) {
    const c = cards[q.id];
    if (!c) unseen.push(q);
    else if (c.due <= now) due.push(q);
    else later.push(q);
  }
  shuffle(due, rng).sort((a, b) => cards[a.id].box - cards[b.id].box);
  const fresh = orderFresh(unseen, { shares: unitShares(subjects), skill: unitSkill(bank, cards, subjects, neverMissed), size, rng });
  shuffle(later, rng).sort((a, b) => cards[a.id].due - cards[b.id].due);

  const out = [];
  while (out.length < size && (due.length || fresh.length)) {
    const [first, other] = out.length % NEW_EVERY === NEW_EVERY - 1 ? [fresh, due] : [due, fresh];
    out.push((first.length ? first : other).shift());
  }
  while (out.length < size && later.length) out.push(later.shift());
  return out;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
