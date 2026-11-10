// 間隔重複（Leitner 盒子）與出題順序。純邏輯，不碰 DOM，方便測試。
import { bundles, takeBundles } from './groups.js';
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

/** 考前衝刺的天數：考前這幾天把排到考後的複習拉回來 */
export const SPRINT_DAYS = 14;

/** 'YYYY-MM-DD'（本地時間）那天 0 點的時間；格式不對時為 null */
export function examStart(date) {
  const [y, m, d] = String(date ?? '').split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime();
  return Number.isFinite(t) ? t : null;
}

function hashOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 出題時用的到期時間。平常就是卡片的 due；但失手過的題目答對幾次後間隔會拉到 16、35 天，
 * 到期日落在考試當天或之後的，考前就不會再出現。考前衝刺：考前 SPRINT_DAYS 天內還沒再做過的這種題目，
 * 各拉回來複習一次，照題號分散在這幾天（同一題每台裝置算出來的日子一樣）。
 * 衝刺時答對，盒子與原本的到期日不變（還沒到期就答對不升盒，見 schedule），只記下做過了；答錯照常回到第 0 盒。
 * @param {number | null} examAt 考試那天 0 點（examStart）；沒設定或已經考完就不衝刺
 */
export function dueFor(id, card, examAt, now) {
  if (!examAt || now >= examAt || card.due < examAt) return card.due;
  const start = examAt - SPRINT_DAYS * DAY;
  if ((card.last ?? 0) >= start) return card.due;
  return start + (hashOf(id) % SPRINT_DAYS) * DAY;
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
 * 到期的複習先出，但每 NEW_EVERY 題留一題給新題（每 2 題複習配 1 題新題），複習也最多連續出 NEW_EVERY − 1 題：
 * 複習多的時候少排新題，免得複習越積越多；又不會一連好幾題都是做過的題、完全沒有新進度。一邊出完了就全出另一邊。
 * （以前是每 4 題留 1 題，一組新的閱讀題組之後還會連出十幾題複習；改成 2:1 交錯，新題多一些，到期的複習累積得比較多）
 */
export const NEW_EVERY = 3;
/** 到期的複習和新題都夠時，複習占一輪的比例（forecast.js 推演用） */
export const REVIEW_SHARE = (NEW_EVERY - 1) / NEW_EVERY;

/**
 * 組出一輪的題目順序：到期該複習的題目優先，每 NEW_EVERY 題穿插一題新題，其餘依到期時間補上。
 * 新題依學測分量與單元熟練度排（priority.js）：考得多、還不熟的單元先出。
 * 答對過、從沒失手的題目不再出（neverMissed）。
 * @param {object[]} bank
 * @param {Record<string, object>} cards
 * @param {{ subjects: string[], excludedUnits?: string[], onlyUnits?: string[] | null, exclude?: Iterable<string>, formulaOnly?: boolean, quickOnly?: boolean, weakOnly?: boolean, streak?: number, size: number, now: number, rng?: () => number }} opts
 *   excludedUnits：關掉的單元（結合了它的跨單元題也不出，見 isUnitOff）；onlyUnits：只出這些單元（兩者都是 unitKey 格式）
 *   exclude：這次先不出的題目 id（例如剛答過的、被回報的）；quickOnly：不出要動筆的演算題（q.scratch）、多選題、閱讀題組和圖表題
 *   streak：這批之前剛連續做了幾題複習。自由練習一批出完再補下一批時接著算，兩批交界才不會一連出 4 題複習
 *   examAt：考試那天 0 點（examStart）。有給的話，考前衝刺期間把排到考後的複習拉回來（見 dueFor）
 * 閱讀題組（q.group）的題目排在一起出；一輪的最後一組放不下時整組照出，所以最多會比 size 多出一組的題數。
 */
export function buildQueue(
  bank,
  cards,
  { subjects, excludedUnits = [], onlyUnits = null, exclude = [], formulaOnly = false, quickOnly = false, weakOnly = false, streak = 0, examAt = null, size, now, rng = Math.random },
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
      !(quickOnly && (q.scratch || q.type === 'ms' || q.group || q.fig)) &&
      !neverMissed(cards[q.id])
    );
  });

  if (weakOnly) {
    const weak = pool.filter((q) => isWeak(cards[q.id]));
    return takeBundles(bundles(shuffle(weak, rng).sort((a, b) => cards[a.id].due - cards[b.id].due)), size);
  }

  const dueList = [];
  const unseen = [];
  const laterList = [];
  const dueAt = new Map();
  for (const q of pool) {
    const c = cards[q.id];
    if (!c) {
      unseen.push(q);
      continue;
    }
    const due = dueFor(q.id, c, examAt, now);
    dueAt.set(q.id, due);
    if (due <= now) dueList.push(q);
    else laterList.push(q);
  }
  // 閱讀題組：同組、同一類（到期／新題／還沒到期）的題目併成一包，一起出、文章只讀一次；
  // 組裡有題目到期要複習時，同組還沒做過的題目也接在後面一起出，不必之後再讀一次同一篇
  const dueGroups = new Set(dueList.filter((q) => q.group).map((q) => q.group));
  const joining = unseen.filter((q) => dueGroups.has(q.group));
  const rest = joining.length ? unseen.filter((q) => !dueGroups.has(q.group)) : unseen;
  // bundles 把同組的題目併到這組第一次出現的位置，也就是到期那題的位置
  const due = bundles([...shuffle(dueList, rng).sort((a, b) => cards[a.id].box - cards[b.id].box), ...joining]);
  const fresh = bundles(orderFresh(rest, { shares: unitShares(subjects), skill: unitSkill(bank, cards, subjects, neverMissed), size, rng }));
  const later = bundles(shuffle(laterList, rng).sort((a, b) => dueAt.get(a.id) - dueAt.get(b.id)));

  // 第 NEW_EVERY、2×NEW_EVERY…題輪到新題；題組一包好幾題，所以照已經出了幾題新題來算輪到誰。
  // 但複習最多連續出 NEW_EVERY − 1 題就換新題：剛出了一整組新的閱讀題組（一次好幾題新題）時，
  // 光照比例會接著連出一長串複習才補回來。到期的閱讀題組整組一起出，不過剛出過複習、接上整組會超過上限時，
  // 先出一題新題再出這組：連續的複習最多就是 2 題，或一整組題組本身的題數
  const out = [];
  let freshCount = 0;
  let inRow = streak;
  while (out.length < size && (due.length || fresh.length)) {
    const over = inRow > 0 && inRow + (due[0]?.length ?? 0) > NEW_EVERY - 1;
    const wantFresh = out.length - freshCount >= (NEW_EVERY - 1) * (freshCount + 1) || over;
    const pack = (wantFresh ? fresh.length > 0 : !due.length) ? fresh.shift() : due.shift();
    const added = pack.filter((q) => !cards[q.id]).length;
    freshCount += added;
    inRow = added ? 0 : inRow + pack.length;
    out.push(...pack);
  }
  out.push(...takeBundles(later, size - out.length));
  return out;
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
