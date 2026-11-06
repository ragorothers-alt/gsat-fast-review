import { describe, expect, it } from 'vitest';
import { questionPrompt } from '../src/prompt.js';
import { UNITS } from '../src/units.js';

const mc = {
  id: 'math-001',
  subject: 'math',
  topic: '三角函數',
  type: 'mc',
  q: '$\\sin 30^\\circ$ 的值為何？',
  choices: ['$\\frac{1}{2}$', '$\\frac{\\sqrt{3}}{2}$', '$1$', '$0$'],
  answer: 0,
  explain: '特殊角：$\\sin 30^\\circ=\\frac{1}{2}$。',
};

const tf = {
  id: 'biology-001',
  subject: 'biology',
  topic: '孟德爾遺傳',
  type: 'tf',
  q: '$Aa$ 自交，子代表現型比例為 $1:2:1$。',
  answer: false,
  explain: '$1:2:1$ 是基因型比例。',
};

describe('questionPrompt', () => {
  it('作答前：照畫面上的順序標 (A)–(D)，保留 LaTeX，不洩漏答案', () => {
    const text = questionPrompt(mc, { order: [2, 0, 3, 1] });
    expect(text).toContain('數學・三角函數');
    expect(text).toContain('$\\sin 30^\\circ$ 的值為何？');
    expect(text).toContain('(A) $1$\n(B) $\\frac{1}{2}$\n(C) $0$\n(D) $\\frac{\\sqrt{3}}{2}$');
    expect(text).not.toContain('正確答案');
    expect(text).not.toContain(mc.explain);
  });

  it('答錯後：附上自己的答案、正解與解析，選項代號跟畫面一致', () => {
    const text = questionPrompt(mc, { order: [2, 0, 3, 1], outcome: 'wrong', chosen: 1 });
    expect(text).toContain('我的答案：(D) $\\frac{\\sqrt{3}}{2}$');
    expect(text).toContain('正確答案：(B) $\\frac{1}{2}$');
    expect(text).toContain(mc.explain);
    expect(text).toContain('我答錯了');
  });

  it('按「不會」與是非題', () => {
    const text = questionPrompt(tf, { outcome: 'skip' });
    expect(text).toContain('是非題');
    expect(text).toContain('判斷下列敘述是否正確：$Aa$ 自交');
    expect(text).toContain('我的答案：不會');
    expect(text).toContain('正確答案：錯誤');
    expect(text).toContain('我不會這題');
  });

  it('多選題：標 (A)–(E)、說明要選出所有正確的選項，答案照畫面上的順序列', () => {
    const ms = { id: 'physics-7001', subject: 'physics', topic: UNITS.physics[0], type: 'ms', q: '下列哪些是向量？', choices: ['位移', '速率', '加速度', '質量', '力'], answer: [0, 2, 4], explain: '有方向的才是向量。' };
    const text = questionPrompt(ms, { order: [4, 3, 2, 1, 0], outcome: 'wrong', chosen: [0, 2] });
    expect(text).toContain('多選題（選出所有正確的選項）');
    expect(text).toContain('(A) 力\n(B) 質量\n(C) 加速度\n(D) 速率\n(E) 位移');
    expect(text).toContain('我的答案：(C) 加速度、(E) 位移');
    expect(text).toContain('正確答案：(A) 力、(C) 加速度、(E) 位移');
  });

  it('演算題自己填的答案不是任何一個選項', () => {
    const text = questionPrompt(mc, { order: [0, 1, 2, 3], outcome: 'wrong', chosen: null, typed: '0.6' });
    expect(text).toContain('我的答案：自己算出 0.6（不是任何一個選項）');
    expect(text).toContain('正確答案：(A) $\\frac{1}{2}$');
  });

  it('從錯題本複製：沒有當時的答案，附上正解與解析', () => {
    const text = questionPrompt(mc, { outcome: 'review' });
    expect(text).not.toContain('我的答案');
    expect(text).toContain('正確答案：(A) $\\frac{1}{2}$');
    expect(text).toContain(mc.explain);
    expect(text).toContain('之前答錯過');
  });
});
