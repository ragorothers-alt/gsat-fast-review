import { describe, expect, it } from 'vitest';
import { seenChoices } from '../src/ui/past.js';

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

  it('是非題固定左錯右對', () => {
    expect(seenChoices(tf, { outcome: 'wrong', chosen: true })).toEqual([
      { value: false, state: 'right' },
      { value: true, state: 'wrong' },
    ]);
  });
});
