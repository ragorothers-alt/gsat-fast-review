import { describe, expect, it } from 'vitest';
import { subjectWeights } from '../src/blueprint.js';
import { conceptStats, levelWeight, orderFresh, unitPriority, unitShares, unitSkill } from '../src/priority.js';
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

describe('考點：還沒練過的考點先出', () => {
  const shares = unitShares(['physics']);
  // 一個單元、每個考點 n 題
  const unit = (sizes) => Object.entries(sizes).flatMap(([kp, n]) => [...Array(n)].map((_, i) => ({ ...q(`${kp}-${i}`, 'physics', '波動與光'), kp })));
  const kinds = (out) => out.map((x) => x.kp);

  it('conceptStats：各考點在題庫裡有幾題、作答過幾題；沒標考點的題目不算', () => {
    const bank = [...unit({ a: 3, b: 2 }), q('x1', 'physics', '波動與光'), { ...q('m1', 'math', '機率'), kp: 'a' }];
    const cards = { 'a-0': schedule(undefined, 'right', NOW), 'a-1': schedule(undefined, 'wrong', NOW), x1: schedule(undefined, 'right', NOW) };
    const stats = conceptStats(bank, cards, ['physics']);
    expect(Object.fromEntries(stats)).toEqual({ 'physics/a': { size: 3, seen: 2 }, 'physics/b': { size: 2, seen: 0 } });
  });

  it('同一輪裡每個考點先各出一題，都出過了才出第二題', () => {
    const bank = unit({ a: 10, b: 10, c: 10, d: 10 });
    for (let seed = 1; seed <= 20; seed++) {
      const out = orderFresh(bank, { shares, skill: new Map(), concepts: conceptStats(bank, {}, ['physics']), size: 8, rng: seeded(seed) });
      expect(new Set(kinds(out.slice(0, 4))).size).toBe(4);
      expect(new Set(kinds(out.slice(4))).size).toBe(4);
    }
  });

  it('以前練過的考點排後面：先出還沒碰過的', () => {
    const bank = unit({ a: 10, b: 10, c: 10 });
    const cards = { 'a-0': schedule(undefined, 'right', NOW), 'b-0': schedule(undefined, 'wrong', NOW), 'b-1': schedule(undefined, 'wrong', NOW) };
    const fresh = bank.filter((x) => !cards[x.id]);
    for (let seed = 1; seed <= 20; seed++) {
      const out = orderFresh(fresh, { shares, skill: new Map(), concepts: conceptStats(bank, cards, ['physics']), size: 3, rng: seeded(seed) });
      // c 沒練過、a 練過一題、b 練過兩題：先出 c；接著 a、c 一樣多（照難度排序取前面的），還輪不到 b
      expect(out[0].kp).toBe('c');
      expect(kinds(out)).not.toContain('b');
    }
  });

  it('每個考點都碰過之後，題目多的考點多分到一些', () => {
    const bank = unit({ big: 40, small: 10 });
    const out = orderFresh(bank, { shares, skill: new Map(), concepts: conceptStats(bank, {}, ['physics']), size: 6, rng: seeded() });
    expect(kinds(out).filter((k) => k === 'big').length).toBe(4);
  });

  it('沒給考點統計、或題目沒標考點：照原本的順序（只看難度）', () => {
    const tagged = unit({ a: 30, b: 30 });
    const plain = tagged.map(({ kp: _kp, ...x }) => x);
    const ids = (list, opts = {}) => orderFresh(list, { shares, skill: new Map(), size: 20, rng: seeded(5), ...opts }).map((x) => x.id);
    expect(ids(tagged)).toEqual(ids(plain));
    expect(ids(plain, { concepts: conceptStats(tagged, {}, ['physics']) })).toEqual(ids(plain));
  });
});
