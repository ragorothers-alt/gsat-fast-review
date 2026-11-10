// 複習負荷預報與考前排程：依每張卡片的到期日與盒子，推估之後每天要複習幾題、扣掉複習還能做幾題新題。
// 純邏輯，不碰 DOM。用期望值逐日推演，所以題數可以是小數，顯示時再四捨五入。
import { DAY, INTERVALS, MAX_BOX, REVIEW_SHARE, neverMissed } from './srs.js';

/** 答錯（或看解答、標成猜的）後，當天還要再答兩次才回到隔天複習：第 0 盒隔 1 分鐘、第 1 盒隔 10 分鐘 */
const RELEARN = 2;
/** 資料太少時用的預設值：複習時答對的比例、新題第一次就答對（之後不再出）的比例 */
const DEFAULT_RECALL = 0.75;
const DEFAULT_FIRST = 0.6;
/** 練過的題目少於這個數，「第一次就答對」的比例還不準，用預設值 */
const MIN_PRACTICED = 30;
/** 想在考前全部做過一輪，每天最多算到幾題（再多就是做不完） */
const MAX_DAILY = 100_000;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** 本地時間的今天 0 點 */
function startOfDay(ts) {
  const t = new Date(ts);
  return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
}

/** 某個時間點是從今天算起的第幾天（今天是 0；已經過期的也算今天） */
export function dayIndex(ts, now) {
  return Math.max(0, Math.round((startOfDay(ts) - startOfDay(now)) / DAY));
}

/**
 * 推估用的兩個比例，都有上下限，免得極端資料算出離譜的預報：
 * recall：複習時答對的比例，用近期正確率；first：新題第一次就答對、之後不再出的比例，用練過的題目裡從沒失手的比例
 * @param {Card[]} cards 範圍內練過的卡片
 * @param {number | null} accuracy 近期正確率（沒有作答時為 null）
 */
export function estimateRates(cards, accuracy) {
  const first = cards.length >= MIN_PRACTICED ? cards.filter(neverMissed).length / cards.length : DEFAULT_FIRST;
  return { recall: clamp(accuracy ?? DEFAULT_RECALL, 0.5, 0.97), first: clamp(first, 0.2, 0.95) };
}

/**
 * 還會再出的卡片依「第幾天到期」與盒子分組。答對過、從沒失手的不再出，不算。
 * @param {Card[]} cards 範圍內的卡片
 * @param {number} now
 * @param {(card: Card) => number} [dueOf] 這張卡出題時用的到期時間（考前衝刺會把排到考後的拉回來，見 srs.js 的 dueFor）
 * @returns {Map<number, number[]>} 第幾天 → 各盒子的張數
 */
export function dueBuckets(cards, now, dueOf = (c) => c.due) {
  const out = new Map();
  for (const c of cards) {
    if (neverMissed(c)) continue;
    const d = dayIndex(dueOf(c), now);
    const boxes = out.get(d) ?? out.set(d, new Array(MAX_BOX + 1).fill(0)).get(d);
    boxes[Math.min(c.box, MAX_BOX)]++;
  }
  return out;
}

/**
 * 逐日推演，照 App 實際的出題方式（srs.js 的 buildQueue）：到期的複習先出，但每 2 題複習配 1 題新題，
 * 一邊不夠時由另一邊補上；當天沒輪到的複習留到隔天，越積越多。
 * 複習答對升一盒、隔那一盒的天數再出；答錯當天重學，隔天從第 2 盒再來。
 * 新題第一次就答對的不再出；答錯的同樣當天重學、隔天開始複習。
 * @param {Map<number, number[]>} buckets dueBuckets 的結果
 * @param {{ days: number, budget: (day: number) => number, fresh: number, recall: number, first: number, newReturns?: boolean }} opts
 *   budget：第幾天能作答幾題；fresh：還沒做過的題目數，做完就沒有新題可做；
 *   newReturns：新題答錯的之後要不要回來複習。預報「已經練過的題目」每天到期幾題時設成 false，
 *   不然新題補滿空檔、答錯的又回來，複習量會跟著每日目標一起變大，看不出現有的複習跟不跟得上
 * @returns {{ due: number, review: number, fresh: number, carry: number }[]}
 *   每天：到期的題數（含之前沒做完的）、複習的作答數（含答錯後的重學）、新題數、沒輪到而留到隔天的題數
 */
export function simulate(buckets, { days, budget, fresh, recall, first, newReturns = true }) {
  const due = new Map([...buckets].map(([d, boxes]) => [d, [...boxes]]));
  const add = (d, box, n) => {
    if (d >= days || !n) return;
    const boxes = due.get(d) ?? due.set(d, new Array(MAX_BOX + 1).fill(0)).get(d);
    boxes[box] += n;
  };
  // 每張到期的卡平均要答幾次：剛答錯還在重學的再答一兩次；其他答一次，答錯再加重學
  const reviewCost = (box) => (box < 2 ? 2 - box : 1 + (1 - recall) * RELEARN);
  // 新題平均每題要答幾次：第一次，加上答錯時當天的重學
  const freshCost = 1 + (1 - first) * RELEARN;
  let left = fresh;
  const out = [];
  for (let d = 0; d < days; d++) {
    const boxes = due.get(d) ?? new Array(MAX_BOX + 1).fill(0);
    const cards = boxes.reduce((a, n) => a + n, 0);
    const need = boxes.reduce((a, n, box) => a + n * reviewCost(box), 0);
    const b = budget(d);
    // 複習最多占 REVIEW_SHARE，新題做完了就全給複習；複習不夠時剩下的給新題
    const spend = Math.min(need, Math.max(b * REVIEW_SHARE, b - left * freshCost));
    const done = need ? spend / need : 0;
    let carry = 0;
    boxes.forEach((n, box) => {
      if (!n) return;
      carry += n * (1 - done);
      add(d + 1, box, n * (1 - done));
      const m = n * done;
      if (box < 2) {
        // 剛答錯、還在當天重學的卡：再答對一兩次就到第 2 盒
        add(d + 1, 2, m);
        return;
      }
      const up = Math.min(MAX_BOX, box + 1);
      add(d + INTERVALS[up] / DAY, up, m * recall);
      add(d + 1, 2, m * (1 - recall));
    });
    const n = Math.min(left, Math.max(0, b - spend) / freshCost);
    left -= n;
    if (newReturns) add(d + 1, 2, n * (1 - first));
    out.push({ due: cards, review: spend + n * (1 - first) * RELEARN, fresh: n, carry });
  }
  return out;
}

