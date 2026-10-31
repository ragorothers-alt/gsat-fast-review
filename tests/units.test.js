import { describe, expect, it } from 'vitest';
import { buildQueue } from '../src/srs.js';
import { CROSS_UNIT, UNITS, isUnitOff, topicLabel, unitKey } from '../src/units.js';

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
