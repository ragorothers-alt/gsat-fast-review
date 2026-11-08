import { describe, expect, it } from 'vitest';
import { applyPathRows, currentUnit, followUp, markCleared, pathProgress, pathRows, pathUnits, resetProgress, resumeRun, settleRuns, unitStatus } from '../src/path.js';
import { UNITS, unitKey } from '../src/units.js';

const units = ['A', 'B', 'C'];
const run = (ids, index, extra = []) => ({ ids, index, extra });

describe('pathUnits', () => {
  it('照單元順序，跳過在「選單元」關掉的', () => {
    const all = UNITS.physics;
    expect(pathUnits('physics')).toEqual(all);
    expect(pathUnits('physics', [unitKey('physics', all[1])])).toEqual(all.filter((_, i) => i !== 1));
  });
});

describe('闖關進度的合併（線上同步、兩個分頁）', () => {
  /** 把 b 的進度併進 a（跟雲端拉回來的列同一套規則） */
  const absorb = (a, b, since = 0) => applyPathRows(a, pathRows(b, since));

  it('兩台各自過關的單元都留下；做到一半的關以較晚的為準', () => {
    const a = { math: { cleared: [], runs: { B: { ...run(['x', 'y', 'z'], 1), at: 10 } } } };
    markCleared(a.math, 'A', 20);
    const b = { math: { cleared: [], runs: { B: { ...run(['x', 'y', 'z'], 2), at: 30 } } }, physics: { cleared: [], runs: {} } };
    markCleared(b.physics, '力學', 25);
    expect(absorb(a, b)).toBe(2);
    expect(a.math.cleared).toEqual(['A']);
    expect(a.math.runs.B).toMatchObject({ index: 2, at: 30 });
    expect(a.physics.cleared).toEqual(['力學']);
    // 再併一次不會變
    expect(absorb(a, b)).toBe(0);
    // 反過來併：較舊的那份不會蓋掉較新的
    expect(absorb(b, a)).toBe(1);
    expect(b.math.cleared).toEqual(['A']);
    expect(b.math.runs.B.index).toBe(2);
  });

  it('一台做完的關，另一台還留著較早的進行中紀錄：併進來後拿掉', () => {
    const a = { math: { cleared: [], runs: { A: { ...run(['x', 'y'], 1), at: 10 } } } };
    const b = { math: { cleared: [], runs: {} } };
    markCleared(b.math, 'A', 20);
    absorb(a, b);
    expect(a.math.cleared).toEqual(['A']);
    expect(a.math.runs).toEqual({});
    // 過關之後又重闖這關：較晚的進行中紀錄留著
    b.math.runs.A = { ...run(['x', 'y'], 0), at: 30 };
    absorb(a, b);
    expect(a.math.runs.A).toMatchObject({ at: 30 });
    expect(a.math.cleared).toEqual(['A']);
  });

  it('從第一關重新闖：比它早的過關與進行中的關都不算，之後的照算；另一台舊的進度不會加回來', () => {
    const a = { math: { cleared: [], runs: { C: { ...run(['x'], 0), at: 15 } } } };
    markCleared(a.math, 'A', 10);
    markCleared(a.math, 'B', 12);
    const b = structuredClone(a);
    b.math = resetProgress(20);
    markCleared(b.math, 'A', 30);
    absorb(a, b);
    expect(a.math).toEqual({ cleared: ['A'], runs: {}, clearedAt: { A: 30 }, resetAt: 20 });
    absorb(b, a);
    expect(b.math.cleared).toEqual(['A']);
    expect(b.math.runs).toEqual({});
  });

  it('舊紀錄沒有時間：第一次同步照樣上傳；有人重新闖過就不算', () => {
    const legacy = { math: { cleared: ['A'], runs: { B: run(['x'], 0) } } };
    expect(pathRows(legacy, 0)).toEqual([
      ['math', 'A', 1, 0, null],
      ['math', 'B', 0, 1, { ids: ['x'], index: 0, extra: [] }],
    ]);
    expect(pathRows(legacy, 5)).toEqual([]);
    applyPathRows(legacy, [['math', '', 7, 0, null]]);
    expect(legacy.math).toEqual({ cleared: [], runs: {}, resetAt: 7 });
  });

  it('只上傳 since 之後變動的單元；格式不對的列略過', () => {
    const p = { math: { cleared: [], runs: { B: { ...run(['x'], 0), at: 50 } } } };
    markCleared(p.math, 'A', 10);
    expect(pathRows(p, 20).map((r) => r[1])).toEqual(['B']);
    expect(applyPathRows(p, [['math', 'C'], null, ['math', 'C', 'x', 0, null], ['math', 'D', 0, 9, { ids: 'bad' }]])).toBe(0);
  });
});

