import { describe, expect, it } from 'vitest';
import { PAPER_BY_ID, buildPaper } from '../src/exam.js';
import { blankOf, bundles, groupKind, isBank, isCloze, keepTogether, takeBundles, usedOptions } from '../src/groups.js';
import { orderFresh, unitShares } from '../src/priority.js';
import { questionPrompt } from '../src/prompt.js';
import { buildQueue, schedule } from '../src/srs.js';
import { UNITS, topicLabel } from '../src/units.js';

const NOW = 1_700_000_000_000;

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const FOUR = ['甲', '乙', '丙', '丁'];
const single = (id, subject = 'english', topic = UNITS[subject][0]) => ({ id, subject, topic, type: 'mc', choices: FOUR, answer: 0, level: 2, formula: false });

/** 一個題組：n 題，克漏字的話文章有 n 個空格、每題問一格 */
function group(subject, g, first, n, { cloze = false, topic = UNITS[subject][0] } = {}) {
  const passage = cloze ? Array.from({ length: n }, (_, i) => `Sentence __${i + 1}__ here.`).join(' ') : `${subject} passage ${g}`;
  return Array.from({ length: n }, (_, i) => ({
    ...single(`${subject}-${first + i}`, subject, topic),
    group: `${subject}-g${g}`,
    passage,
    q: cloze ? `__${i + 1}__ 處最適合填入哪一個選項？` : `第 ${i + 1} 題`,
  }));
}

/** 共用選項的題組（文意選填）：4 格共用 6 個字詞 */
function bankGroup(g, first) {
  const words = ['retain', 'depend on', 'atmosphere', 'delay', 'minimal', 'risk'];
  const passage = 'Naps __1__ memory. They __2__ decline. Choose a quiet __3__ with __4__ light.';
  const answers = [0, 3, 2, 4];
  return answers.map((answer, i) => ({
    ...single(`english-${first + i}`, 'english', '核心單字'),
    group: `english-g${g}`,
    passage,
    q: `__${i + 1}__ 處最適合填入哪一個選項？`,
    choices: words,
    answer,
  }));
}

/** 同組的題目在 list 裡是不是連在一起、照題號排 */
function contiguous(list) {
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const g = list[i].group;
    if (!g || list[i - 1]?.group === g) continue;
    if (seen.has(g)) return false;
    seen.add(g);
  }
  return list.every((q, i) => !q.group || list[i - 1]?.group !== q.group || Number(q.id.split('-')[1]) > Number(list[i - 1].id.split('-')[1]));
}

describe('分包', () => {
  const [a, b, c] = group('english', 801, 8001, 3);
  const s1 = single('english-1');
  const s2 = single('english-2');

  it('同組的題目併成一包，放在這組第一次出現的位置、照題號排；單題一題一包', () => {
    expect(bundles([s1, c, s2, a, b]).map((p) => p.map((q) => q.id))).toEqual([['english-1'], ['english-8001', 'english-8002', 'english-8003'], ['english-2']]);
    expect(keepTogether([c, s1, a])).toEqual([a, c, s1]);
  });

  it('takeBundles：取到 size 題，最後一組放不下也整組放進來', () => {
    const packs = bundles([s1, a, b, c, s2]);
    expect(takeBundles(packs, 2)).toEqual([s1, a, b, c]);
    expect(takeBundles(packs, 1)).toEqual([s1]);
    expect(takeBundles(packs, 0)).toEqual([]);
  });

  it('克漏字：題幹問哪一格、文章有沒有空格', () => {
    const cloze = group('english', 802, 8101, 2, { cloze: true });
    expect(blankOf(cloze[1])).toBe(2);
    expect(blankOf(a)).toBeNull();
    expect(blankOf({ ...s1, q: '__1__' })).toBeNull();
    expect(isCloze(cloze[0].passage)).toBe(true);
    expect(isCloze(a.passage)).toBe(false);
  });

  it('共用選項（文意選填、篇章結構）：題組種類，以及別格已經填掉的選項', () => {
    const [b1, b2, b3] = bankGroup(821, 8201);
    expect(isBank(b1)).toBe(true);
    expect(isBank(a)).toBe(false);
    expect(isBank({ ...single('math-1', 'math'), choices: ['1', '2', '3', '4', '5'], type: 'ms' })).toBe(false);
    expect([groupKind(b1), groupKind(a), groupKind(group('english', 802, 8101, 2, { cloze: true })[0])]).toEqual(['bank', 'reading', 'cloze']);
    // 作答畫面：前面做過的空格（正解已公布）；同組、不是這一格自己、沒作答的不算
    const filled = [
      { q: b1, value: b1.answer },
      { q: b3, value: null },
      { q: s1, value: 2 },
    ];
    expect([...usedOptions(b2, filled)]).toEqual([0]);
    expect([...usedOptions(b1, filled)]).toEqual([]);
    expect([...usedOptions(a, filled)]).toEqual([]);
  });

  it('題組裡沒寫 links 的跨單元題，單元名稱顯示「閱讀理解」', () => {
    expect(topicLabel({ ...a, topic: '跨單元綜合' })).toBe('閱讀理解');
    expect(topicLabel({ ...a, topic: '跨單元綜合', links: ['修辭', '詩詞曲'] })).toBe('跨單元：修辭＋詩詞曲');
    expect(topicLabel(a)).toBe(UNITS.english[0]);
  });
});

