import { describe, expect, it } from 'vitest';
import { DAY, INTERVALS, MAX_BOX, NEW_EVERY, SPRINT_DAYS, buildQueue, dueFor, everMissed, examStart, isWeak, mastery, neverMissed, schedule } from '../src/srs.js';

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

describe('考前衝刺（dueFor）', () => {
  const EXAM = examStart('2027-01-22');
  const START = EXAM - SPRINT_DAYS * DAY;
  // 失手過、後來答對到第 5 盒：下次到期在考後
  const far = { box: 5, due: EXAM + 3 * DAY, seen: 4, right: 3, wrong: 1, missed: 1, last: START - 10 * DAY };

  it('examStart 是本地時間那天 0 點；格式不對是 null', () => {
    expect(EXAM).toBe(new Date(2027, 0, 22).getTime());
    expect(examStart('')).toBeNull();
    expect(examStart(undefined)).toBeNull();
  });

  it('到期日在考後的題目，拉回考前 14 天內的某一天；同一題每次算出來都一樣', () => {
    const due = dueFor('math-001', far, EXAM, START - 30 * DAY);
    expect(due).toBeGreaterThanOrEqual(START);
    expect(due).toBeLessThan(EXAM);
    expect((due - START) % DAY).toBe(0);
    expect(dueFor('math-001', far, EXAM, START + 5 * DAY)).toBe(due);
    // 分散在這 14 天，不會全擠在同一天
    const days = new Set([...Array(200)].map((_, i) => dueFor(`math-${i}`, far, EXAM, START)));
    expect(days.size).toBe(SPRINT_DAYS);
  });

  it('考前本來就會到期的、衝刺期間已經做過的、沒設考試日或已經考完的，都照原本的到期日', () => {
    const soon = { ...far, due: EXAM - DAY };
    expect(dueFor('math-001', soon, EXAM, START)).toBe(soon.due);
    expect(dueFor('math-001', { ...far, last: START + DAY }, EXAM, START + 2 * DAY)).toBe(far.due);
    expect(dueFor('math-001', far, null, START)).toBe(far.due);
    expect(dueFor('math-001', far, EXAM, EXAM + DAY)).toBe(far.due);
  });

  it('衝刺時答對：盒子與到期日不變，只記下做過了，之後不會再被拉回來；答錯照常回到第 0 盒', () => {
    const day = dueFor('math-001', far, EXAM, START);
    const right = schedule(far, 'right', day + 3600_000);
    expect(right).toMatchObject({ box: 5, due: far.due, right: 4 });
    expect(dueFor('math-001', right, EXAM, day + DAY)).toBe(far.due);
    expect(schedule(far, 'wrong', day + 3600_000).box).toBe(0);
  });

  it('buildQueue：衝刺日到了就當成到期的複習出；還沒到或沒給考試日就排在最後', () => {
    const bank = [q('m1'), q('m2'), q('m3')];
    const cards = { m1: far };
    const day = dueFor('m1', far, EXAM, START);
    const first = (opts) => buildQueue(bank, cards, { subjects: ['math'], size: 3, rng: seeded(), ...opts })[0].id;
    expect(first({ now: day + 1000, examAt: EXAM })).toBe('m1');
    expect(first({ now: day + 1000 })).not.toBe('m1');
    expect(first({ now: START - DAY, examAt: EXAM })).not.toBe('m1');
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

  it('快閃不出要自己寫答案的非選擇題；其他模式照出，公式特訓不出（沒有 formula）', () => {
    const open = { id: 'm7', subject: 'math', type: 'open', answer: '參考答案', points: ['要點一', '要點二'] };
    const opts = { subjects: ['math'], size: 10, now: NOW, rng: seeded() };
    expect(buildQueue([...bank, open], {}, { ...opts, quickOnly: true }).map((x) => x.id)).not.toContain('m7');
    expect(buildQueue([...bank, open], {}, opts).map((x) => x.id)).toContain('m7');
    expect(buildQueue([...bank, open], {}, { ...opts, formulaOnly: true }).map((x) => x.id)).toEqual(['m4']);
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

  it('到期的複習多時：每 2 題複習配 1 題新題；複習出完了就全出新題', () => {
    const many = [...Array(12)].map((_, i) => q(`d${i}`));
    const fresh = [...Array(12)].map((_, i) => q(`n${i}`));
    const cards = Object.fromEntries(many.map((x) => [x.id, { box: 2, due: NOW - 1, seen: 2, right: 1, wrong: 1 }]));
    const kinds = (n, list) => buildQueue(list, cards, { subjects: ['math'], size: n, now: NOW, rng: seeded() }).map((x) => x.id[0]).join('');
    expect(kinds(9, [...many, ...fresh])).toBe('ddnddnddn');
    expect(kinds(8, [...many.slice(0, 3), ...fresh])).toBe('ddndnnnn');
    expect(NEW_EVERY).toBe(3);
  });

  it('複習最多連續 2 題：剛出了一整組新的閱讀題組，也不會接著連出一長串複習', () => {
    const many = [...Array(14)].map((_, i) => q(`d${i}`));
    const group = [...Array(4)].map((_, i) => q(`g${i}`, 'math', { group: 'math-g1' }));
    const fresh = [...Array(6)].map((_, i) => q(`n${i}`));
    const cards = Object.fromEntries(many.map((x) => [x.id, { box: 2, due: NOW - 1, seen: 2, right: 1, wrong: 1 }]));
    for (let seed = 1; seed <= 20; seed++) {
      const out = buildQueue([...many, ...group, ...fresh], cards, { subjects: ['math'], size: 24, now: NOW, rng: seeded(seed) })
        .map((x) => x.id[0])
        .join('');
      // 題組整組一起出；新題還沒出完時，複習不會連出 3 題以上
      expect(out).toContain('gggg');
      const freshLeft = out.lastIndexOf('n') > out.lastIndexOf('g') ? out.lastIndexOf('n') : out.lastIndexOf('g');
      expect(out.slice(0, freshLeft)).not.toMatch(/ddd/);
    }
  });

  it('上一批最後剛連出複習（streak）：接著算，自由練習兩批交界也不會連出 3 題以上複習', () => {
    const many = [...Array(12)].map((_, i) => q(`d${i}`));
    const fresh = [...Array(12)].map((_, i) => q(`n${i}`));
    const cards = Object.fromEntries(many.map((x) => [x.id, { box: 2, due: NOW - 1, seen: 2, right: 1, wrong: 1 }]));
    const kinds = (streak) =>
      buildQueue([...many, ...fresh], cards, { subjects: ['math'], size: 7, streak, now: NOW, rng: seeded() })
        .map((x) => x.id[0])
        .join('');
    expect(kinds(2)).toBe('nddnddn');
    expect(kinds(1)).toBe('dnddndd');
    expect(kinds(0)).toBe('ddnddnd');
  });

  it('剛出過 1 題複習時，到期的閱讀題組先等一題新題再整組出', () => {
    const group = [...Array(3)].map((_, i) => q(`g${i}`, 'math', { group: 'math-g1' }));
    const fresh = [...Array(6)].map((_, i) => q(`n${i}`));
    const missed = { due: NOW - 1, seen: 2, right: 1, wrong: 1 };
    // 單題的盒子小、先出，題組接在後面
    const cards = { d0: { ...missed, box: 0 }, ...Object.fromEntries(group.map((x) => [x.id, { ...missed, box: 2 }])) };
    const out = buildQueue([q('d0'), ...group, ...fresh], cards, { subjects: ['math'], size: 9, now: NOW, rng: seeded() });
    expect(out.map((x) => x.id[0]).join('')).toBe('dngggnnnn');
  });

  it('新題還沒出完時，連續超過 2 題的複習只會是一整組到期的閱讀題組', () => {
    const singles = [...Array(20)].map((_, i) => q(`d${i}`));
    const groups = [2, 3, 4].flatMap((n, k) => [...Array(n)].map((_, i) => q(`g${k}${i}`, 'math', { group: `math-g${k}` })));
    const fresh = [...Array(15)].map((_, i) => q(`n${i}`));
    const cards = Object.fromEntries([...singles, ...groups].map((x) => [x.id, { box: 2, due: NOW - 1, seen: 2, right: 1, wrong: 1 }]));
    for (let seed = 1; seed <= 30; seed++) {
      const out = buildQueue([...singles, ...groups, ...fresh], cards, { subjects: ['math'], size: 40, now: NOW, rng: seeded(seed) });
      const runs = [];
      let run = [];
      for (const x of out.slice(0, out.findLastIndex((x) => x.id[0] === 'n') + 1)) {
        if (x.id[0] !== 'n') run.push(x);
        else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      for (const r of runs.filter((r) => r.length > 2)) expect(r.every((x) => x.group && x.group === r[0].group)).toBe(true);
      // 三組題組都出了，確實測到題組
      expect(new Set(out.filter((x) => x.group).map((x) => x.group)).size).toBe(3);
    }
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
