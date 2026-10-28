import { describe, expect, it } from 'vitest';
import { accuracyOf, dailySeries, daysUntil, subjectStats, weakUnits } from '../src/analysis.js';
import { UNITS } from '../src/units.js';

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
