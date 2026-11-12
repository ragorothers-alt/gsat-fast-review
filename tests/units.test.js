import { describe, expect, it } from 'vitest';
import { buildQueue } from '../src/srs.js';
import { CROSS_UNIT, MATH_EXAMS, UNITS, isUnitOff, mathExamOf, topicLabel, unitKey, withMathExam } from '../src/units.js';

const cross = { id: 'math-9001', subject: 'math', topic: CROSS_UNIT, links: ['三角比', '平面向量'], formula: false };
const plain = { id: 'math-9002', subject: 'math', topic: '三角比', formula: false };
const off = (...units) => new Set(units.map((u) => unitKey('math', u)));

describe('跨單元題', () => {
  it('每科最後一個單元都是跨單元綜合', () => {
    for (const units of Object.values(UNITS)) expect(units.at(-1)).toBe(CROSS_UNIT);
  });

  it('畫面上列出結合的單元，一般題照舊顯示單元名稱', () => {
    expect(topicLabel(cross)).toBe('跨單元：三角比＋平面向量');
    expect(topicLabel(plain)).toBe('三角比');
  });

  it('關掉跨單元綜合，跨單元題就不出', () => {
    expect(isUnitOff(cross, off(CROSS_UNIT))).toBe(true);
  });

  it('結合的單元被關掉（例如還沒學到）時，跨單元題也不出', () => {
    expect(isUnitOff(cross, off('平面向量'))).toBe(true);
    expect(isUnitOff(cross, off('矩陣'))).toBe(false);
  });

  it('這科只留跨單元綜合時，跨單元題全部照出', () => {
    const others = UNITS.math.filter((u) => u !== CROSS_UNIT);
    expect(isUnitOff(cross, off(...others))).toBe(false);
    expect(isUnitOff(plain, off(...others))).toBe(true);
  });

  it('出題時套用同樣的規則', () => {
    const queue = buildQueue([cross, plain], {}, { subjects: ['math'], excludedUnits: [unitKey('math', '平面向量')], size: 10, now: 0 });
    expect(queue.map((q) => q.id)).toEqual(['math-9002']);
  });
});

describe('數學考哪一份', () => {
  const B_ONLY = unitKey('math', '數B 專屬主題');
  const SPACE = unitKey('math', '空間向量與平面直線');
  const OTHER = [unitKey('math', '矩陣'), unitKey('physics', '量子現象')];

  it('每一份關掉的單元都在數學的單元清單裡', () => {
    for (const e of MATH_EXAMS) for (const u of e.off) expect(UNITS.math).toContain(u);
  });

  it('只看那兩個單元：都沒關是都考、只關數B 專屬主題是數學 A、只關空間向量是數學 B；兩個都關不是任何一份', () => {
    expect(mathExamOf([])).toBe('AB');
    expect(mathExamOf(undefined)).toBe('AB');
    expect(mathExamOf([...OTHER, B_ONLY])).toBe('A');
    expect(mathExamOf([SPACE, ...OTHER])).toBe('B');
    expect(mathExamOf([B_ONLY, SPACE])).toBeNull();
  });

  it('換一份只動那兩個單元，其他關掉的單元照舊', () => {
    expect(withMathExam(OTHER, 'A')).toEqual([...OTHER, B_ONLY]);
    expect(withMathExam([...OTHER, B_ONLY], 'B')).toEqual([...OTHER, SPACE]);
    expect(withMathExam([B_ONLY, ...OTHER, SPACE], 'AB')).toEqual(OTHER);
    for (const e of MATH_EXAMS) expect(mathExamOf(withMathExam([B_ONLY, SPACE], e.id))).toBe(e.id);
    // 不認得的 id：不改
    expect(withMathExam(OTHER, 'C')).toEqual(OTHER);
  });

  it('選數學 A 後自由練習不出數B 專屬主題，也不出結合了它的跨單元題', () => {
    const bOnly = { id: 'math-9003', subject: 'math', topic: '數B 專屬主題', formula: false };
    const mixed = { id: 'math-9004', subject: 'math', topic: CROSS_UNIT, links: ['數B 專屬主題', '機率'], formula: false };
    const queue = buildQueue([plain, bOnly, mixed], {}, { subjects: ['math'], excludedUnits: withMathExam([], 'A'), size: 10, now: 0 });
    expect(queue.map((q) => q.id)).toEqual(['math-9002']);
  });
});
