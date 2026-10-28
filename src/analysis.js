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
