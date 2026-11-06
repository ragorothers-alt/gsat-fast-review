import { describe, expect, it } from 'vitest';
import { choiceValue, fillUnit, fillable, matchTyped, parseTyped } from '../src/numeric.js';

describe('演算題填答：選項的數值', () => {
  it('整數、小數、分數、負號與共同的單位', () => {
    expect(choiceValue('$12$')).toEqual({ value: 12, unit: '' });
    expect(choiceValue('$-2.5$')).toEqual({ value: -2.5, unit: '' });
    expect(choiceValue('$\\frac{3}{4}$')).toEqual({ value: 0.75, unit: '' });
    expect(choiceValue('$-\\frac{1}{8}$')).toEqual({ value: -0.125, unit: '' });
    expect(choiceValue('$\\frac16$').value).toBeCloseTo(1 / 6);
    expect(choiceValue('$\\frac5{24}$').value).toBeCloseTo(5 / 24);
    expect(choiceValue('$12\\%$')).toEqual({ value: 12, unit: '%' });
    expect(choiceValue('$3.6\\,\\text{m/s}$')).toEqual({ value: 3.6, unit: 'm/s' });
    expect(choiceValue('−3 公克')).toEqual({ value: -3, unit: '公克' });
  });

  it('根號、π、科學記號、次方、算式和文字選項都不算單純數值', () => {
    for (const c of ['$2\\sqrt{3}$', '$3\\pi$', '$1.2\\times10^{3}$', '$2^{10}$', '甲和乙', '$x=3$', '1,000', '$\\frac{1}{0}$']) {
      expect(choiceValue(c), c).toBeNull();
    }
  });

  it('只有演算題、選項都是同單位的數值才用填答', () => {
    const q = (choices, extra = {}) => ({ type: 'mc', scratch: true, choices, answer: 0, ...extra });
    expect(fillable(q(['$2$', '$\\frac{1}{2}$', '$-3$', '$0.25$']))).toBe(true);
    expect(fillable(q(['3 m', '4 m', '5 m', '6 m']))).toBe(true);
    expect(fillUnit(q(['3 m', '4 m', '5 m', '6 m']))).toBe('m');
    expect(fillable(q(['3 m', '4 cm', '5 m', '6 m']))).toBe(false);
    expect(fillable(q(['$2$', '$\\sqrt{2}$', '$3$', '$4$']))).toBe(false);
    expect(fillable(q(['$2$', '$3$', '$4$', '$5$'], { scratch: false }))).toBe(false);
    expect(fillable({ type: 'ms', scratch: true, choices: ['1', '2', '3', '4', '5'], answer: [0] })).toBe(false);
  });
});

describe('演算題填答：玩家填的答案', () => {
  it('整數、小數、分數、負號；格式不對是 null', () => {
    expect(parseTyped('12')).toBe(12);
    expect(parseTyped('-2.5')).toBe(-2.5);
    expect(parseTyped('.5')).toBe(0.5);
    expect(parseTyped('7/4')).toBe(1.75);
    expect(parseTyped('−3')).toBe(-3);
    for (const t of ['', '-', '3/', '3/0', '1.2.3', '1/2/3', 'abc']) expect(parseTyped(t), t).toBeNull();
  });

  it('數值相同就是同一個選項（3/4 和 0.75 一樣），差一點的近似值不算', () => {
    const q = { type: 'mc', scratch: true, choices: ['$\\frac{3}{4}$', '$0.3$', '$0.35$', '$-1$'], answer: 0 };
    expect(matchTyped(q, 0.75)).toBe(0);
    expect(matchTyped(q, parseTyped('3/4'))).toBe(0);
    expect(matchTyped(q, 0.3)).toBe(1);
    expect(matchTyped(q, 0.35)).toBe(2);
    expect(matchTyped(q, 0.33)).toBe(-1);
    expect(matchTyped(q, -1)).toBe(3);
  });
});
