// 學習分析：各單元與各科的作答統計、弱點單元、每日走勢、學測倒數。純邏輯，不碰 DOM。
import { isWeak, mastery } from './srs.js';
import { dayKey, shiftDay } from './stats.js';
import { UNITS, unitKey } from './units.js';

/** 作答（含看解答）少於這個次數的單元，資料太少，不列入弱點排名 */
export const MIN_SEEN = 4;

/**
 * 每個單元的統計。失誤 = 答錯 + 看解答（seen − right）。
 * @returns {{ subject: string, unit: string, key: string, total: number, seen: number, misses: number, weak: number, mastery: number }[]}
 */
export function unitStats(bank, cards, subjects) {
  const out = [];
  for (const subject of subjects) {
    for (const unit of UNITS[subject] ?? []) {
      const qs = bank.filter((q) => q.subject === subject && q.topic === unit);
      let seen = 0;
      let right = 0;
      let weak = 0;
      for (const q of qs) {
        const c = cards[q.id];
        if (!c) continue;
        seen += c.seen;
        right += c.right;
        if (isWeak(c)) weak++;
      }
      out.push({ subject, unit, key: unitKey(subject, unit), total: qs.length, seen, misses: seen - right, weak, mastery: mastery(qs, cards) });
    }
  }
  return out;
}

/**
 * 弱點單元：作答夠多的單元依失誤率由高到低排。
 * 失誤率先做平滑 (失誤 + 1) / (作答 + 4)，免得只答過幾題、錯一兩題的單元就排到最前面。
 * @param {{ subjects: string[], excludedUnits?: string[], limit?: number }} opts
 */
export function weakUnits(bank, cards, { subjects, excludedUnits = [], limit = 3 }) {
  const off = new Set(excludedUnits);
  return unitStats(bank, cards, subjects)
    .filter((u) => !off.has(u.key) && u.seen >= MIN_SEEN && u.misses > 0)
    .map((u) => ({ ...u, rate: u.misses / u.seen, score: (u.misses + 1) / (u.seen + 4) }))
    .sort((a, b) => b.score - a.score || b.weak - a.weak)
    .slice(0, limit);
}

/** 各科：練過幾題、正確率（看解答算失誤）、熟練度 */
export function subjectStats(bank, cards, subjects) {
  return subjects.map((subject) => {
    const qs = bank.filter((q) => q.subject === subject);
    let practiced = 0;
    let seen = 0;
    let right = 0;
    for (const q of qs) {
      const c = cards[q.id];
      if (!c) continue;
      practiced++;
      seen += c.seen;
      right += c.right;
    }
    return { subject, total: qs.length, practiced, accuracy: seen ? right / seen : null, mastery: mastery(qs, cards) };
  });
}

/** 最近 days 天（含今天）每天的作答量，由舊到新 */
export function dailySeries(daily, now, days) {
  const today = dayKey(now);
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = shiftDay(today, -i);
    const d = daily[key];
    out.push({ key, answered: d?.answered ?? 0, right: d?.right ?? 0 });
  }
  return out;
}

/** 一段期間的正確率；沒有作答時為 null */
export function accuracyOf(series) {
  const answered = series.reduce((a, d) => a + d.answered, 0);
  return answered ? series.reduce((a, d) => a + d.right, 0) / answered : null;
}

/** 距離某天（'YYYY-MM-DD'，本地時間）還有幾天；當天為 0，已過為負數 */
export function daysUntil(date, now) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(now);
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86_400_000);
}

/** 每天作答的題目裡，新題大約占一半（出題時到期的複習題與新題交錯，見 srs.js 的 buildQueue） */
export const NEW_SHARE = 0.5;

/**
 * 考前規劃：照目前的步調，考前能把選的範圍練過多少；想全部練過一輪，每天要做幾題。
 * @param {{ total: number, practiced: number, daysLeft: number, pace: number, goals: number[] }} opts
 *   total：選的範圍有幾題；practiced：其中練過幾題；pace：近來平均每天作答幾題
 * @returns {{ remaining: number, projected: number, coverage: number, projectedCoverage: number, needDaily: number, suggest: number | null }}
 *   projected：照目前步調，考前還能練到的新題數；suggest：建議的每日目標（選項裡最小夠用的；不夠用時為 null）
 */
export function studyPlan({ total, practiced, daysLeft, pace, goals }) {
  const remaining = Math.max(0, total - practiced);
  const days = Math.max(1, daysLeft);
  const projected = Math.min(remaining, Math.round(days * pace * NEW_SHARE));
  const needDaily = remaining ? Math.ceil(remaining / days / NEW_SHARE) : 0;
  return {
    remaining,
    projected,
    coverage: total ? practiced / total : 0,
    projectedCoverage: total ? (practiced + projected) / total : 0,
    needDaily,
    suggest: goals.find((g) => g >= needDaily) ?? null,
  };
}
