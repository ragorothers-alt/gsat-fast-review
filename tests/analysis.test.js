import { describe, expect, it } from 'vitest';
import { LOW_STOCK, accuracyOf, bankStock, dailySeries, daysUntil, lowStock, studyPlan, subjectStats, weakUnits } from '../src/analysis.js';
import { GOALS } from '../src/stats.js';
import { CROSS_UNIT, UNITS } from '../src/units.js';

const [U1, U2, U3] = UNITS.math;
const q = (id, topic) => ({ id, subject: 'math', topic });
const bank = [q('a1', U1), q('a2', U1), q('b1', U2), q('b2', U2), q('c1', U3)];
const c = (seen, right, extra = {}) => ({ box: 1, due: 0, seen, right, wrong: seen - right, parked: false, last: 1, ...extra });

describe('weakUnits', () => {
  it('依平滑後的失誤率排序，作答太少的單元不列入', () => {
    const cards = { a1: c(4, 3), a2: c(4, 3), b1: c(3, 0), b2: c(3, 1), c1: c(2, 0) };
    const out = weakUnits(bank, cards, { subjects: ['math'], limit: 5 });
    expect(out.map((u) => u.unit)).toEqual([U2, U1]);
    expect(out[0]).toMatchObject({ seen: 6, misses: 5, key: `math/${U2}` });
  });

  it('看解答也算失誤；關掉的單元不列入', () => {
    const cards = { a1: c(5, 0, { wrong: 0, parked: true }), b1: c(5, 0) };
    const out = weakUnits(bank, cards, { subjects: ['math'], excludedUnits: [`math/${U2}`] });
    expect(out.map((u) => u.unit)).toEqual([U1]);
  });

  it('全部答對時沒有弱點單元', () => {
    expect(weakUnits(bank, { a1: c(6, 6) }, { subjects: ['math'] })).toEqual([]);
  });
});

describe('統計', () => {
  it('各科練過題數與正確率', () => {
    const [s] = subjectStats(bank, { a1: c(2, 1), b1: c(2, 2) }, ['math']);
    expect(s).toMatchObject({ total: 5, practiced: 2, accuracy: 0.75 });
  });

  it('每日走勢含今天、沒練的日子補 0', () => {
    const now = new Date(2026, 9, 28, 15).getTime();
    const series = dailySeries({ '2026-10-28': { answered: 4, right: 3 }, '2026-10-26': { answered: 2, right: 1 } }, now, 3);
    expect(series.map((d) => d.answered)).toEqual([2, 0, 4]);
    expect(accuracyOf(series)).toBeCloseTo(4 / 6);
    expect(accuracyOf([])).toBeNull();
  });

  it('學測倒數以本地日期計算', () => {
    const now = new Date(2026, 9, 28, 23, 30).getTime();
    expect(daysUntil('2026-10-29', now)).toBe(1);
    expect(daysUntil('2026-10-28', now)).toBe(0);
    expect(daysUntil('2027-01-22', now)).toBe(86);
  });
});

describe('題庫存量', () => {
  const many = (prefix, topic, n) => Array.from({ length: n }, (_, i) => q(`${prefix}${i}`, topic));
  const stocked = [...many('a', U1, 40), ...many('b', U2, 35)];
  const unit = (stock, name) => stock.subjects[0].units.find((u) => u.unit === name);

  it('各科、各單元還有幾題沒做過；被回報暫停出題的不算', () => {
    const s = bankStock(stocked, { a0: c(1, 1), a1: c(1, 0), b0: c(2, 1) }, { subjects: ['math'], flags: { a2: 1 } });
    expect(s).toMatchObject({ total: 74, fresh: 71 });
    expect(s.subjects[0]).toMatchObject({ subject: 'math', total: 74, fresh: 71 });
    expect(unit(s, U1)).toMatchObject({ total: 39, fresh: 37 });
    expect(unit(s, U2)).toMatchObject({ total: 35, fresh: 34 });
  });

  it('關掉的單元不列也不算，結合了它的跨單元題也不算', () => {
    const cross = (id, links) => ({ ...q(id, CROSS_UNIT), links });
    const s = bankStock([q('a', U1), q('b', U2), cross('x', [U1, U2]), cross('y', [U1, U3])], {}, { subjects: ['math'], excludedUnits: [`math/${U2}`] });
    expect(unit(s, U2)).toBeUndefined();
    expect(unit(s, CROSS_UNIT)).toMatchObject({ total: 1, fresh: 1 });
    expect(s.total).toBe(2);
  });

  it(`新題不到 ${LOW_STOCK} 題的單元算快用完，剩得少的排前面；沒有題目的單元不算`, () => {
    const cards = Object.fromEntries(many('a', U1, 15).map((x) => [x.id, c(1, 1)]));
    expect(lowStock(bankStock(stocked, cards, { subjects: ['math'] })).map((u) => [u.unit, u.fresh])).toEqual([[U1, 25]]);
    const all = Object.fromEntries(stocked.map((x) => [x.id, c(1, 1)]));
    expect(lowStock(bankStock(stocked, all, { subjects: ['math'] })).map((u) => [u.unit, u.fresh])).toEqual([
      [U1, 0],
      [U2, 0],
    ]);
  });
});

describe('studyPlan', () => {
  it('照目前步調推估考前能練到多少，並算出全部練完一輪每天要做幾題', () => {
    const p = studyPlan({ total: 1000, practiced: 200, daysLeft: 40, pace: 30, goals: GOALS });
    // 每天 30 題、新題占一半 → 40 天 600 題新題
    expect(p).toMatchObject({ remaining: 800, projected: 600, coverage: 0.2, projectedCoverage: 0.8 });
    // 剩 800 題、40 天、新題占一半 → 每天 40 題，建議目標 50
    expect(p.needDaily).toBe(40);
    expect(p.suggest).toBe(50);
  });

  it('題目太多時沒有夠用的目標；已經全部練過就不用再加量', () => {
    expect(studyPlan({ total: 10000, practiced: 0, daysLeft: 30, pace: 0, goals: GOALS })).toMatchObject({ projected: 0, needDaily: 667, suggest: null });
    expect(studyPlan({ total: 500, practiced: 500, daysLeft: 10, pace: 30, goals: GOALS })).toMatchObject({ remaining: 0, needDaily: 0, suggest: 10 });
  });
});