/**
 * 已經練過的題目接下來 days 天的複習預報（新題答錯的不算回來，見 simulate 的 newReturns）
 * @param {Map<number, number[]>} buckets dueBuckets 的結果
 * @param {{ days: number, goal: number, fresh: number, recall: number, first: number, today?: number }} opts
 *   goal：每日目標；today：今天已經作答幾題（今天只剩目標減掉這些）
 */
export function reviewForecast(buckets, { days, goal, fresh, recall, first, today = 0 }) {
  return simulate(buckets, { days, budget: (d) => (d ? goal : Math.max(0, goal - today)), fresh, recall, first, newReturns: false });
}

/** 從明天起都沒有複習留到隔天：每日目標跟得上已經練過的題目 */
export const keepsUp = (rows) => rows.slice(1).every((r) => r.carry < 0.5);

/**
 * 每天要做幾題，已經練過的題目到期時才不會越積越多：選項裡最小的、推演 days 天都沒有留到隔天的；都不夠時為 null
 * @param {Map<number, number[]>} buckets
 * @param {{ days: number, goals: number[], fresh: number, recall: number, first: number, today?: number }} opts today：今天已經作答幾題
 */
export function keepUpGoal(buckets, { goals, ...opts }) {
  return goals.find((goal) => keepsUp(reviewForecast(buckets, { ...opts, goal }))) ?? null;
}

/** 「全部練過一輪每天要做的題數」超過每日目標的幾倍，就算這個範圍考前練不完一輪 */
export const PLAN_STRETCH = 3;

/**
 * 考前規劃下面那段話該怎麼說：
 * - 'empty'：沒選範圍；'done'：選的範圍都練過了；
 * - 'reachable'：每天做 needDaily 題就能在考前練完一輪（不超過每日目標的 PLAN_STRETCH 倍）；
 * - 'beyond'：考前練不完一輪（needDaily 是 null，或超過每日目標的 PLAN_STRETCH 倍）。範圍很大時這很正常，
 *   畫面上不寫「每天要做幾千題」那種數字，改說 App 會照學測出題比例與弱點挑題、可以縮小範圍。
 * @param {{ remaining: number, needDaily: number | null }} plan studyPlan 的結果
 * @param {{ total: number, goal: number }} opts total：選的範圍有幾題；goal：每日目標
 * @returns {'empty' | 'done' | 'reachable' | 'beyond'}
 */
export function planVerdict(plan, { total, goal }) {
  if (!total) return 'empty';
  if (!plan.remaining) return 'done';
  return plan.needDaily !== null && plan.needDaily <= goal * PLAN_STRETCH ? 'reachable' : 'beyond';
}

const freshSum = (rows) => rows.reduce((a, r) => a + r.fresh, 0);

/**
 * 考前規劃：照每天 pace 題的步調推演到考前，扣掉複習後還能做到幾題新題；想在考前全部做過一輪，每天要做幾題。
 * @param {{ buckets: Map<number, number[]>, total: number, fresh: number, daysLeft: number, pace: number, goals: number[], recall: number, first: number }} opts
 *   total：選的範圍有幾題；fresh：其中還沒做過的；pace：每天作答幾題（近來的平均或每日目標）
 * @returns {{ remaining: number, projected: number, coverage: number, projectedCoverage: number, needDaily: number | null, needReview: number, suggest: number | null }}
 *   projected：照目前步調考前還能做到的新題數；needDaily：全部做過一輪每天要做幾題（做不完時為 null），
 *   needReview：照 needDaily 的步調，平均每天其中有幾題是複習；suggest：建議的每日目標（選項裡最小夠用的）
 */
export function studyPlan({ buckets, total, fresh, daysLeft, pace, goals, recall, first }) {
  const days = Math.max(1, daysLeft);
  const run = (daily) => simulate(buckets, { days, budget: () => daily, fresh, recall, first });
  const enough = (daily) => freshSum(run(daily)) >= fresh - 0.5;
  const projected = Math.min(fresh, Math.round(freshSum(run(pace))));
  let needDaily = 0;
  if (fresh) {
    // 每天做越多題，考前做到的新題越多：找最小的夠用題數
    let hi = 1;
    while (!enough(hi) && hi < MAX_DAILY) hi *= 2;
    if (!enough(hi)) needDaily = null;
    else {
      let lo = Math.floor(hi / 2) + 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (enough(mid)) hi = mid;
        else lo = mid + 1;
      }
      needDaily = hi;
    }
  }
  const rows = needDaily ? run(needDaily) : [];
  const practiced = total - fresh;
  return {
    remaining: fresh,
    projected,
    coverage: total ? practiced / total : 0,
    projectedCoverage: total ? (practiced + projected) / total : 0,
    needDaily,
    needReview: rows.length ? Math.round(rows.reduce((a, r) => a + r.review, 0) / rows.length) : 0,
    suggest: needDaily === null ? null : (goals.find((g) => g >= needDaily) ?? null),
  };
}
