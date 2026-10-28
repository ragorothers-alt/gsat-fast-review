import { describe, expect, it } from 'vitest';
import { advance, createSession, current, isCorrect, isOver, multiplier, submit, tick } from '../src/session.js';
import { currentStreak, dayKey, recordAnswer, today } from '../src/stats.js';
import { freshState } from '../src/storage.js';

const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];

describe('session', () => {
  it('連擊倍率每 3 題 +1，最多 ×5', () => {
    expect([1, 3, 4, 6, 7, 13, 99].map(multiplier)).toEqual([1, 1, 2, 2, 3, 5, 5]);
  });

  it('答對累積連擊與分數，答錯或看解答歸零', () => {
    const s = createSession('ten', queue);
    for (let i = 0; i < 4; i++) {
      submit(s, 'right');
      advance(s);
    }
    expect(s.combo).toBe(4);
    expect(s.score).toBe(10 + 10 + 10 + 20);
    submit(s, 'skip');
    expect(s.combo).toBe(0);
    expect(s.maxCombo).toBe(4);
    expect(s).toMatchObject({ right: 4, wrong: 0, skipped: 1 });
    expect(s.log.map((e) => e.outcome)).toEqual(['right', 'right', 'right', 'right', 'skip']);
  });

  it('題目出完就結束', () => {
    const s = createSession('ten', queue.slice(0, 2));
    expect(current(s).id).toBe('a');
    expect(advance(s)).toBe(true);
    expect(advance(s)).toBe(false);
    expect(isOver(s)).toBe(true);
  });

  it('快閃模式時間到就結束，不會變負數', () => {
    const s = createSession('blitz', queue);
    expect(s.timeLeft).toBe(60);
    tick(s, 59.5);
    expect(isOver(s)).toBe(false);
    tick(s, 2);
    expect(s.timeLeft).toBe(0);
    expect(isOver(s)).toBe(true);
  });

  it('判斷正誤：單選比索引、是非比布林', () => {
    expect(isCorrect({ type: 'mc', answer: 2 }, 2)).toBe(true);
    expect(isCorrect({ type: 'mc', answer: 2 }, 1)).toBe(false);
    expect(isCorrect({ type: 'tf', answer: false }, false)).toBe(true);
    expect(isCorrect({ type: 'tf', answer: false }, true)).toBe(false);
  });
});

describe('stats', () => {
  const day1 = new Date(2026, 9, 27, 21, 0).getTime();
  const day2 = new Date(2026, 9, 28, 7, 30).getTime();
  const day4 = new Date(2026, 9, 30, 12, 0).getTime();

  it('統計今日題數與正確數；看解答不算作答量', () => {
    const st = freshState();
    recordAnswer(st, 'right', day1);
    recordAnswer(st, 'wrong', day1);
    recordAnswer(st, 'skip', day1);
    expect(today(st, day1)).toEqual({ answered: 2, right: 1 });
    expect(dayKey(day1)).toBe('2026-10-27');
  });

  it('連續天數：隔天練習 +1，中斷一天就重來', () => {
    const st = freshState();
    recordAnswer(st, 'right', day1);
    recordAnswer(st, 'right', day1);
    expect(st.streak.count).toBe(1);
    recordAnswer(st, 'skip', day2);
    expect(st.streak.count).toBe(2);
    expect(currentStreak(st, day2)).toBe(2);
    // 第 3 天沒練：第 4 天看的時候已經斷了
    expect(currentStreak(st, day4)).toBe(0);
    recordAnswer(st, 'right', day4);
    expect(st.streak.count).toBe(1);
  });
});
