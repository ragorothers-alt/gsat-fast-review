import { describe, expect, it } from 'vitest';
import { DAY, INTERVALS, MAX_BOX, NEW_EVERY, buildQueue, everMissed, isWeak, mastery, neverMissed, schedule } from '../src/srs.js';

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

  it('到期後答對逐盒上升，最高停在最後一盒', () => {
    let c = schedule(undefined, 'wrong', NOW);
    c = schedule(c, 'right', c.due);
    expect(c.box).toBe(1);
    for (let i = 0; i < 10; i++) c = schedule(c, 'right', c.due);
    expect(c.box).toBe(MAX_BOX);
    expect(c.due).toBe(c.last + INTERVALS[MAX_BOX]);
  });

  it('答錯過的題目隔 16 天還答得對，下次拉長到 35 天', () => {
    let c = schedule(undefined, 'wrong', NOW);
    while (c.box < 5) c = schedule(c, 'right', c.due);
    expect(c.due - c.last).toBe(16 * DAY);
    c = schedule(c, 'right', c.due);
    expect(c.due - c.last).toBe(35 * DAY);
  });

  it('還沒到期就又答對：記下次數，但不升盒、到期時間不變（連刷幾輪不能清空錯題本）', () => {
    const wrong = schedule(undefined, 'wrong', NOW);
    let c = wrong;
    for (let i = 1; i <= 3; i++) c = schedule(c, 'right', NOW + i * 1000);
    expect(c).toMatchObject({ box: 0, due: wrong.due, seen: 4, right: 3, wrong: 1, last: NOW + 3000 });
    expect(isWeak(c)).toBe(true);
    // 到期之後答對才升盒
    expect(schedule(c, 'right', wrong.due).box).toBe(1);
  });

  it('答錯回到第 0 盒，很快再出現', () => {
    let c = schedule(undefined, 'right', NOW);
    c = schedule(c, 'wrong', NOW);
    expect(c.box).toBe(0);
    expect(c.due).toBe(NOW + INTERVALS[0]);
    expect(c.wrong).toBe(1);
  });

  it('按「不會」等同答錯：回到第 0 盒、進錯題本，但不算答錯次數', () => {
    let c = schedule(undefined, 'right', NOW);
    c = schedule(c, 'right', NOW); // 第 3 盒
    c = schedule(c, 'skip', NOW + 5);
    expect(c).toMatchObject({ box: 0, parked: true, wrong: 0, due: NOW + 5 + INTERVALS[0] });
    expect(isWeak(c)).toBe(true);
  });

  it('答對後標「猜對的」等同不會：回到第 0 盒、進錯題本，答對次數不加', () => {
    const before = schedule(schedule(undefined, 'right', NOW), 'right', NOW); // 第 3 盒
    const c = schedule(before, 'guess', NOW + 5);
    expect(c).toMatchObject({ box: 0, parked: true, seen: 3, right: 2, wrong: 0, due: NOW + 5 + INTERVALS[0] });
    expect(isWeak(c)).toBe(true);
  });

  it('標「不太確定」：10 分鐘後再考，留在錯題本直到升回第 3 盒', () => {
    let c = schedule(undefined, 'unsure', NOW);
    expect(c).toMatchObject({ box: 1, parked: false, seen: 1, right: 0, wrong: 0, due: NOW + INTERVALS[1] });
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', c.due); // 2
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', c.due); // 3
    expect(isWeak(c)).toBe(false);
  });

  it('按「不會」之後，答對一次還不能離開錯題本，要升到第 3 盒', () => {
    let c = schedule(undefined, 'skip', NOW);
    c = schedule(c, 'right', c.due); // 1
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', c.due); // 2
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', c.due); // 3
    expect(isWeak(c)).toBe(false);
  });

  it('答錯後要升到第 3 盒才離開錯題本', () => {
    let c = schedule(undefined, 'wrong', NOW);
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', c.due); // 1
    c = schedule(c, 'right', c.due); // 2
    expect(isWeak(c)).toBe(true);
    c = schedule(c, 'right', c.due); // 3
    expect(isWeak(c)).toBe(false);
  });
});

describe('neverMissed', () => {
  it('答對過、從沒失手才算；答錯、看解答、標成猜的或不太確定過都不算', () => {
    const right = schedule(undefined, 'right', NOW);
    expect(neverMissed(right)).toBe(true);
    expect(neverMissed(schedule(right, 'right', NOW + DAY))).toBe(true);
    expect(neverMissed(schedule(right, 'wrong', NOW + DAY))).toBe(false);
    for (const first of ['wrong', 'skip', 'guess', 'unsure']) {
      expect(neverMissed(schedule(schedule(undefined, first, NOW), 'right', NOW + DAY))).toBe(false);
    }
    expect(neverMissed(undefined)).toBe(false);
  });

  it('兩台裝置合併後答錯次數還在，就不算', () => {
    expect(neverMissed({ box: 2, seen: 1, right: 1, wrong: 1 })).toBe(false);
  });

  it('失手過就記下 missed，之後再答對幾次都不會消失', () => {
    let c = schedule(undefined, 'skip', NOW);
    expect(c.missed).toBe(1);
    for (let i = 0; i < 6; i++) c = schedule(c, 'right', c.due);
    expect(c).toMatchObject({ box: MAX_BOX, missed: 1 });
    expect(neverMissed(c)).toBe(false);
    expect(schedule(undefined, 'right', NOW).missed).toBe(0);
  });

  it('沒有 missed 欄位的舊紀錄：從次數、盒子與 parked 推回來', () => {
    expect(everMissed({ box: 2, seen: 1, right: 1, wrong: 0, parked: false })).toBe(false);
    // 合併後次數被拉平，但盒子或 parked 還留著看過解答的痕跡
    expect(everMissed({ box: 0, seen: 1, right: 1, wrong: 0, parked: true })).toBe(true);
    expect(everMissed({ box: 1, seen: 2, right: 2, wrong: 0, parked: false })).toBe(true);
    expect(everMissed({ box: 3, seen: 3, right: 2, wrong: 0, parked: false })).toBe(true);
  });
});

