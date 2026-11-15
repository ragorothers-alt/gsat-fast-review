import { describe, expect, it } from 'vitest';
import {
  FILL_SHARE,
  KEEP_EXAMS,
  KEEP_PAPERS,
  MS_SHARE,
  PAPERS,
  PAPER_BY_ID,
  TRIED_SECS,
  UNIT_SHARE,
  allocate,
  buildPaper,
  examOutcome,
  examPoints,
  gradeExam,
  keepPaper,
  logExam,
  mergePapers,
  newExam,
  paperStatus,
  paperWeights,
  questionHash,
  validExam,
} from '../src/exam.js';
import { fillable } from '../src/numeric.js';
import { UNITS, unitKey, withMathExam } from '../src/units.js';
import { MATH_SHARE, unitShareOf } from '../src/blueprint.js';

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** 每科每單元 per 題單選、ms 題多選、2 題是非 */
function fakeBank(per = 10, ms = 0) {
  const bank = [];
  for (const [subject, units] of Object.entries(UNITS)) {
    units.forEach((topic, u) => {
      const id = (i) => `${subject}-${u * 100 + i + 100}`;
      for (let i = 0; i < per; i++) bank.push({ id: id(i), subject, topic, type: 'mc', choices: ['甲', '乙', '丙', '丁'], answer: i % 4 });
      for (let i = per; i < per + ms; i++) bank.push({ id: id(i), subject, topic, type: 'ms', choices: ['甲', '乙', '丙', '丁', '戊'], answer: [i % 5] });
      for (let i = per + ms; i < per + ms + 2; i++) bank.push({ id: id(i), subject, topic, type: 'tf', answer: true });
    });
  }
  return bank;
}

const FIVE = ['甲', '乙', '丙', '丁', '戊'];
const FOUR = ['甲', '乙', '丙', '丁'];

/** 數學卷的三題：兩題多選（同一單元）、一題單選 */
function mixed() {
  const [u0, u1] = UNITS.math;
  const qs = [
    { id: 'math-1', subject: 'math', topic: u0, type: 'ms', choices: FIVE, answer: [0, 2] },
    { id: 'math-2', subject: 'math', topic: u0, type: 'ms', choices: FIVE, answer: [1] },
    { id: 'math-3', subject: 'math', topic: u1, type: 'mc', choices: FOUR, answer: 2 },
  ];
  const byId = new Map(qs.map((q) => [q.id, q]));
  const exam = newExam(PAPER_BY_ID.math, { ids: qs.map((q) => q.id), orders: [[4, 3, 2, 1, 0], [0, 1, 2, 3, 4], [3, 2, 1, 0]] }, 0);
  return { byId, exam, u0, u1 };
}

describe('考卷設定', () => {
  it('各單元占比的單元名稱都在題庫的單元清單裡', () => {
    for (const [subject, shares] of Object.entries(UNIT_SHARE)) {
      for (const unit of Object.keys(shares)) expect(UNITS[subject], `${subject}：${unit}`).toContain(unit);
    }
    for (const p of PAPERS) for (const s of p.subjects) expect(UNIT_SHARE[s]).toBeTruthy();
  });

  it('allocate：依權重分配，總數剛好，餘數給小數部分大的', () => {
    expect(allocate({ a: 1, b: 1, c: 1 }, 10)).toEqual({ a: 4, b: 3, c: 3 });
    expect(allocate({ a: 50, b: 30, c: 20, d: 0 }, 7)).toEqual({ a: 4, b: 2, c: 1 });
    expect(allocate({}, 5)).toEqual({});
  });

  it('關掉的單元不出（例如只考數 A 的人關掉數 B 專屬主題）', () => {
    const math = PAPER_BY_ID.math;
    const all = paperWeights(math);
    const key = unitKey('math', '數B 專屬主題');
    expect(all[key]).toBeGreaterThan(0);
    expect(paperWeights(math, [key])[key]).toBeUndefined();
  });

  it('數學 A、B 各自的單元占比：單元都在清單裡、合計約 100；數 A 沒有數B 專屬主題、數 B 沒有空間向量；兩卷平均就是 UNIT_SHARE.math', () => {
    for (const [id, shares] of Object.entries(MATH_SHARE)) {
      for (const unit of Object.keys(shares)) expect(UNITS.math, `${id}：${unit}`).toContain(unit);
      const total = Object.values(shares).reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(99);
      expect(total).toBeLessThanOrEqual(101);
    }
    expect(MATH_SHARE.A['數B 專屬主題']).toBeUndefined();
    expect(MATH_SHARE.B['空間向量與平面直線']).toBeUndefined();
    for (const unit of UNITS.math) expect(UNIT_SHARE.math[unit] ?? 0).toBeCloseTo(((MATH_SHARE.A[unit] ?? 0) + (MATH_SHARE.B[unit] ?? 0)) / 2);
    expect(unitShareOf('math', 'A')).toBe(MATH_SHARE.A);
    expect(unitShareOf('math', 'AB')).toBe(UNIT_SHARE.math);
    expect(unitShareOf('math', null)).toBe(UNIT_SHARE.math);
    expect(unitShareOf('physics', 'A')).toBe(UNIT_SHARE.physics);
  });

  it('模擬考的數學卷照考哪一份的占比：考數 A 時空間向量的權重比兩卷平均高，考數 B 時數B 專屬主題比較高', () => {
    const math = PAPER_BY_ID.math;
    const space = unitKey('math', '空間向量與平面直線');
    const bOnly = unitKey('math', '數B 專屬主題');
    const both = paperWeights(math);
    expect(paperWeights(math, withMathExam([], 'A'))[space]).toBeGreaterThan(both[space]);
    expect(paperWeights(math, withMathExam([], 'B'))[bOnly]).toBeGreaterThan(both[bOnly]);
    expect(paperWeights(math, withMathExam([], 'B'))[space]).toBeUndefined();
  });
});

