import { describe, expect, it } from 'vitest';
import { subjectWeights } from '../src/blueprint.js';
import { levelWeight, orderFresh, unitPriority, unitShares, unitSkill } from '../src/priority.js';
import { neverMissed, schedule } from '../src/srs.js';
import { UNITS, unitKey } from '../src/units.js';

const NOW = 1_800_000_000_000;
function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}
const q = (id, subject, topic, level = 2) => ({ id, subject, topic, level });
const sum = (map) => [...map.values()].reduce((a, b) => a + b, 0);

describe('學測分量', () => {
  it('每張考卷一樣重，合科試卷再依各科小題數分', () => {
    const w = subjectWeights(['math', 'physics', 'chemistry']);
    expect(w.math).toBeCloseTo(0.5);
    expect(w.physics + w.chemistry).toBeCloseTo(0.5);
    expect(w.physics).toBeGreaterThan(w.chemistry);
  });

  it('各單元的分量合計為 1；學測考得多的單元分量大', () => {
    const shares = unitShares(['physics', 'english']);
    expect(sum(shares)).toBeCloseTo(1);
    expect(shares.get('physics/波動與光')).toBeGreaterThan(shares.get('physics/克卜勒定律與萬有引力') * 5);
    // 沒列在藍圖或占比很低的單元也保留一點分量
    for (const u of UNITS.physics) expect(shares.get(unitKey('physics', u))).toBeGreaterThan(0);
  });
});

describe('單元熟練度與優先度', () => {
  const bank = [q('p1', 'physics', '波動與光'), q('p2', 'physics', '波動與光'), q('p3', 'physics', '波動與光'), q('k1', 'physics', '克卜勒定律與萬有引力')];

  it('練過的題目裡第一次就答對、沒失手的比例越高，熟練度越高', () => {
    const cards = { p1: schedule(undefined, 'right', NOW), p2: schedule(undefined, 'right', NOW), p3: schedule(undefined, 'wrong', NOW) };
    const skill = unitSkill(bank, cards, ['physics'], neverMissed);
    expect(skill.get('physics/波動與光')).toMatchObject({ n: 3, known: 2 });
    expect(skill.get('physics/波動與光').p).toBeCloseTo(3 / 5);
    expect(skill.has('physics/克卜勒定律與萬有引力')).toBe(false);
  });

  it('同樣分量：還不熟的單元比熟的優先；沒練過的有探索加成', () => {
    const weak = unitPriority(0.1, { n: 20, p: 0.3 });
    const strong = unitPriority(0.1, { n: 20, p: 0.95 });
    const unseen = unitPriority(0.1, undefined);
    expect(weak).toBeGreaterThan(strong * 3);
    expect(unseen).toBeGreaterThan(weak);
    // 再熟也不會完全不出
    expect(unitPriority(0.1, { n: 500, p: 1 })).toBeGreaterThan(0);
  });

  it('還不熟多出基礎題，熟了多出難題', () => {
    expect(levelWeight(1, 0.2)).toBeGreaterThan(levelWeight(3, 0.2));
    expect(levelWeight(3, 0.9)).toBeGreaterThan(levelWeight(1, 0.9));
  });
});

describe('新題的出題順序', () => {
  const many = (subject, topic, n, level = 2) => [...Array(n)].map((_, i) => q(`${topic}-${i}`, subject, topic, level));

  it('學測考得多的單元出得多', () => {
    const fresh = [...many('physics', '波動與光', 200), ...many('physics', '克卜勒定律與萬有引力', 200)];
    const out = orderFresh(fresh, { shares: unitShares(['physics']), skill: new Map(), size: 100, rng: seeded() });
    const wave = out.filter((x) => x.topic === '波動與光').length;
    expect(out).toHaveLength(100);
    expect(wave).toBeGreaterThan(75);
  });

  it('同一單元裡，還不熟的先出基礎題、熟了先出難題', () => {
    const fresh = [...many('physics', '波動與光', 100, 1), ...many('physics', '波動與光', 100, 3).map((x) => ({ ...x, id: `${x.id}h` }))];
    const shares = unitShares(['physics']);
    const hard = (p) => orderFresh(fresh, { shares, skill: new Map([['physics/波動與光', { n: 30, p }]]), size: 40, rng: seeded(3) }).filter((x) => x.level === 3).length;
    expect(hard(0.2)).toBeLessThan(15);
    expect(hard(0.95)).toBeGreaterThan(25);
  });

  it('每題只出一次；單元出完了就換別的單元', () => {
    const fresh = [...many('physics', '波動與光', 3), ...many('physics', '克卜勒定律與萬有引力', 50)];
    const out = orderFresh(fresh, { shares: unitShares(['physics']), skill: new Map(), size: 20, rng: seeded() });
    expect(new Set(out.map((x) => x.id)).size).toBe(20);
    expect(out.filter((x) => x.topic === '波動與光')).toHaveLength(3);
  });
});
