// 間隔重複（Leitner 盒子）與出題順序。純邏輯，不碰 DOM，方便測試。
import { unitKey } from './units.js';

export const MINUTE = 60_000;
export const DAY = 86_400_000;
// 第 n 盒答對後隔多久再出現
export const INTERVALS = [1 * MINUTE, 10 * MINUTE, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY];
export const MAX_BOX = INTERVALS.length - 1;

/**
 * 依作答結果更新一張卡片的排程。
 * @param {object|undefined} card 舊紀錄（沒看過則為 undefined）
 * @param {'right'|'wrong'|'skip'} outcome skip = 不會、直接看解答
 * @param {number} now
 */
export function schedule(card, outcome, now) {
  const c = { box: 0, due: 0, seen: 0, right: 0, wrong: 0, parked: false, ...card };
  c.seen++;
  c.last = now;
  if (outcome === 'right') {
    c.right++;
    // 第一次見到就答對：直接跳到隔天再考
    c.box = c.seen === 1 ? 2 : Math.min(MAX_BOX, c.box + 1);
    c.parked = false;
  } else if (outcome === 'wrong') {
    c.wrong++;
    c.box = 0;
  } else {
    c.parked = true;
  }
  c.due = now + (outcome === 'skip' ? 0 : INTERVALS[c.box]);
  return c;
}

/** 錯題本：答錯後還沒穩定答對，或按過「看解答」的題目 */
export function isWeak(card) {
  return !!card && (card.parked || (card.wrong > 0 && card.box < 3));
}

/** 熟練度 0–1：每題的盒子數平均，沒看過算 0 */
export function mastery(questions, cards) {
  if (!questions.length) return 0;
  let sum = 0;
  for (const q of questions) sum += Math.min(cards[q.id]?.box ?? 0, MAX_BOX);
  return sum / (questions.length * MAX_BOX);
}

/**
 * 組出一輪的題目順序：到期該複習的題目與新題交錯出現，其餘依到期時間補上。
 * @param {object[]} bank
 * @param {Record<string, object>} cards
 * @param {{ subjects: string[], excludedUnits?: string[], exclude?: Iterable<string>, formulaOnly?: boolean, weakOnly?: boolean, size: number, now: number, rng?: () => number }} opts
 *   excludedUnits：關掉的單元（unitKey 格式）；exclude：這次先不出的題目 id（例如剛答過的）
 */
export function buildQueue(bank, cards, { subjects, excludedUnits = [], exclude = [], formulaOnly = false, weakOnly = false, size, now, rng = Math.random }) {
  const wanted = new Set(subjects);
  const off = new Set(excludedUnits);
  const skip = new Set(exclude);
  const pool = bank.filter(
    (q) => wanted.has(q.subject) && !off.has(unitKey(q.subject, q.topic)) && !skip.has(q.id) && (!formulaOnly || q.formula),
  );

  if (weakOnly) {
    const weak = pool.filter((q) => isWeak(cards[q.id]));
    return shuffle(weak, rng)
      .sort((a, b) => cards[a.id].due - cards[b.id].due)
      .slice(0, size);
  }

  const due = [];
  const fresh = [];
  const later = [];
  for (const q of pool) {
    const c = cards[q.id];
    if (!c) fresh.push(q);
    else if (c.due <= now) due.push(q);
    else later.push(q);
  }
  shuffle(due, rng).sort((a, b) => cards[a.id].box - cards[b.id].box);
  shuffle(fresh, rng);
  shuffle(later, rng).sort((a, b) => cards[a.id].due - cards[b.id].due);

  const out = [];
  while (out.length < size && (due.length || fresh.length)) {
    if (due.length) out.push(due.shift());
    if (out.length < size && fresh.length) out.push(fresh.shift());
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