describe('mastery', () => {
  it('沒看過算 0，全部最高盒算 1', () => {
    const qs = [q('a'), q('b')];
    expect(mastery(qs, {})).toBe(0);
    expect(mastery(qs, { a: { box: MAX_BOX }, b: { box: MAX_BOX } })).toBe(1);
    expect(mastery(qs, { a: { box: MAX_BOX } })).toBe(0.5);
    // 隔 16 天答對（第 5 盒）就算熟，再拉長間隔也不會超過 100%
    expect(mastery(qs, { a: { box: 5 }, b: { box: 6 } })).toBe(1);
    expect(mastery([], {})).toBe(0);
  });

  it('答對過、從沒失手的不再複習，算滿', () => {
    expect(mastery([q('a'), q('b')], { a: schedule(undefined, 'right', NOW) })).toBe(0.5);
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

  it('關掉的單元不出題', () => {
    const units = [q('u1', 'math', { topic: '機率' }), q('u2', 'math', { topic: '矩陣' }), q('u3', 'physics', { topic: '矩陣' })];
    const out = buildQueue(units, {}, { subjects: ['math', 'physics'], excludedUnits: ['math/矩陣'], size: 10, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id).sort()).toEqual(['u1', 'u3']);
  });

  it('onlyUnits 只出指定的單元', () => {
    const units = [q('u1', 'math', { topic: '機率' }), q('u2', 'math', { topic: '矩陣' }), q('u3', 'physics', { topic: '矩陣' })];
    const out = buildQueue(units, {}, { subjects: ['math', 'physics'], onlyUnits: ['physics/矩陣'], size: 10, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id)).toEqual(['u3']);
  });

  it('exclude 的題目這批先不出', () => {
    const out = buildQueue(bank, {}, { subjects: ['math'], exclude: ['m1', 'm3'], size: 10, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id).sort()).toEqual(['m2', 'm4']);
  });

  it('公式特訓只出 formula 題', () => {
    const out = buildQueue(bank, {}, { subjects: ['math', 'physics', 'chinese'], formulaOnly: true, size: 10, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id).sort()).toEqual(['m4', 'p1']);
  });

  it('快閃不出要動筆的演算題和多選題，其他模式照出', () => {
    const slow = [...bank, q('m9', 'math', { scratch: true }), q('m8', 'math', { type: 'ms', choices: ['a', 'b', 'c', 'd', 'e'], answer: [0] })];
    const opts = { subjects: ['math'], size: 10, now: NOW, rng: seeded() };
    const quick = buildQueue(slow, {}, { ...opts, quickOnly: true }).map((x) => x.id);
    expect(quick).not.toContain('m9');
    expect(quick).not.toContain('m8');
    expect(buildQueue(slow, {}, opts).map((x) => x.id)).toEqual(expect.arrayContaining(['m9', 'm8']));
  });

  it('到期的複習題先出，新題接著出，未到期的排最後', () => {
    const cards = {
      m1: { box: 0, due: NOW - 1 }, // 到期
      m2: { box: 3, due: NOW + DAY }, // 未到期
    };
    const out = buildQueue(bank, cards, { subjects: ['math'], size: 4, now: NOW, rng: seeded() });
    expect(out[0].id).toBe('m1');
    expect(['m3', 'm4']).toContain(out[1].id);
    expect(out[3].id).toBe('m2');
  });

  it('到期的複習多時：每 4 題留 1 題給新題；複習出完了就全出新題', () => {
    const many = [...Array(12)].map((_, i) => q(`d${i}`));
    const fresh = [...Array(12)].map((_, i) => q(`n${i}`));
    const cards = Object.fromEntries(many.map((x) => [x.id, { box: 2, due: NOW - 1, seen: 2, right: 1, wrong: 1 }]));
    const kinds = (n, list) => buildQueue(list, cards, { subjects: ['math'], size: n, now: NOW, rng: seeded() }).map((x) => x.id[0]).join('');
    expect(kinds(8, [...many, ...fresh])).toBe('dddndddn');
    expect(kinds(8, [...many.slice(0, 3), ...fresh])).toBe('dddnnnnn');
    expect(NEW_EVERY).toBe(4);
  });

  it('答對過、從沒失手的題目不再出，到期了也不出；答錯過的照常複習', () => {
    const cards = {
      m1: { box: 2, due: NOW - 1, seen: 1, right: 1, wrong: 0 }, // 一次就答對，已到期
      m2: { box: 4, due: NOW + DAY, seen: 3, right: 3, wrong: 0 }, // 答對三次，還沒到期
      m3: { box: 1, due: NOW - 1, seen: 2, right: 1, wrong: 1 }, // 答錯過、後來答對
    };
    const out = buildQueue(bank, cards, { subjects: ['math'], size: 10, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id).sort()).toEqual(['m3', 'm4']);
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