describe('buildPaper', () => {
  const bank = fakeBank();

  it('題數照考卷、只出單選、不重複；合科試卷依科目排', () => {
    const paper = PAPER_BY_ID.science;
    const { ids, orders } = buildPaper(bank, paper, { rng: seeded(3) });
    expect(ids).toHaveLength(paper.size);
    expect(new Set(ids).size).toBe(ids.length);
    const byId = new Map(bank.map((q) => [q.id, q]));
    expect(ids.every((id) => byId.get(id).type === 'mc')).toBe(true);
    const subjects = ids.map((id) => byId.get(id).subject);
    expect([...new Set(subjects)]).toEqual(paper.subjects);
    expect(orders.every((o) => [...o].sort().join() === '0,1,2,3')).toBe(true);
  });

  it('各單元的題數照學測的占比：占比高的單元題目多', () => {
    const byId = new Map(bank.map((q) => [q.id, q]));
    const { ids } = buildPaper(bank, PAPER_BY_ID.chinese, { rng: seeded(5) });
    const count = (unit) => ids.filter((id) => byId.get(id).topic === unit).length;
    // 國文的跨單元綜合占 52%：30 題裡約 16 題，但這個假題庫每單元只有 10 題單選，不夠的由其他單元補
    expect(count('跨單元綜合')).toBe(10);
    expect(count('文學常識')).toBeGreaterThanOrEqual(1);
    expect(ids).toHaveLength(30);
  });

  it('被回報的題目、關掉的單元都不出', () => {
    const flags = Object.fromEntries(bank.filter((q) => q.subject === 'english').slice(0, 30).map((q) => [q.id, 1]));
    const off = unitKey('english', '轉折語與篇章');
    const byId = new Map(bank.map((q) => [q.id, q]));
    const { ids } = buildPaper(bank, PAPER_BY_ID.english, { flags, excludedUnits: [off], rng: seeded(7) });
    expect(ids.some((id) => flags[id])).toBe(false);
    expect(ids.some((id) => byId.get(id).topic === '轉折語與篇章')).toBe(false);
    expect(ids).toHaveLength(30);
  });

  it('國文、數學、自然卷約有 MS_SHARE 的多選題，英文、社會卷不出；選項順序照各題的選項數', () => {
    const big = fakeBank(20, 10);
    const byId = new Map(big.map((q) => [q.id, q]));
    for (const paper of PAPERS) {
      let ms = 0;
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const { ids, orders } = buildPaper(big, paper, { rng: seeded(seed) });
        expect(ids).toHaveLength(paper.size);
        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id, i) => expect([...orders[i]].sort()).toEqual(byId.get(id).choices.map((_, k) => k)));
        ms += ids.filter((id) => byId.get(id).type === 'ms').length;
        total += ids.length;
      }
      expect(ms / total, paper.id).toBeCloseTo(MS_SHARE[paper.id] ?? 0, 1);
    }
  });

  it('數學卷約 FILL_SHARE 是選填題（選項都是數值的演算題，不給選項），其他卷沒有；能填答的題在數學卷一律是選填', () => {
    const big = fakeBank(20, 10);
    // 每個單元另有 10 題能填答的演算題
    for (const [subject, units] of Object.entries(UNITS)) {
      units.forEach((topic, u) => {
        for (let i = 0; i < 10; i++) big.push({ id: `${subject}-${u * 100 + 150 + i}`, subject, topic, type: 'mc', scratch: true, choices: ['2', '4', '6', '8'], answer: i % 4 });
      });
    }
    const byId = new Map(big.map((q) => [q.id, q]));
    for (const paper of PAPERS) {
      let fills = 0;
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const picked = buildPaper(big, paper, { rng: seeded(seed) });
        expect(picked.fills).toHaveLength(picked.ids.length);
        picked.ids.forEach((id, i) => expect(picked.fills[i], id).toBe(Boolean(FILL_SHARE[paper.id]) && fillable(byId.get(id))));
        fills += picked.fills.filter(Boolean).length;
        total += picked.ids.length;
      }
      expect(fills / total, paper.id).toBeCloseTo(FILL_SHARE[paper.id] ?? 0, 1);
    }
    expect(FILL_SHARE).toEqual({ math: expect.any(Number) });
  });

  it('單元的單選題不夠時用同單元的多選題補，題數照樣湊滿', () => {
    const thin = fakeBank(1, 6);
    const byId = new Map(thin.map((q) => [q.id, q]));
    const { ids } = buildPaper(thin, PAPER_BY_ID.math, { rng: seeded(2) });
    expect(ids).toHaveLength(PAPER_BY_ID.math.size);
    expect(ids.every((id) => ['mc', 'ms'].includes(byId.get(id).type))).toBe(true);
  });
});

