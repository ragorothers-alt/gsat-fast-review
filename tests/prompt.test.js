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

  describe('非選擇題', () => {
    const open = {
      id: 'english-9001',
      subject: 'english',
      topic: '假設語氣與特殊句構',
      type: 'open',
      q: '我當初不該把她的幫助視為理所當然。',
      answer: 'I should not have taken her help for granted.',
      points: ['should not have + 過去分詞', '片語 take … for granted', '受詞 her help'],
      explain: '對過去的事後悔用 should not have + p.p.。',
    };

    it('作答前：叫非選擇題、只有題幹，沒有選項，也不洩漏參考答案與要點', () => {
      const text = questionPrompt(open);
      expect(text).toContain('英文・假設語氣與特殊句構）的非選擇題：');
      expect(text).toContain(open.q);
      expect(text).not.toMatch(/\([A-H]\)/);
      expect(text).not.toContain('參考答案');
      expect(text).not.toContain(open.answer);
      expect(text).not.toContain(open.points[0]);
      // 作答畫面傳進來的是上一題留下的選項順序時也不會出錯
      expect(questionPrompt(open, { order: [3, 1, 0, 2] })).toBe(text);
    });

    it('沒全寫到：附上自評寫到幾個要點、沒寫到哪幾個，還有參考答案、評分要點與解析', () => {
      const text = questionPrompt(open, { outcome: 'wrong', chosen: [1] });
      expect(text).toContain('我的自評：寫到 1／3 個要點（沒寫到：should not have + 過去分詞；受詞 her help）');
      expect(text).toContain(`參考答案：${open.answer}`);
      expect(text).toContain('評分要點：should not have + 過去分詞；片語 take … for granted；受詞 her help');
      expect(text).toContain(`題目附的解析：${open.explain}`);
      expect(text).toContain('我有要點沒寫到');
      expect(text).not.toContain('正確答案');
      // 一個都沒勾
      expect(questionPrompt(open, { outcome: 'wrong', chosen: [] })).toContain('我的自評：寫到 0／3 個要點（沒寫到：');
    });

    it('全寫到、看解答、從錯題本複製', () => {
      const right = questionPrompt(open, { outcome: 'right', chosen: [0, 1, 2] });
      expect(right).toContain('我的自評：寫到 3／3 個要點\n');
      expect(right).not.toContain('沒寫到');
      const skip = questionPrompt(open, { outcome: 'skip', chosen: null });
      expect(skip).toContain('我的答案：不會，直接看了解答');
      expect(skip).not.toContain('自評');
      expect(skip).toContain(`參考答案：${open.answer}`);
      const review = questionPrompt(open, { outcome: 'review' });
      expect(review).not.toContain('自評');
      expect(review).toContain('評分要點：');
      expect(review).toContain('之前沒寫好');
    });
  });
});
