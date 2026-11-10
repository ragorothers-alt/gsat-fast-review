import { describe, expect, it } from 'vitest';
import { MAX_SECS, MIN_TIMED, cleanPace, examPace, isTimed, mergePace, paceReport, recordPace } from '../src/pace.js';
import { parseState } from '../src/storage.js';
import { LEECH_MISSES, isLeech, missCount, schedule } from '../src/srs.js';

const q = (extra = {}) => ({ id: 'math-001', subject: 'math', topic: '機率', type: 'mc', ...extra });

describe('recordPace', () => {
  it('照單元累計作答與答對的題數、秒數；看解答的不算', () => {
    const state = {};
    recordPace(state, q(), 'right', 12);
    recordPace(state, q(), 'wrong', 20);
    recordPace(state, q(), 'skip', 5);
    expect(state.pace).toEqual({ 'math/機率': { n: 2, t: 32, rn: 1, rt: 12 } });
  });

  it('演算題、多選題、題組、圖表題不計時；放下手機太久的也不算', () => {
    const state = {};
    for (const extra of [{ scratch: true }, { type: 'ms' }, { group: 'math-g001' }, { fig: { type: 'table' } }]) {
      expect(isTimed(q(extra))).toBe(false);
      recordPace(state, q(extra), 'right', 10);
    }
    recordPace(state, q(), 'right', MAX_SECS + 1);
    recordPace(state, q(), 'right', 0);
    recordPace(state, q(), 'right', NaN);
    expect(state.pace ?? {}).toEqual({});
    expect(isTimed(q({ type: 'tf' }))).toBe(true);
  });
});

describe('cleanPace / mergePace / 存檔', () => {
  it('格式不對的紀錄丟掉', () => {
    expect(cleanPace({ a: { n: 2, t: 30, rn: 1, rt: 10 }, b: { n: 0, t: 0, rn: 0, rt: 0 }, c: { n: 'x' }, d: null })).toEqual({ a: { n: 2, t: 30, rn: 1, rt: 10 } });
    expect(cleanPace(null)).toEqual({});
    expect(cleanPace([1, 2])).toEqual({});
  });

  it('兩個分頁各記了一部分：每個單元留題數多的那份', () => {
    const a = { x: { n: 5, t: 50, rn: 4, rt: 40 }, y: { n: 1, t: 9, rn: 1, rt: 9 } };
    const b = { x: { n: 7, t: 80, rn: 5, rt: 52 }, z: { n: 2, t: 20, rn: 0, rt: 0 } };
    expect(mergePace(a, b)).toEqual({ x: b.x, y: a.y, z: b.z });
  });

  it('舊存檔沒有 pace：讀進來是空的；壞掉的 pace 不會讓整份存檔讀不了', () => {
    expect(parseState('{"cards":{}}').pace).toEqual({});
    expect(parseState('{"cards":{},"pace":"oops"}').pace).toEqual({});
  });
});

describe('paceReport', () => {
  it('各科的平均秒數，旁邊附學測這科平均每題的時間', () => {
    const pace = { 'math/機率': { n: 10, t: 300, rn: 8, rt: 200 }, 'math/矩陣': { n: 10, t: 100, rn: 9, rt: 90 }, 'physics/電與磁': { n: 4, t: 40, rn: 4, rt: 40 } };
    const { subjects } = paceReport(pace, { subjects: ['math', 'physics', 'chinese'] });
    expect(subjects).toEqual([
      { subject: 'math', n: 20, avg: 20, exam: examPace('math') },
      { subject: 'physics', n: 4, avg: 10, exam: examPace('physics') },
    ]);
    expect(examPace('math')).toBe(Math.round((32 * 60) / 25));
    expect(examPace('nope')).toBeNull();
  });

  it('會但花得久的單元：答對率夠、計時題數夠，答對時比同一科平均慢四成以上', () => {
    const pace = {
      'math/機率': { n: 10, t: 400, rn: 8, rt: 320 }, // 答對平均 40 秒
      'math/矩陣': { n: 20, t: 300, rn: 18, rt: 270 }, // 15 秒
      'math/數與式': { n: MIN_TIMED - 1, t: 420, rn: 7, rt: 420 }, // 答對平均 60 秒，但題數不夠
      'math/三角比': { n: 10, t: 700, rn: 3, rt: 180 }, // 答對平均 60 秒，但答對率太低：是不會，不是慢
      'math/數列與級數': { n: 30, t: 450, rn: 30, rt: 450 }, // 15 秒
    };
    const { slow } = paceReport(pace, { subjects: ['math'] });
    expect(slow.map((u) => u.unit)).toEqual(['機率']);
    expect(slow[0]).toMatchObject({ key: 'math/機率', subject: 'math', avg: 40, accuracy: 0.8 });
    // 這科答對的平均：(320+270+420+180+450) ÷ (8+18+7+3+30)
    expect(slow[0].base).toBeCloseTo(1640 / 66);
  });

  it('沒選的科目、關掉的單元不算', () => {
    const pace = { 'math/機率': { n: 10, t: 100, rn: 10, rt: 100 }, 'earth/海洋': { n: 10, t: 100, rn: 10, rt: 100 } };
    expect(paceReport(pace, { subjects: ['math'], excludedUnits: ['math/機率'] })).toEqual({ subjects: [], slow: [] });
    expect(paceReport(undefined, { subjects: ['math'] })).toEqual({ subjects: [], slow: [] });
  });
});

describe('卡關的題目（isLeech）', () => {
  const NOW = 1_700_000_000_000;

  it('失手三次以上還在錯題本裡才算；看解答、標成猜的也算失手', () => {
    let c = schedule(undefined, 'wrong', NOW);
    c = schedule(c, 'skip', NOW + 1);
    expect(missCount(c)).toBe(2);
    expect(isLeech(c)).toBe(false);
    c = schedule(c, 'guess', NOW + 2);
    expect(missCount(c)).toBe(LEECH_MISSES);
    expect(isLeech(c)).toBe(true);
  });

  it('後來隔開時間答對、離開錯題本就不算了；沒做過的也不算', () => {
    let c = schedule(undefined, 'wrong', NOW);
    for (let i = 0; i < 2; i++) c = schedule(c, 'wrong', NOW + i + 1);
    for (let i = 0; i < 3; i++) c = schedule(c, 'right', c.due);
    expect(missCount(c)).toBe(3);
    expect(isLeech(c)).toBe(false);
    expect(isLeech(undefined)).toBe(false);
    expect(missCount(undefined)).toBe(0);
  });
});
