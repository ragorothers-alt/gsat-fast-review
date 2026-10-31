// 每日作答量與連續天數。日期一律用裝置的本地時間。

/** 每日目標可以選的題數 */
export const GOALS = [10, 20, 30, 50, 80, 120];

export function dayKey(ts) {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function previousDayKey(ts) {
  const d = new Date(ts);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime());
}

/** 日期字串往前／後推幾天：shiftDay('2026-03-01', -1) === '2026-02-28' */
export function shiftDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + delta).getTime());
}

/** 記一次作答（「看解答」不算作答量，但算今天有練習） */
export function recordAnswer(state, outcome, now) {
  const key = dayKey(now);
  const day = (state.daily[key] ||= { answered: 0, right: 0 });
  if (outcome !== 'skip') day.answered++;
  if (outcome === 'right') day.right++;
  // 開過線上同步：這台另外記一份，同步時各台的作答量相加（見 cloud.js）
  if (state.cloud) {
    const mine = (state.cloud.devices[state.cloud.device] ||= {});
    const own = (mine[key] ||= { answered: 0, right: 0 });
    if (outcome !== 'skip') own.answered++;
    if (outcome === 'right') own.right++;
  }

  if (state.streak.last !== key) {
    state.streak.count = state.streak.last === previousDayKey(now) ? state.streak.count + 1 : 1;
    state.streak.last = key;
  }
  pruneDaily(state, now);
}

/** 答對後才標成「猜的」或「不太確定」：那天的答對數扣回來（delta = -1），取消標記時加回（+1） */
export function adjustRight(state, delta, at) {
  const key = dayKey(at);
  const own = state.cloud?.devices[state.cloud.device]?.[key];
  for (const day of [state.daily[key], own]) if (day) day.right = Math.max(0, day.right + delta);
}

/** 顯示用的連續天數：昨天或今天有練才算還沒斷 */
export function currentStreak(state, now) {
  const { last, count } = state.streak;
  return last === dayKey(now) || last === previousDayKey(now) ? count : 0;
}

export function today(state, now) {
  return state.daily[dayKey(now)] ?? { answered: 0, right: 0 };
}

/** 每日紀錄只留最近 90 天 */
export const KEEP_DAYS = 90;

export function pruneDaily(state, now) {
  const cutoff = dayKey(now - KEEP_DAYS * 86_400_000);
  const maps = [state.daily];
  if (state.cloud) maps.push(state.cloud.legacy, ...Object.values(state.cloud.devices));
  for (const m of maps) for (const k of Object.keys(m)) if (k < cutoff) delete m[k];
}
