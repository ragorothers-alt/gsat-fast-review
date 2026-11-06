import { describe, expect, it } from 'vitest';
import {
  KEEP_EXAMS,
  MS_SHARE,
  PAPERS,
  PAPER_BY_ID,
  UNIT_SHARE,
  allocate,
  buildPaper,
  examOutcome,
  examPoints,
  gradeExam,
  logExam,
  newExam,
  paperWeights,
  validExam,
} from '../src/exam.js';
import { UNITS, unitKey } from '../src/units.js';

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
    expect(r).toMatchObject({ total: 25, right: 10, wrong: 10, blank: 5, secs: 1200, limit: 1800, avgRight: 30, avgWrong: 60 });
    expect(r.units.reduce((a, u) => a + u.total, 0)).toBe(25);
    expect(r.units.reduce((a, u) => a + u.right, 0)).toBe(10);
    // 照題庫的單元順序排
    const order = r.units.map((u) => UNITS.math.indexOf(u.unit));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('寫進排程：答對但標記過算不太確定；沒作答的不記', () => {
    const { items } = gradeExam(sat(), byId);
    expect(examOutcome(items[0])).toBe('unsure');
    expect(examOutcome(items[1])).toBe('right');
    expect(examOutcome(items[12])).toBe('wrong');
    expect(examOutcome(items[24])).toBeNull();
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

  it('logExam 記下得分；有多選題以前的舊紀錄沒有得分，就用答對題數', () => {
    const state = {};
    logExam(state, 'math', { total: 3, right: 2, points: 2.6, blank: 0, secs: 10.4 }, 5);
    expect(state.examLog[0]).toMatchObject({ right: 2, points: 2.6, secs: 10 });
    expect(examPoints(state.examLog[0])).toBe(2.6);
    expect(examPoints({ paper: 'math', right: 7, total: 25 })).toBe(7);
  });
});
