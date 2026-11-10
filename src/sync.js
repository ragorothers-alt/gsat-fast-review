// 進度備份：在一台裝置匯出成 JSON 檔，到另一台匯入後合併。純邏輯，不碰 DOM，方便測試。
import { MAX_BOX, everMissed } from './srs.js';
import { shiftDay } from './stats.js';

const APP = 'gsat-quiz';

export function exportBackup(state, now) {
  const { cards, daily, streak, best, flags, flagsOff, stars, starsOff } = state;
  return JSON.stringify({ app: APP, version: 1, exportedAt: now, state: { cards, daily, streak, best, flags, flagsOff, stars, starsOff } });
}

/** 讀出備份裡的進度；不是這個遊戲的備份就丟出 Error，訊息直接給玩家看 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('這個檔案不是有效的進度備份');
  }
  if (data?.app !== APP || !data.state || typeof data.state !== 'object') throw new Error('這個檔案不是學測快問快答的進度備份');
  return data.state;
}

const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const num = (x) => (Number.isFinite(x) ? x : 0);
const int = (x, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= 0 && x <= max;

/** 題目 id 的格式（科目-數字），和同步後端的檢查一致 */
export const CARD_ID = /^[a-z]+-\d{3,5}$/;
export const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 從檔案、雲端或舊存檔讀進來的一張卡片：每個欄位都要是合理範圍內的整數，否則整張略過（回傳 null）。
 * 這些數字會顯示在畫面上，也決定排程，不能讓壞掉或特製的資料混進來。
 */
export function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  const { box, due, seen, right, wrong, last } = c;
  // 不檢查 right + wrong <= seen：兩台合併時次數各取較大值，加起來可能超過作答次數
  if (!int(box, MAX_BOX) || !int(due) || !int(seen, 1e6) || !int(right, 1e6) || !int(wrong, 1e6) || !int(last)) return null;
  return { box, due, seen, right, wrong, parked: c.parked === true || c.parked === 1, missed: everMissed(c) ? 1 : 0, last };
}

/**
 * 同一題在兩邊都有紀錄時：排程（盒子、到期日）以較晚作答的那份為準；
 * 累計次數取較大值而不相加，這樣來回匯入或重複匯入同一份檔案，結果都不會變。
 * 失手過（missed）只要任一邊有就算：次數取較大值會蓋掉「這邊看過解答」的痕跡，所以另外記。
 */
export function mergeCard(a, b) {
  if (!a) return b;
  if (!b) return a;
  const newer = num(b.last) > num(a.last) ? b : a;
  return {
    ...newer,
    seen: Math.max(num(a.seen), num(b.seen)),
    right: Math.max(num(a.right), num(b.right)),
    wrong: Math.max(num(a.wrong), num(b.wrong)),
    missed: everMissed(a) || everMissed(b) ? 1 : 0,
  };
}

/** 題目上的標記：flags 回報有問題、stars 收藏 */
export const MARKS = ['flags', 'stars'];

/**
 * 標記與取消都記下時間：state[kind] 是目前標記中的題目，state[kind + 'Off'] 是取消過的。
 * 合併時同一題以較晚的動作為準，在一台取消，另一台同步過來才不會又加回去。
 * @param {'flags'|'stars'} kind
 */
export function setMark(state, kind, id, on, now) {
  const marks = (state[kind] ||= {});
  const off = (state[`${kind}Off`] ||= {});
  if (on) {
    marks[id] = now;
    delete off[id];
  } else {
    delete marks[id];
    off[id] = now;
  }
}

export const setFlag = (state, id, on, now) => setMark(state, 'flags', id, on, now);
export const setStar = (state, id, on, now) => setMark(state, 'stars', id, on, now);

/** 把另一份的一筆標記／取消併進來；比本機的動作新才採用，回傳有沒有改變 */
export function applyMark(marks, off, id, at, on) {
  if (!(at > Math.max(marks[id] ?? 0, off[id] ?? 0))) return false;
  if (on) {
    marks[id] = at;
    delete off[id];
  } else {
    delete marks[id];
    off[id] = at;
  }
  return true;
}

/** 連續天數：從較晚的最後練習日往回數合併後的每日紀錄；數到紀錄盡頭時沿用原本較大的天數 */
export function mergeStreak(daily, ...streaks) {
  const last = streaks.map((s) => s.last).filter(Boolean).sort().pop() ?? null;
  if (!last) return { count: 0, last: null };
  let run = 0;
  for (let k = last; daily[k]; k = shiftDay(k, -1)) run++;
  const known = streaks.filter((s) => s.last === last).map((s) => num(s.count));
  return { count: Math.max(run, ...known), last };
}

/**
 * 合併兩份進度，回傳 { state, added, updated }。
 * 本機設定（科目、單元、音效、目標…）維持原樣，且沿用同一個 settings 物件，畫面上的參照不會失效。
 * @param {AppState} local 本機目前的 state
 * @param {any} incoming parseBackup 讀出的進度
 */
export function mergeState(local, incoming) {
  const inCards = obj(incoming.cards);
  const cards = { ...local.cards };
  let added = 0;
  let updated = 0;
  for (const [id, raw] of Object.entries(inCards)) {
    const card = CARD_ID.test(id) && cleanCard(raw);
    if (!card) continue;
    const mine = cards[id];
    if (!mine) added++;
    else if (card.last > num(mine.last)) updated++;
    cards[id] = mergeCard(mine, card);
  }

  const daily = { ...local.daily };
  for (const [k, d] of Object.entries(obj(incoming.daily))) {
    if (!DAY_KEY.test(k) || !int(d?.answered, 1e5) || !int(d?.right, d.answered)) continue;
    const mine = daily[k] ?? { answered: 0, right: 0 };
    daily[k] = { answered: Math.max(mine.answered, d.answered), right: Math.max(mine.right, d.right) };
  }

  const marks = {};
  for (const kind of MARKS) {
    const on = { ...local[kind] };
    const off = { ...local[`${kind}Off`] };
    for (const [list, flag] of [[incoming[kind], true], [incoming[`${kind}Off`], false]]) {
      for (const [id, at] of Object.entries(obj(list))) if (CARD_ID.test(id) && int(at)) applyMark(on, off, id, at, flag);
    }
    Object.assign(marks, { [kind]: on, [`${kind}Off`]: off });
  }

  const inLast = incoming.streak?.last;
  const inStreak = { count: int(incoming.streak?.count, 1e5) ? incoming.streak.count : 0, last: DAY_KEY.test(inLast ?? '') ? inLast : null };
  return {
    state: {
      ...local,
      cards,
      daily,
      ...marks,
      streak: mergeStreak(daily, local.streak, inStreak),
      best: { ...local.best, blitz: Math.max(num(local.best?.blitz), int(incoming.best?.blitz, 1e6) ? incoming.best.blitz : 0) },
    },
    added,
    updated,
  };
}