describe('對答案與紀錄', () => {
  const bank = fakeBank();
  const byId = new Map(bank.map((q) => [q.id, q]));
  const paper = PAPER_BY_ID.math;

  function sat() {
    const exam = newExam(paper, buildPaper(bank, paper, { rng: seeded(9) }), 1000);
    exam.ids.forEach((id, i) => {
      const q = byId.get(id);
      // 前 10 題答對、接著 10 題答錯、最後 5 題沒作答；第 1 題標記過
      exam.answers[i] = i < 10 ? q.answer : i < 20 ? (q.answer + 1) % 4 : null;
      exam.spent[i] = i < 10 ? 30 : 60;
    });
    exam.marks[0] = true;
    exam.elapsed = 1200;
    return exam;
  }

  it('gradeExam：答對、答錯、沒作答，各單元得分與平均用時', () => {
    const r = gradeExam(sat(), byId);
    expect(r).toMatchObject({ total: 25, right: 10, wrong: 10, blank: 5, secs: 1200, limit: paper.minutes * 60, avgRight: 30, avgWrong: 60 });
    expect(r.units.reduce((a, u) => a + u.total, 0)).toBe(25);
    expect(r.units.reduce((a, u) => a + u.right, 0)).toBe(10);
    // 照題庫的單元順序排
    const order = r.units.map((u) => UNITS.math.indexOf(u.unit));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('寫進排程：答對但標記過算不太確定；沒作答但想過（看了一陣子或標記過）的算看解答，只瞄一眼的不記', () => {
    const { items } = gradeExam(sat(), byId);
    expect(examOutcome(items[0])).toBe('unsure');
    expect(examOutcome(items[1])).toBe('right');
    expect(examOutcome(items[12])).toBe('wrong');
    // 最後 5 題沒作答，各看了 60 秒
    expect(examOutcome(items[24])).toBe('skip');
    expect(examOutcome({ ...items[24], secs: TRIED_SECS - 1 })).toBeNull();
    expect(examOutcome({ ...items[24], secs: 0, marked: true })).toBe('skip');
  });

  it('validExam：格式不對或題目不在題庫裡就不接著考', () => {
    const exam = sat();
    expect(validExam(exam, byId)).toBe(true);
    expect(validExam({ ...exam, paper: 'nope' }, byId)).toBe(false);
    expect(validExam({ ...exam, answers: exam.answers.slice(1) }, byId)).toBe(false);
    expect(validExam({ ...exam, ids: ['math-99999', ...exam.ids.slice(1)] }, byId)).toBe(false);
    expect(validExam({ ...exam, orders: [[0, 0, 1, 2], ...exam.orders.slice(1)] }, byId)).toBe(false);
    expect(validExam({ ...exam, ids: 'math-100' }, byId)).toBe(false);
    expect(validExam(null, byId)).toBe(false);
  });

  it('gradeExam：多選題全對才算答對，沒全對照學測規則部分給分', () => {
    const { byId, exam, u0, u1 } = mixed();
    // 第 1 題全對；第 2 題多選了一個（錯 1 個選項，得 3/5）；第 3 題單選答對
    exam.answers = [[0, 2], [1, 3], 2];
    const r = gradeExam(exam, byId);
    expect(r).toMatchObject({ total: 3, right: 2, wrong: 1, blank: 0, points: 2.6 });
    expect(r.items.map((it) => it.score)).toEqual([1, 0.6, 1]);
    expect(examOutcome(r.items[1])).toBe('wrong');
    expect(r.units).toMatchObject([
      { unit: u0, total: 2, right: 1, points: 1.6 },
      { unit: u1, total: 1, right: 1, points: 1 },
    ]);
    // 錯 3 個以上選項得 0 分；沒作答也是 0 分
    exam.answers = [[1, 3, 4], null, 0];
    expect(gradeExam(exam, byId)).toMatchObject({ right: 0, wrong: 2, blank: 1, points: 0 });
  });

  it('validExam：多選題的作答是不重複的選項陣列，選項順序要照題目的選項數', () => {
    const { byId, exam } = mixed();
    exam.answers = [[0, 2], null, 1];
    expect(validExam(exam, byId)).toBe(true);
    const answers = (a) => validExam({ ...exam, answers: a }, byId);
    expect(answers([[], null, 1])).toBe(false);
    expect(answers([[0, 0], null, 1])).toBe(false);
    expect(answers([[5], null, 1])).toBe(false);
    expect(answers([2, null, 1])).toBe(false);
    expect(answers([[0], null, [1]])).toBe(false);
    expect(validExam({ ...exam, orders: [[0, 1, 2, 3], ...exam.orders.slice(1)] }, byId)).toBe(false);
  });

  /** 數學卷的五題選填題：選項是 3/4、1/2、2、−1，正解 3/4 */
  function fills() {
    const qs = [0, 1, 2, 3, 4].map((i) => ({ id: `math-${i + 1}`, subject: 'math', topic: UNITS.math[0], type: 'mc', scratch: true, choices: ['$\\frac{3}{4}$', '$\\frac{1}{2}$', '2', '$-1$'], answer: 0 }));
    const byId = new Map(qs.map((q) => [q.id, q]));
    const exam = newExam(PAPER_BY_ID.math, { ids: qs.map((q) => q.id), orders: qs.map(() => [3, 2, 1, 0]), fills: qs.map(() => true) }, 0);
    return { byId, exam };
  }

  it('gradeExam：選填題填的數值等於正解才得分；等於別的選項、不是任何選項、沒填完都是答錯', () => {
    const { byId, exam } = fills();
    exam.answers = ['0.75', '1/2', '5', '3/', null];
    exam.spent = [10, 10, 10, 10, 30];
    const r = gradeExam(exam, byId);
    expect(r).toMatchObject({ total: 5, right: 1, wrong: 3, blank: 1, points: 1 });
    expect(r.items.map((it) => [it.answer, it.typed, it.right])).toEqual([
      [0, '0.75', true],
      [1, '1/2', false],
      [null, '5', false],
      [null, '3/', false],
      [null, undefined, false],
    ]);
    expect(r.items.map(examOutcome)).toEqual(['right', 'wrong', 'wrong', 'wrong', 'skip']);
  });

  it('validExam：選填題的作答是填的字（至少一個數字）；以前存的卷沒有 fills，照選項作答接著考', () => {
    const { byId, exam } = fills();
    exam.answers = ['0.75', '-3/4', null, '3/', '12'];
    expect(validExam(exam, byId)).toBe(true);
    const answers = (a) => validExam({ ...exam, answers: a }, byId);
    expect(answers([0, null, null, null, null])).toBe(false);
    expect(answers(['-', null, null, null, null])).toBe(false);
    expect(answers(['abc', null, null, null, null])).toBe(false);
    expect(answers(['', null, null, null, null])).toBe(false);
    // 沒有 fills 的舊卷：作答是選項索引
    const { fills: _, ...old } = { ...exam, answers: [0, 1, null, null, 3] };
    expect(validExam(old, byId)).toBe(true);
    expect(validExam({ ...old, answers: ['0.75', null, null, null, null] }, byId)).toBe(false);
    expect(validExam({ ...exam, fills: [true, true] }, byId)).toBe(false);
    expect(validExam({ ...exam, fills: [1, true, true, true, true] }, byId)).toBe(false);
    // 多選題不會是選填題
    const { byId: mixedById, exam: m } = mixed();
    expect(validExam({ ...m, fills: [true, false, false] }, mixedById)).toBe(false);
  });

  it('logExam：記下成績、回傳上一次同一張卷的成績，只留最近幾次', () => {
    const state = {};
    const r = gradeExam(sat(), byId);
    expect(logExam(state, 'math', r, 1)).toBeNull();
    expect(logExam(state, 'science', { ...r, right: 3 }, 2)).toBeNull();
    expect(logExam(state, 'math', { ...r, right: 20 }, 3)).toMatchObject({ paper: 'math', right: 10, at: 1 });
    for (let i = 0; i < KEEP_EXAMS + 5; i++) logExam(state, 'math', r, 10 + i);
    expect(state.examLog).toHaveLength(KEEP_EXAMS);
    expect(state.examLog.at(-1).at).toBe(10 + KEEP_EXAMS + 4);
  });

  it('keepPaper：交卷後整份卷留在這台，重開時重算出一樣的成績；只留最近 KEEP_PAPERS 份', () => {
    const state = {};
    const exam = sat();
    keepPaper(state, exam, byId, 5000);
    const saved = state.examPapers[0];
    expect(saved).toMatchObject({ paper: 'math', at: 5000, ids: exam.ids, answers: exam.answers, marks: exam.marks, limit: exam.limit });
    expect(saved.hashes).toHaveLength(exam.ids.length);
    const status = paperStatus(saved, byId);
    expect(status.ok).toBe(true);
    expect(status.changed.size).toBe(0);
    const again = gradeExam(saved, byId);
    const first = gradeExam(exam, byId);
    expect([again.right, again.wrong, again.blank, again.points]).toEqual([first.right, first.wrong, first.blank, first.points]);
    for (let i = 0; i < KEEP_PAPERS + 3; i++) keepPaper(state, sat(), byId, 6000 + i);
    expect(state.examPapers).toHaveLength(KEEP_PAPERS);
    expect(state.examPapers.at(-1).at).toBe(6000 + KEEP_PAPERS + 2);
  });

  it('paperStatus：考完之後題目改過的標出來；題目已經不在題庫就不能重開', () => {
    const state = {};
    const exam = sat();
    keepPaper(state, exam, byId, 5000);
    const saved = state.examPapers[0];
    const id = saved.ids[3];
    const edited = new Map(byId);
    edited.set(id, { ...byId.get(id), q: '題目修正過了' });
    expect([...paperStatus(saved, edited).changed]).toEqual([id]);
    expect(questionHash(byId.get(id))).not.toBe(questionHash(edited.get(id)));
    const removed = new Map(byId);
    removed.delete(id);
    expect(paperStatus(saved, removed).ok).toBe(false);
    expect(paperStatus({ ...saved, at: 'x' }, byId).ok).toBe(false);
  });

  it('mergePapers：備份檔裡的卷併進來，同一份不重複，依時間排、只留最近幾份；格式不對的略過', () => {
    const state = {};
    keepPaper(state, sat(), byId, 100);
    const theirs = { examPapers: [] };
    keepPaper(theirs, sat(), byId, 50);
    keepPaper(theirs, sat(), byId, 100);
    expect(mergePapers(state, [...theirs.examPapers, { paper: 'nope', at: 1, ids: [], answers: [] }, null])).toBe(1);
    expect(state.examPapers.map((p) => p.at)).toEqual([50, 100]);
    expect(mergePapers(state, theirs.examPapers)).toBe(0);
  });

  it('logExam 記下得分；有多選題以前的舊紀錄沒有得分，就用答對題數', () => {
    const state = {};
    logExam(state, 'math', { total: 3, right: 2, points: 2.6, blank: 0, secs: 10.4 }, 5);
    expect(state.examLog[0]).toMatchObject({ right: 2, points: 2.6, secs: 10 });
    expect(examPoints(state.examLog[0])).toBe(2.6);
    expect(examPoints({ paper: 'math', right: 7, total: 25 })).toBe(7);
  });
});
