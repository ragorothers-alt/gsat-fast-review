import { describe, expect, it } from 'vitest';
import { DAY, INTERVALS, MAX_BOX, buildQueue, isWeak, mastery, schedule } from '../src/srs.js';

const NOW = 1_700_000_000_000;

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const q = (id, subject = 'math', extra = {}) => ({ id, subject, formula: false, ...extra });

describe('schedule', () => {
  it('第一次就答對直接跳到第 2 盒（隔天）', () => {
    const c = schedule(undefined, 'right', NOW);
    expect(c.box).toBe(2);
    expect(c.due).toBe(NOW + INTERVALS[2]);
    expect(c).toMatchObject({ seen: 1, right: 1, wrong: 0, parked: false });
  });

  it('之後答對逐盒上升，最高停在最後一盒', () => {
    let c = schedule(undefined, 'wrong', NOW);
    c = schedule(c, 'right', NOW);
    expect(c.box).toBe(1);
    for (let i = 0; i < 10; i++) c = schedule(c, 'right', NOW);
    expect(c.box).toBe(MAX_BOX);
    expect(c.due).toBe(NOW + INTERVALS[MAX_BOX]);
  });

  it('答錯回到第 0 盒，很快再出現', () => {
    let c = schedule(undefined, 'right', NOW);
    c = schedule(c, 'wrong', NOW);
    expect(c.box).toBe(0);
    expect(c.due).toBe(NOW + INTERVALS[0]);
    expect(c.wrong).toBe(1);
  });

  it('看解答不改盒子，但放進錯題本且立即到期', () => {
    let c = schedule(undefined, 'right', NOW);
    c = schedule(c, 'skip', NOW + 5);
    expect(c.box).toBe(2);
    expect(c.parked).toBe(true);
    expect(c.due).toBe(NOW + 5);
    expect(isWeak(c)).toBe(true);
    // 之後答對就離開錯題本
    expect(isWeak(schedule(c, 'right', NOW + 10))).toBe(false);
  });

  it('答錯後要升到第 3 盒才離開錯題本', () => {
    let c = schedule(undefined, 'wrong', NOW);
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', NOW); // 1
    c = schedule(c, 'right', NOW); // 2
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', NOW); // 3
    expect(isWeak(c)).toBe(false);
  });
});

describe('mastery', () => {
  it('沒看過算 0，全部最高盒算 1', () => {
    const qs = [q('a'), q('b')];
    expect(mastery(qs, {})).toBe(0);
    expect(mastery(qs, { a: { box: MAX_BOX }, b: { box: MAX_BOX } })).toBe(1);
    expect(mastery(qs, { a: { box: MAX_BOX } })).toBe(0.5);
    expect(mastery([], {})).toBe(0);
  });
});

describe('buildQueue', () => {
  const bank = [
    q('m1'), q('m2'), q('m3'), q('m4', 'math', { formula: true }),
    q('p1', 'physics', { formula: true }), q('c1', 'chinese'),
  ];

  it('只出選取的科目，且不超過指定題數', () => {
    const out = buildQueue(bank, {}, { subjects: ['math'], size: 3, now: NOW, rng: seeded() });
    expect(out).toHaveLength(3);
    expect(out.every((x) => x.subject === 'math')).toBe(true);
  });

  it('公式特訓只出 formula 題', () => {
    const out = buildQueue(bank, {}, { subjects: ['math', 'physics', 'chinese'], formulaOnly: true, size: 10, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id).sort()).toEqual(['m4', 'p1']);
  });

  it('到期的複習題與新題交錯，未到期的排最後', () => {
    const cards = {
      m1: { box: 0, due: NOW - 1 }, // 到期
      m2: { box: 3, due: NOW + DAY }, // 未到期
    };
    const out = buildQueue(bank, cards, { subjects: ['math'], size: 4, now: NOW, rng: seeded() });
    expect(out[0].id).toBe('m1');
    expect(['m3', 'm4']).toContain(out[1].id);
    expect(out[3].id).toBe('m2');
  });

  it('錯題複習只出錯題本裡的題目，先到期的先出', () => {
    const cards = {
      m1: { box: 0, wrong: 1, due: NOW + 50 },
      m2: { box: 2, parked: true, due: NOW + 10 },
      m3: { box: 4, wrong: 1, due: NOW }, // 已經熟了
    };
    const out = buildQueue(bank, cards, { subjects: ['math'], weakOnly: true, size: 10, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id)).toEqual(['m2', 'm1']);
  });
});