describe('闖關進度', () => {
  it('沒有紀錄時建一份空的，從第一關開始，後面的關鎖住', () => {
    const state = {};
    const prog = pathProgress(state, 'math');
    expect(state.path.math).toBe(prog);
    expect(pathProgress(state, 'math')).toBe(prog);
    expect(currentUnit(units, prog)).toBe('A');
    expect(units.map((u) => unitStatus(units, prog, u))).toEqual(['current', 'locked', 'locked']);
  });

  it('那關的題目全部答完才過關，解鎖下一關', () => {
    const prog = { cleared: [], runs: { A: run(['x', 'y'], 1) } };
    settleRuns(prog);
    expect(prog.runs.A).toBeDefined();
    prog.runs.A.index = 2;
    settleRuns(prog, 5);
    expect(prog).toEqual({ cleared: ['A'], runs: {}, clearedAt: { A: 5 } });
    expect(currentUnit(units, prog)).toBe('B');
    expect(units.map((u) => unitStatus(units, prog, u))).toEqual(['done', 'current', 'locked']);
  });

  it('重闖已過關的單元另外記，不會蓋掉正在闖的那關；過關也不會重複記', () => {
    const prog = { cleared: ['A'], runs: { A: run(['x'], 0), B: run(['y', 'z'], 1) } };
    expect(currentUnit(units, prog)).toBe('B');
    expect(unitStatus(units, prog, 'A')).toBe('done');
    prog.runs.A.index = 1;
    settleRuns(prog);
    expect(prog.cleared).toEqual(['A']);
    expect(prog.runs).toEqual({ B: run(['y', 'z'], 1) });
  });

  it('前面的單元在「選單元」打開後要先過，但做到一半的關還是可以接著做', () => {
    const prog = { cleared: ['A'], runs: { C: run(['x'], 0) } };
    expect(currentUnit(units, prog)).toBe('B');
    expect(units.map((u) => unitStatus(units, prog, u))).toEqual(['done', 'current', 'current']);
  });

  it('全部過關回傳 null', () => {
    expect(currentUnit(units, { cleared: ['C', 'A', 'B'], runs: {} })).toBeNull();
  });
});

describe('resumeRun', () => {
  const run = { ids: ['a', 'b', 'c', 'd', 'e'], index: 3 };

  it('下一題前面少了一題，位置跟著往前，不會跳過還沒答的題', () => {
    expect(resumeRun(run, (id) => id !== 'b')).toEqual({ ids: ['a', 'c', 'd', 'e'], index: 2 });
  });

  it('還沒答的題被略過，接著做下一題', () => {
    expect(resumeRun(run, (id) => id !== 'd')).toEqual({ ids: ['a', 'b', 'c', 'e'], index: 3 });
  });

  it('剩下的題都被略過：位置到底', () => {
    const { ids, index } = resumeRun(run, (id) => id !== 'd' && id !== 'e');
    expect(index).toBe(ids.length);
  });
});

describe('followUp', () => {
  const q = (id, topic, text) => ({ id, subject: 'chemistry', topic, q: text, explain: '' });
  const bank = [
    q('c1', '酸鹼', '鹽酸在水中完全解離，是強酸。'),
    q('c2', '酸鹼', '鹽酸完全解離，所以是強酸嗎？'),
    q('c3', '酸鹼', '醋酸是弱酸。'),
    q('c4', '原子結構', '鹽酸完全解離是強酸的原因。'),
  ];

  it('補同單元最像、這關還沒出過的題', () => {
    expect(followUp(bank, bank[0], ['c1']).id).toBe('c2');
    expect(followUp(bank, bank[0], ['c1', 'c2']).id).toBe('c3');
  });

  it('被回報的不出；同單元都出過了就再考這題本身', () => {
    expect(followUp(bank, bank[0], ['c1'], ['c2']).id).toBe('c3');
    expect(followUp(bank, bank[0], ['c1', 'c2', 'c3'])).toBe(bank[0]);
  });
});