describe('出題順序', () => {
  const singles = UNITS.english.flatMap((topic, u) => Array.from({ length: 6 }, (_, i) => single(`english-${u * 100 + i + 100}`, 'english', topic)));
  const groups = [group('english', 801, 8001, 5, { cloze: true }), group('english', 802, 8101, 4, { topic: '轉折語與篇章' }), group('english', 803, 8201, 4, { topic: '轉折語與篇章' })];
  const bank = [...singles, ...groups.flat()];

  it('新題：題組整組一起出、照題號排，不會被別的題目插進來', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const out = orderFresh(bank, { shares: unitShares(['english']), skill: new Map(), size: 20, rng: seeded(seed) });
      expect(contiguous(out)).toBe(true);
      for (const g of groups) {
        const n = out.filter((q) => q.group === g[0].group).length;
        expect([0, g.length]).toContain(n);
      }
      // 最後一組放不下也整組出：最多多出一組的題數
      expect(out.length).toBeGreaterThanOrEqual(20);
      expect(out.length).toBeLessThan(25);
    }
  });

  it('buildQueue：題組排在一起；60 秒快閃（quickOnly）不出題組', () => {
    let hits = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const out = buildQueue(bank, {}, { subjects: ['english'], size: 20, now: NOW, rng: seeded(seed) });
      expect(contiguous(out)).toBe(true);
      if (out.some((q) => q.group)) hits++;
      const quick = buildQueue(bank, {}, { subjects: ['english'], size: 20, now: NOW, rng: seeded(seed), quickOnly: true });
      expect(quick.some((q) => q.group)).toBe(false);
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('到期的複習：同組到期的題目一起出，同組沒做過的接在一起，還沒到期的不出；新題照樣約每 4 題一題', () => {
    const cards = {};
    // 單題全部答錯過、已到期；題組 801 第 1、3 題到期，第 4 題還沒到期，第 2、5 題沒做過
    for (const q of singles) cards[q.id] = { ...schedule(undefined, 'wrong', NOW - 3_600_000), due: NOW - 1 };
    const [g1, g2, g3, g4, g5] = groups[0];
    for (const q of [g1, g3]) cards[q.id] = { ...schedule(undefined, 'wrong', NOW - 3_600_000), due: NOW - 1 };
    cards[g4.id] = { ...schedule(undefined, 'wrong', NOW - 3_600_000), due: NOW + 3_600_000 };
    let seen = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const out = buildQueue(bank, cards, { subjects: ['english'], size: 40, now: NOW, rng: seeded(seed) });
      expect(contiguous(out)).toBe(true);
      expect(out).not.toContain(g4);
      const i = out.indexOf(g1);
      if (i >= 0) {
        seen++;
        expect(out.slice(i, i + 4)).toEqual([g1, g2, g3, g5]);
      }
      // 新題（沒有紀錄的）約占四分之一
      const fresh = out.filter((q) => !cards[q.id]).length;
      expect(fresh / out.length).toBeGreaterThan(0.15);
      expect(fresh / out.length).toBeLessThan(0.4);
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('模擬考的題組', () => {
  const chinese = UNITS.chinese.flatMap((topic, u) => Array.from({ length: 12 }, (_, i) => single(`chinese-${u * 100 + i + 100}`, 'chinese', topic)));
  const zhGroups = Array.from({ length: 6 }, (_, k) => group('chinese', 801 + k, 8001 + k * 10, 3, { topic: '跨單元綜合' }));
  const english = UNITS.english.flatMap((topic, u) => Array.from({ length: 12 }, (_, i) => single(`english-${u * 100 + i + 100}`, 'english', topic)));
  const enGroups = [
    ...Array.from({ length: 3 }, (_, k) => group('english', 801 + k, 8001 + k * 10, 5, { cloze: true })),
    ...Array.from({ length: 3 }, (_, k) => group('english', 811 + k, 8101 + k * 10, 4, { topic: '轉折語與篇章' })),
  ];
  const bank = [...chinese, ...zhGroups.flat(), ...english, ...enGroups.flat()];
  const byId = new Map(bank.map((q) => [q.id, q]));

  it('國文卷抽 3 組、整組排在單題後面，總題數照考卷', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const paper = PAPER_BY_ID.chinese;
      const { ids, orders } = buildPaper(bank, paper, { rng: seeded(seed) });
      const qs = ids.map((id) => byId.get(id));
      expect(ids).toHaveLength(paper.size);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(qs.filter((q) => q.group).map((q) => q.group)).size).toBe(paper.groups);
      expect(contiguous(qs)).toBe(true);
      const firstGroup = qs.findIndex((q) => q.group);
      expect(qs.slice(firstGroup).every((q) => q.group)).toBe(true);
      expect(orders.every((o) => o.length === 4)).toBe(true);
    }
  });

  it('英文卷克漏字、共用選項、閱讀測驗各一組，照學測的順序排；共用選項整組固定順序', () => {
    const banks = Array.from({ length: 2 }, (_, k) => bankGroup(821 + k, 8201 + k * 10));
    const all = [...bank, ...banks.flat()];
    const byAll = new Map(all.map((q) => [q.id, q]));
    for (let seed = 1; seed <= 10; seed++) {
      const { ids, orders } = buildPaper(all, PAPER_BY_ID.english, { rng: seeded(seed) });
      const qs = ids.map((id) => byAll.get(id));
      const packs = bundles(qs.filter((q) => q.group));
      expect(packs.map((p) => groupKind(p[0]))).toEqual(['cloze', 'bank', 'reading']);
      expect(ids).toHaveLength(30);
      qs.forEach((q, i) => {
        if (isBank(q)) expect(orders[i]).toEqual(q.choices.map((_, k) => k));
      });
    }
  });

  it('組裡被回報的題目不出；剩不到 2 題的整組不出', () => {
    const flags = {};
    for (const g of zhGroups.slice(0, 5)) for (const q of g.slice(0, 2)) flags[q.id] = 1;
    const { ids } = buildPaper(bank, PAPER_BY_ID.chinese, { flags, rng: seeded(4) });
    const qs = ids.map((id) => byId.get(id));
    expect(qs.some((q) => flags[q.id])).toBe(false);
    // 只剩第 6 組是完整的
    expect([...new Set(qs.filter((q) => q.group).map((q) => q.group))]).toEqual([zhGroups[5][0].group]);
    expect(ids).toHaveLength(30);
  });
});

describe('複製題目給 AI', () => {
  it('題組附上整篇文章，克漏字的空格寫成 (n)', () => {
    const [, second] = group('english', 801, 8001, 3, { cloze: true });
    const text = questionPrompt(second);
    expect(text).toContain('閱讀下文，回答問題（文中的 (1)、(2)… 是空格）：');
    expect(text).toContain('Sentence (1) here. Sentence (2) here. Sentence (3) here.');
    expect(text).toContain('(2) 處最適合填入哪一個選項？');
    expect(text).not.toContain('__');
  });

  it('共用選項：選項標到 (F)，並說明選項是整組共用的', () => {
    const [, second] = bankGroup(821, 8201);
    const text = questionPrompt(second);
    expect(text).toContain('（這組的 6 個選項是每一格共用的，每個選項最多填一格，有的選項用不到。）');
    expect(text).toContain('(F) risk');
  });
});
