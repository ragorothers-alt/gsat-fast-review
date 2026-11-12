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

describe('relatedQuestions：考點', () => {
  const k = (id, topic, kp, text) => ({ id, subject: 'math', topic, kp, q: text, explain: '' });
  const kb = [
    k('m1', '機率', '06-10', '袋中有紅球白球，已知取到紅球，求來自甲袋的機率。'),
    k('m2', '機率', '06-02', '袋中有紅球白球，已知取到紅球，求取到兩紅球的機率。'),
    k('m3', '機率', '06-10', '擲兩枚骰子，已知點數和為偶數，求兩顆都是奇數的機率。'),
    k('m4', '跨單元綜合', '06-10', '數列與機率：已知第一次成功，求第二次也成功的機率。'),
    k('m5', '數列與級數', '04-01', '袋中紅球白球數成等差數列。'),
  ];

  it('同考點的題目排在字詞更像、但考點不同的題目前面', () => {
    const ids = relatedQuestions(kb, kb[0], { count: 3 }).map((x) => x.id);
    // m2 和 m1 的字詞最像，但考點不同；同考點的 m3、跨單元的 m4 排前面
    expect(ids.slice(0, 2).sort()).toEqual(['m3', 'm4']);
    expect(ids[2]).toBe('m2');
  });

  it('跨單元綜合題借用的考點：那個單元裡同考點的題目也找得到', () => {
    expect(relatedQuestions(kb, kb[3], { count: 2 }).map((x) => x.id).sort()).toEqual(['m1', 'm3']);
  });

  it('沒標考點的題目照舊只在同單元裡比字詞', () => {
    const plain = { ...kb[1], kp: undefined };
    expect(relatedQuestions([...kb.slice(0, 1), plain, ...kb.slice(2)], plain, { count: 5 }).map((x) => x.id).sort()).toEqual(['m1', 'm3']);
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
