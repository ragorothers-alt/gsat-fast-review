// 進度備份：在一台裝置匯出成 JSON 檔，到另一台匯入後合併。純邏輯，不碰 DOM，方便測試。
import { shiftDay } from './stats.js';

const APP = 'gsat-quiz';

export function exportBackup(state, now) {
  const { cards, daily, streak, best, flags, flagsOff } = state;
  return JSON.stringify({ app: APP, version: 1, exportedAt: now, state: { cards, daily, streak, best, flags, flagsOff } });
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

const obj = (x) => (x && typeof x === 'object' ? x : {});
const num = (x) => (Number.isFinite(x) ? x : 0);

/**
 * 同一題在兩邊都有紀錄時：排程（盒子、到期日）以較晚作答的那份為準；
 * 累計次數取較大值而不相加，這樣來回匯入或重複匯入同一份檔案，結果都不會變。
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
  };
}

/**
 * 回報與取消回報都記下時間：flags 是目前回報中的題目，flagsOff 是取消過的。
 * 合併時同一題以較晚的動作為準，在一台取消回報，另一台同步過來才不會又加回去。
 */
export function setFlag(state, id, on, now) {
  state.flagsOff ||= {};
  if (on) {
    state.flags[id] = now;
    delete state.flagsOff[id];
  } else {
    delete state.flags[id];
    state.flagsOff[id] = now;
  }
}

/** 把另一份的一筆回報／取消併進來；比本機的動作新才採用，回傳有沒有改變 */
export function applyFlag(flags, flagsOff, id, at, on) {
  if (!(at > Math.max(flags[id] ?? 0, flagsOff[id] ?? 0))) return false;
  if (on) {
    flags[id] = at;
    delete flagsOff[id];
  } else {
    delete flags[id];
    flagsOff[id] = at;
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
 * @param {object} local 本機目前的 state
 * @param {object} incoming parseBackup 讀出的進度
 */
export function mergeState(local, incoming) {
  const inCards = obj(incoming.cards);
  const cards = { ...local.cards };
  let added = 0;
  let updated = 0;
  for (const [id, card] of Object.entries(inCards)) {
    if (!card || typeof card !== 'object') continue;
    const mine = cards[id];
    if (!mine) added++;
    else if (num(card.last) > num(mine.last)) updated++;
    cards[id] = mergeCard(mine, card);
  }

  const daily = { ...local.daily };
  for (const [k, d] of Object.entries(obj(incoming.daily))) {
    const mine = daily[k] ?? { answered: 0, right: 0 };
    daily[k] = { answered: Math.max(mine.answered, num(d?.answered)), right: Math.max(mine.right, num(d?.right)) };
  }

  const flags = { ...local.flags };
  const flagsOff = { ...local.flagsOff };
  for (const [id, at] of Object.entries(obj(incoming.flags))) applyFlag(flags, flagsOff, id, num(at), true);
  for (const [id, at] of Object.entries(obj(incoming.flagsOff))) applyFlag(flags, flagsOff, id, num(at), false);

  const inStreak = { count: num(incoming.streak?.count), last: incoming.streak?.last ?? null };
  return {
    state: {
      ...local,
      cards,
      daily,
      flags,
      flagsOff,
      streak: mergeStreak(daily, local.streak, inStreak),
      best: { ...local.best, blitz: Math.max(num(local.best?.blitz), num(incoming.best?.blitz)) },
    },
    added,
    updated,
  };
}
