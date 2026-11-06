// 學習分析：各單元與各科的作答統計、弱點單元、題庫存量、每日走勢、學測倒數。純邏輯，不碰 DOM。
import { UNIT_SHARE } from './blueprint.js';
import { PATH_SIZE } from './path.js';
import { unitShares } from './priority.js';
import { isWeak, mastery } from './srs.js';
import { dayKey, shiftDay } from './stats.js';
import { UNITS, isUnitOff, unitKey } from './units.js';

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
 * 弱點單元：作答夠多、有失誤的單元，依「失誤率 × 學測分量」由高到低排——學測考得多又常錯的單元最該先補。
 * 失誤率先做平滑 (失誤 + 1) / (作答 + 4)，免得只答過幾題、錯一兩題的單元就排到最前面。
 * share 是這個單元在歷屆學測該科的出題占比（%），給畫面顯示。
 * @param {{ subjects: string[], excludedUnits?: string[], limit?: number }} opts
 */
export function weakUnits(bank, cards, { subjects, excludedUnits = [], limit = 3 }) {
  const off = new Set(excludedUnits);
  const shares = unitShares(subjects);
  return unitStats(bank, cards, subjects)
    .filter((u) => !off.has(u.key) && u.seen >= MIN_SEEN && u.misses > 0)
    .map((u) => ({
      ...u,
      rate: u.misses / u.seen,
      share: UNIT_SHARE[u.subject]?.[u.unit] ?? 0,
      score: ((u.misses + 1) / (u.seen + 4)) * (shares.get(u.key) ?? 0),
    }))
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

/** 單元裡沒做過的題目少於一關單元闖關的題數，就算新題快用完了 */
export const LOW_STOCK = PATH_SIZE;

/**
 * 題庫存量：選的範圍裡，各科、各單元還有幾題沒做過（沒有作答紀錄）。
 * 被回報而暫停出題的題目不算；結合了關掉單元的跨單元題也不出，所以不算（見 isUnitOff）。
 * @param {{ subjects: string[], excludedUnits?: string[], flags?: Record<string, unknown> }} opts
 * @returns {{ total: number, fresh: number, subjects: { subject: string, total: number, fresh: number, units: { unit: string, key: string, total: number, fresh: number }[] }[] }}
 */
export function bankStock(bank, cards, { subjects, excludedUnits = [], flags = {} }) {
  const off = new Set(excludedUnits);
  // 單元鍵 → [這科的統計, 這個單元的統計]，一題同時算進兩邊
  const slots = new Map();
  const list = subjects.map((subject) => {
    const s = { subject, total: 0, fresh: 0, units: [] };
    for (const unit of UNITS[subject] ?? []) {
      const key = unitKey(subject, unit);
      if (off.has(key)) continue;
      const u = { unit, key, total: 0, fresh: 0 };
      s.units.push(u);
      slots.set(key, [s, u]);
    }
    return s;
  });
  for (const q of bank) {
    const slot = slots.get(unitKey(q.subject, q.topic));
    if (!slot || flags[q.id] || isUnitOff(q, off)) continue;
    for (const x of slot) {
      x.total++;
      if (!cards[q.id]) x.fresh++;
    }
  }
  const sum = (k) => list.reduce((a, s) => a + s[k], 0);
  return { total: sum('total'), fresh: sum('fresh'), subjects: list };
}

/** 單元的新題快用完了：沒做過的不到 LOW_STOCK 題（沒有題目可出的單元不算） */
export const isLowStock = (u) => u.total > 0 && u.fresh < LOW_STOCK;

/** 新題快用完的單元，剩得少的排前面 */
export function lowStock(stock) {
  return stock.subjects
    .flatMap((s) => s.units.filter(isLowStock).map((u) => ({ subject: s.subject, ...u })))
    .sort((a, b) => a.fresh - b.fresh);
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
