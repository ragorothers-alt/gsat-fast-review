// 更新說明：資料格式（id 由新到舊、不重複、每筆 1–4 點、每點 70 字內）與「跳不跳、列哪幾筆」的規則
import { describe, expect, it } from 'vitest';
import { NEWS, RECENT_DAYS, latestNews, newerThan, newsToShow, unseenNews } from '../src/news.js';

const LIST = [
  { id: '2026-11-15-2', title: 'C', items: ['c'] },
  { id: '2026-11-15-1', title: 'B', items: ['b'] },
  { id: '2026-11-01-1', title: 'A', items: ['a'] },
];
const NOW = new Date(2026, 10, 15, 12).getTime();
const withCards = { cards: { 'math-001': {} } };

describe('NEWS 資料', () => {
  it('id 是 YYYY-MM-DD-N、由新到舊、不重複', () => {
    for (const n of NEWS) expect(n.id).toMatch(/^\d{4}-\d{2}-\d{2}-\d+$/);
    const ids = NEWS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) expect(newerThan(ids[i - 1], ids[i]), `${ids[i - 1]} 要比 ${ids[i]} 新`).toBe(true);
  });

  it('先後照數字比：當天第 10 筆在第 9 筆之後，不是照字串', () => {
    expect(newerThan('2026-11-15-10', '2026-11-15-9')).toBe(true);
    expect(newerThan('2026-11-15-9', '2026-11-15-10')).toBe(false);
    expect(newerThan('2026-11-16-1', '2026-11-15-12')).toBe(true);
    expect(newerThan('2026-11-15-3', '2026-11-15-3')).toBe(false);
    expect(newerThan('2026-11-15-3', 'oops')).toBe(false);
  });

  it('每筆有標題與 1–4 點，每點 70 字內', () => {
    for (const n of NEWS) {
      expect(n.title.length).toBeGreaterThan(1);
      expect(n.items.length).toBeGreaterThanOrEqual(1);
      expect(n.items.length).toBeLessThanOrEqual(4);
      for (const t of n.items) expect([...t].length).toBeLessThanOrEqual(70);
    }
  });

  it('latestNews 是第一筆', () => {
    expect(latestNews(LIST)).toBe('2026-11-15-2');
    expect(latestNews([])).toBe('');
  });
});

describe('unseenNews', () => {
  it('列出比看過的那筆新的', () => {
    expect(unseenNews('2026-11-15-1', NOW, LIST).map((n) => n.title)).toEqual(['C']);
    expect(unseenNews('2026-11-15-2', NOW, LIST)).toEqual([]);
    expect(unseenNews('2026-10-01-1', NOW, LIST)).toHaveLength(3);
    // 看過當天第 10 筆：第 9 筆不算新的
    const ten = [{ id: '2026-11-15-10', title: 'J', items: ['j'] }, { id: '2026-11-15-9', title: 'I', items: ['i'] }];
    expect(unseenNews('2026-11-15-10', NOW, ten)).toEqual([]);
    expect(unseenNews('2026-11-15-9', NOW, ten).map((n) => n.title)).toEqual(['J']);
  });

  it(`從沒記過的只列最近 ${RECENT_DAYS} 天的`, () => {
    expect(unseenNews(null, NOW, LIST).map((n) => n.title)).toEqual(['C', 'B']);
  });
});

describe('newsToShow', () => {
  it('沒有作答紀錄的新使用者不跳', () => {
    expect(newsToShow({ cards: {} }, null, NOW, LIST)).toEqual([]);
    expect(newsToShow({ cards: {} }, '2026-11-01-1', NOW, LIST)).toEqual([]);
  });

  it('有紀錄又有沒看過的才跳', () => {
    expect(newsToShow(withCards, '2026-11-01-1', NOW, LIST)).toHaveLength(2);
    expect(newsToShow(withCards, '2026-11-15-2', NOW, LIST)).toEqual([]);
  });
});
