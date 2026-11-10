import { describe, expect, it } from 'vitest';
import { seenChoices } from '../src/ui/past.js';
import { answerHTML, mineHTML, openPointsHTML, reviewItem } from '../src/ui/review-item.js';
import { speechText } from '../src/ui/speech.js';

const mc = { type: 'mc', choices: ['甲', '乙', '丙', '丁'], answer: 2 };
const tf = { type: 'tf', answer: false };

describe('回看上一題：當時的選項', () => {
  it('單選題照當時打亂後的順序，標出正解和選錯的那個', () => {
    expect(seenChoices(mc, { outcome: 'wrong', chosen: 0, order: [3, 0, 2, 1] })).toEqual([
      { value: 3, state: '' },
      { value: 0, state: 'wrong' },
      { value: 2, state: 'right' },
      { value: 1, state: '' },
    ]);
  });

  it('答對只標正解；看解答沒有選，也只標正解', () => {
    const states = (entry) => seenChoices(mc, entry).map((c) => c.state);
    expect(states({ outcome: 'right', chosen: 2, order: [0, 1, 2, 3] })).toEqual(['', '', 'right', '']);
    expect(states({ outcome: 'skip', chosen: null, order: [1, 2, 3, 0] })).toEqual(['', 'right', '', '']);
  });

  it('沒記到順序的舊紀錄照原始順序', () => {
    expect(seenChoices(mc, { outcome: 'skip', chosen: null }).map((c) => c.value)).toEqual([0, 1, 2, 3]);
  });

  it('多選題：選對的、選錯的、漏選的；看解答沒有作答時，正解不算漏選', () => {
    const ms = { type: 'ms', choices: ['甲', '乙', '丙', '丁', '戊'], answer: [0, 2] };
    const states = (entry) => seenChoices(ms, entry).map((c) => c.state);
    expect(states({ outcome: 'wrong', chosen: [0, 3], order: [0, 1, 2, 3, 4] })).toEqual(['right', '', 'missed', 'wrong', '']);
    expect(states({ outcome: 'skip', chosen: null, order: [4, 3, 2, 1, 0] })).toEqual(['', '', 'right', '', 'right']);
  });

  it('是非題固定左錯右對', () => {
    expect(seenChoices(tf, { outcome: 'wrong', chosen: true })).toEqual([
      { value: false, state: 'right' },
      { value: true, state: 'wrong' },
    ]);
  });
});

describe('非選擇題的題目卡（結算、錯題本、回看上一題）', () => {
  const open = {
    id: 'english-9001',
    subject: 'english',
    topic: '假設語氣與特殊句構',
    type: 'open',
    q: '我當初不該把她的幫助視為理所當然。',
    answer: 'I should not have taken her help for granted.',
    points: ['should not have + 過去分詞', '片語 take … for granted', '受詞 <her help>'],
    explain: '對過去的事後悔用 should not have + p.p.。',
    level: 2,
  };

  it('正解是參考答案；你的答案是自評寫到幾個要點', () => {
    expect(answerHTML(open, open.answer)).toBe('I should not have taken her help for granted.');
    expect(mineHTML(open, { outcome: 'wrong', chosen: [0, 2] })).toBe('自評：寫到 2／3 個要點');
    expect(mineHTML(open, { outcome: 'wrong', chosen: [] })).toBe('自評：寫到 0／3 個要點');
  });

  it('題目卡寫「參考答案」，下面列出每個評分要點（文字照樣跳脫）', () => {
    const html = reviewItem(open, { index: 0, flagged: false, starred: false, note: '' });
    expect(html).toContain('參考答案：I should not have taken her help for granted.');
    expect(html).not.toContain('正解：');
    expect(html.match(/class="open-point"/g)).toHaveLength(3);
    expect(html).toContain('受詞 &lt;her help&gt;');
  });

  it('回看上一題：自評寫到的要點蓋圈，看解答時都不蓋', () => {
    expect(openPointsHTML(open, [1]).match(/寫到了/g)).toHaveLength(1);
    expect(openPointsHTML(open, null)).not.toContain('寫到了');
    expect(openPointsHTML(open)).not.toContain('寫到了');
  });

  it('發音：中譯英的題幹是中文，念的是英文的參考答案', () => {
    expect(speechText(open)).toBe(open.answer);
    expect(speechText(open, { filled: true })).toBe(open.answer);
  });
});
