// 每日作答量與連續天數。日期一律用裝置的本地時間。

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

/** 記一次作答（「看解答」不算作答量，但算今天有練習） */
export function recordAnswer(state, outcome, now) {
  const key = dayKey(now);
  const day = (state.daily[key] ||= { answered: 0, right: 0 });
  if (outcome !== 'skip') day.answered++;
  if (outcome === 'right') day.right++;

  if (state.streak.last !== key) {
    state.streak.count = state.streak.last === previousDayKey(now) ? state.streak.count + 1 : 1;
    state.streak.last = key;
  }
  pruneDaily(state, now);
}

/** 顯示用的連續天數：昨天或今天有練才算還沒斷 */
export function currentStreak(state, now) {
  const { last, count } = state.streak;
  return last === dayKey(now) || last === previousDayKey(now) ? count : 0;
}

export function today(state, now) {
  return state.daily[dayKey(now)] ?? { answered: 0, right: 0 };
}

function pruneDaily(state, now) {
  const cutoff = dayKey(now - 90 * 86_400_000);
  for (const k of Object.keys(state.daily)) if (k < cutoff) delete state.daily[k];
}
