import { describe, expect, it } from 'vitest';
import { relatedQuestions, relatedQueue } from '../src/related.js';

const q = (id, topic, text, explain = '') => ({ id, subject: 'chemistry', topic, q: text, explain });

const bank = [
  q('c1', '酸鹼', '下列何者是強酸？', '鹽酸在水中完全解離，是強酸。'),
  q('c2', '酸鹼', '下列何者是弱酸？', '醋酸在水中部分解離，是弱酸。'),
  q('c3', '酸鹼', '鹽酸完全解離，所以是強酸。', '強酸在水中完全解離。'),
  q('c4', '酸鹼', '下列何者的 pH 最小？', '氫離子濃度越大，pH 越小。'),
  q('c5', '原子結構', '鹽酸完全解離是強酸的原因。', '強酸在水中完全解離。'),
];

describe('relatedQuestions', () => {
  it('只在同單元裡找，關鍵詞重疊最多的排前面，不含自己', () => {
    const out = relatedQuestions(bank, bank[0], { count: 2 });
    expect(out.map((x) => x.id)).toEqual(['c3', 'c2']);
  });

  it('exclude 的題目不出', () => {
    const out = relatedQuestions(bank, bank[0], { count: 3, exclude: ['c3'] });
    expect(out.map((x) => x.id)).not.toContain('c3');
    expect(out).toHaveLength(2);
  });
});

describe('relatedQueue', () => {
  it('每題錯題輪流排，不重複、不含錯題本身', () => {
    const seeds = [bank[0], bank[3]];
    const ids = relatedQueue(bank, seeds, { size: 10, perSeed: 2 }).map((x) => x.id);
    // 酸鹼單元扣掉兩題錯題只剩 c2、c3
    expect(ids.sort()).toEqual(['c2', 'c3']);
  });

  it('不超過指定題數', () => {
    const out = relatedQueue(bank, [bank[0]], { size: 1 });
    expect(out.map((x) => x.id)).toEqual(['c3']);
  });
});
