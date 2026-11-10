// 作答速度：一般題（點一下就作答的單選與是非）每題花幾秒，照單元累計，找出「會，但是太慢」的單元。
// 純邏輯，不碰 DOM。只存在這台裝置，不線上同步（各台螢幕與操作方式不同，秒數混在一起沒有意義）。
import { PAPERS } from './exam.js';
import { isUnitOff, unitKey } from './units.js';

/** 一題超過這麼久多半是放下手機了，不算 */
export const MAX_SECS = 300;
/** 一個單元至少計時幾題才列入比較 */
export const MIN_TIMED = 8;
/** 答對率到這個程度才算「會」 */
const KNOWN = 0.6;
/** 比同一科的平均慢這麼多倍才算慢 */
const SLOW = 1.4;

/** 這題要不要計時：演算題、多選題、題組（要讀文章）和圖表題本來就久，不和一般題混在一起比 */
export const isTimed = (q) => !q.scratch && !q.group && !q.fig && q.type !== 'ms';

/**
 * 記下這題花的時間（看解答的不算）。state.pace：單元（unitKey）→ { n, t, rn, rt }：
 * 作答題數與總秒數、其中答對的題數與總秒數
 */
export function recordPace(state, q, outcome, secs) {
  if (outcome === 'skip' || !isTimed(q) || !(secs > 0) || secs > MAX_SECS) return;
  const pace = (state.pace ||= {});
  const p = (pace[unitKey(q.subject, q.topic)] ||= { n: 0, t: 0, rn: 0, rt: 0 });
  p.n++;
  p.t += secs;
  if (outcome === 'right') {
    p.rn++;
    p.rt += secs;
  }
}

/** 存檔裡的 pace：格式不對的丟掉 */
export function cleanPace(pace) {
  const out = {};
  if (!pace || typeof pace !== 'object' || Array.isArray(pace)) return out;
  const ok = (x) => Number.isFinite(x) && x >= 0;
  for (const [k, p] of Object.entries(pace)) if (p && ok(p.n) && ok(p.t) && ok(p.rn) && ok(p.rt) && p.n > 0) out[k] = { n: p.n, t: p.t, rn: p.rn, rt: p.rt };
  return out;
}

/** 同一台開了兩個分頁時各記了一部分：每個單元留題數較多的那份（兩邊都是從同一份存檔往上加的） */
export function mergePace(mine, other) {
  const out = { ...cleanPace(mine) };
  for (const [k, p] of Object.entries(cleanPace(other))) if (!out[k] || p.n > out[k].n) out[k] = p;
  return out;
}

/** 學測這科平均每題有幾秒（模擬考各卷的時間 ÷ 題數，和學測的節奏相同） */
export function examPace(subject) {
  const paper = PAPERS.find((p) => p.subjects.includes(subject));
  return paper ? Math.round((paper.minutes * 60) / paper.size) : null;
}

/**
 * 作答速度報告：各科一般題的平均秒數，以及「會但太慢」的單元——答對率不低、
 * 但答對時平均花的時間比同一科的平均多 SLOW 倍以上（至少計時 MIN_TIMED 題）。
 * @param {Record<string, { n: number, t: number, rn: number, rt: number }>} pace
 * @param {{ subjects: string[], excludedUnits?: string[] }} opts
 * @returns {{ subjects: { subject: string, n: number, avg: number, exam: number | null }[], slow: { key: string, subject: string, unit: string, n: number, avg: number, base: number, accuracy: number }[] }}
 */
export function paceReport(pace, { subjects, excludedUnits = [] }) {
  const off = new Set(excludedUnits);
  const bySubject = new Map();
  const units = [];
  for (const [key, p] of Object.entries(pace ?? {})) {
    const at = key.indexOf('/');
    const subject = key.slice(0, at);
    const unit = key.slice(at + 1);
    if (!subjects.includes(subject) || isUnitOff({ subject, topic: unit }, off)) continue;
    const s = bySubject.get(subject) ?? bySubject.set(subject, { n: 0, t: 0, rn: 0, rt: 0 }).get(subject);
    for (const k of ['n', 't', 'rn', 'rt']) s[k] += p[k];
    units.push({ key, subject, unit, ...p });
  }
  const out = subjects
    .filter((s) => bySubject.has(s))
    .map((s) => {
      const x = bySubject.get(s);
      return { subject: s, n: x.n, avg: x.t / x.n, exam: examPace(s) };
    });
  const slow = units
    .filter((u) => u.n >= MIN_TIMED && u.rn > 0 && u.rn / u.n >= KNOWN)
    .map((u) => {
      const s = bySubject.get(u.subject);
      const base = s.rn ? s.rt / s.rn : 0;
      return { key: u.key, subject: u.subject, unit: u.unit, n: u.n, avg: u.rt / u.rn, base, accuracy: u.rn / u.n };
    })
    .filter((u) => u.base > 0 && u.avg >= u.base * SLOW)
    .sort((a, b) => b.avg / b.base - a.avg / a.base);
  return { subjects: out, slow };
}
