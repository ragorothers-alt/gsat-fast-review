import { describe, expect, it } from 'vitest';
import { currentUnit, followUp, pathProgress, pathUnits, settleRuns, unitStatus } from '../src/path.js';
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
    settleRuns(prog);
    expect(prog).toEqual({ cleared: ['A'], runs: {} });
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
