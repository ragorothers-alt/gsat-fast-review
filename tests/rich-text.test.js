import { describe, expect, it } from 'vitest';
import { splitMath } from '../src/rich-text.js';
import { FLOORS, LIMITS, cuesOf, eliminationHit, lengthOutlier, measure, numericRank } from '../scripts/lint-cues.mjs';

describe('splitMath（App 與題庫驗證器共用）', () => {
  it('切出 $…$ 公式與一般文字', () => {
    expect(splitMath('面積為 $x^2$ 平方公分')).toEqual({
      segments: [
        { math: false, text: '面積為 ' },
        { math: true, text: 'x^2' },
        { math: false, text: ' 平方公分' },
      ],
      balanced: true,
    });
  });

  it('\\$ 是字面上的錢字號，不開始公式', () => {
    expect(splitMath('售價 \\$30')).toEqual({ segments: [{ math: false, text: '售價 $30' }], balanced: true });
  });

  it('沒有閉合的 $：之後全部當一般文字，並標出不平衡', () => {
    const { segments, balanced } = splitMath('答案是 $x+1');
    expect(balanced).toBe(false);
    expect(segments.at(-1)).toEqual({ math: false, text: '$x+1' });
  });
});

describe('題庫猜題線索（scripts/lint-cues.mjs）', () => {
  const mc = (choices, answer, extra = {}) => ({ type: 'mc', subject: 'math', choices, answer, explain: '', ...extra });

  it('長度明顯最短或最長的選項；差不到 3 字不算', () => {
    expect(lengthOutlier(['重商主義', '主張政府應全面退出市場交易', '主張以農業為國家財富的根本', '主張關稅應一律全面取消'])).toBe(0);
    expect(lengthOutlier(['甲乙丙', '甲乙丙丁', '甲乙丙丁', '甲乙丙丁'])).toBe(-1);
  });

  it('數值選項：正解在大小順序裡的名次；單位不同或有相同值就不算', () => {
    expect(numericRank(mc(['$5$', '$4$', '$9$', '$14$'], 1))).toBe(0);
    expect(numericRank(mc(['$\\frac{1}{2}$', '$\\frac{1}{4}$', '$\\frac{3}{4}$', '$1$'], 0))).toBe(1);
    expect(numericRank(mc(['100 mL', '150 mL', '800 mL', '50 g'], 0))).toBeNull();
    expect(numericRank(mc(['1', '1.0', '2', '3'], 0))).toBeNull();
  });

  it('刪去法：刪掉有絕對詞的選項後從剩下的猜', () => {
    expect(eliminationHit(mc(['一定會下雨', '必定會放晴', '可能會起霧', '完全不會變'], 2))).toBe(1);
    expect(eliminationHit(mc(['甲', '乙', '丙', '丁'], 0))).toBe(0.25);
  });

  it('長度指標：長度突出的選項從來不是正解也算線索（可以刪掉它），所以有下限', () => {
    const q = (answer) => mc(['甲', '甲乙丙丁戊', '甲乙丙丁戊', '甲乙丙丁戊'], answer);
    const never = measure(Array.from({ length: 40 }, () => q(1)));
    expect(never.math.length).toBe(0);
    expect(never.math.length).toBeLessThan(FLOORS.length);
    const fair = measure(Array.from({ length: 40 }, (_, i) => q(i % 4 === 0 ? 0 : 1)));
    expect(fair.math.length).toBe(0.25);
    expect(fair.math.length).toBeGreaterThanOrEqual(FLOORS.length);
    expect(fair.math.length).toBeLessThanOrEqual(LIMITS.length);
  });

  it('解析沒寫出最後的數值答案', () => {
    const q = mc(['$5$', '$4$', '$9$', '$14$'], 1, { explain: '代入 $x=3$，得 $9=q(3)+5$。' });
    expect(cuesOf(q)).toContain('explain');
    expect(cuesOf({ ...q, explain: '代入 $x=3$，得 $9=q(3)+5$，故 $q(3)=4$。' })).not.toContain('explain');
  });

  it('非選擇題沒有選項也沒有對錯可猜：不算線索，也不算進英文是非題的語氣比例', () => {
    const open = { type: 'open', subject: 'english', q: '我們永遠不該把別人的幫助視為理所當然。', answer: 'We should never take help for granted.', points: ['never', 'take … for granted'], explain: '' };
    expect(cuesOf(open)).toEqual([]);
    // 30 題是非題：有 never 的都是對的、沒有的都是錯的，照語氣猜全錯（命中 0）
    const tf = Array.from({ length: 30 }, (_, i) => ({ type: 'tf', subject: 'english', q: i % 2 ? 'Water never boils.' : 'Water boils.', answer: i % 2 === 1, explain: '' }));
    const m = measure([...tf, ...Array.from({ length: 30 }, () => open)]).english;
    expect(m.counts.tf).toBe(30);
    expect(m.tone).toBe(0);
  });
});
