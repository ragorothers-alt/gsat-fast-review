import { describe, expect, it } from 'vitest';
import { MODES, NOVICE_CARDS, advance, createSession, current, extend, isCorrect, isOver, markLast, msNote, msScore, msWrong, multiplier, openNote, quickOnlyFor, submit, tick } from '../src/session.js';
import { adjustRight, currentStreak, dayKey, recordAnswer, today } from '../src/stats.js';
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

  it('答對後標成猜的或不太確定：不算答對，分數連擊照算；換標記不重扣，取消再加回', () => {
    const s = createSession('ten', queue);
    submit(s, 'right');
    markLast(s, 'guess');
    expect(s).toMatchObject({ right: 0, score: 10, combo: 1 });
    expect(s.log[0]).toMatchObject({ outcome: 'right', mark: 'guess' });
    markLast(s, 'unsure');
    expect(s.right).toBe(0);
    expect(s.log[0].mark).toBe('unsure');
    markLast(s, null);
    expect(s.right).toBe(1);
    expect(s.log[0]).not.toHaveProperty('mark');
  });

  it('答錯或看解答的題不能標', () => {
    const s = createSession('ten', queue);
    submit(s, 'wrong');
    markLast(s, 'guess');
    expect(s.log[0]).not.toHaveProperty('mark');
    expect(s.right).toBe(0);
  });

  it('題目出完就結束', () => {
    const s = createSession('ten', queue.slice(0, 2));
    expect(current(s).id).toBe('a');
    expect(advance(s)).toBe(true);
    expect(advance(s)).toBe(false);
    expect(isOver(s)).toBe(true);
  });

  it('自由練習不計時，補題後可以一直往下出', () => {
    const s = createSession('free', queue.slice(0, 1));
    expect(s.timeLeft).toBeNull();
    submit(s, 'wrong');
    extend(s, queue.slice(1, 3));
    expect(advance(s)).toBe(true);
    expect(current(s).id).toBe('b');
    expect(s.queue).toHaveLength(3);
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

  it('只出單題：設定開著或還在新手期（作答紀錄不到 20 題）時，10 題一輪、自由練習、公式特訓、錯題複習、弱點加強都只出單題', () => {
    const veteran = { answered: NOVICE_CARDS };
    for (const mode of ['ten', 'free', 'formula', 'review', 'weak']) {
      // 老手、設定沒開：照常出
      expect(quickOnlyFor(mode, veteran), mode).toBe(false);
      // 設定開了
      expect(quickOnlyFor(mode, { ...veteran, quickOnly: true }), mode).toBe(true);
      // 新手期：0–19 題都是，滿 20 題就不是
      expect(quickOnlyFor(mode, { answered: 0 }), mode).toBe(true);
      expect(quickOnlyFor(mode, { answered: NOVICE_CARDS - 1 }), mode).toBe(true);
      // 沒給作答題數當成新手
      expect(quickOnlyFor(mode), mode).toBe(true);
    }
  });

  it('只出單題：快閃一律只出單題；單元闖關、指定題目的模式與錯題延伸不受設定與新手期影響', () => {
    expect(quickOnlyFor('blitz', { answered: 500 })).toBe(true);
    for (const mode of ['path', 'starred', 'picked', 'vocab', 'exam', 'related']) {
      expect(quickOnlyFor(mode, { quickOnly: true, answered: 0 }), mode).toBe(false);
    }
    // 每個模式都歸得到其中一類（新增模式時記得決定它受不受影響）
    for (const mode of Object.keys(MODES)) expect(typeof quickOnlyFor(mode, { answered: 0 })).toBe('boolean');
  });

  it('判斷正誤：單選比索引、是非比布林', () => {
    expect(isCorrect({ type: 'mc', answer: 2 }, 2)).toBe(true);
    expect(isCorrect({ type: 'mc', answer: 2 }, 1)).toBe(false);
    expect(isCorrect({ type: 'tf', answer: false }, false)).toBe(true);
    expect(isCorrect({ type: 'tf', answer: false }, true)).toBe(false);
  });

  it('多選題：選的和正解完全一樣才算對；沒全對照學測規則部分給分', () => {
    const q = { type: 'ms', choices: ['甲', '乙', '丙', '丁', '戊'], answer: [0, 2] };
    expect(isCorrect(q, [2, 0])).toBe(true);
    expect(isCorrect(q, [0])).toBe(false);
    expect(isCorrect(q, [0, 2, 3])).toBe(false);
    expect(isCorrect(q, null)).toBe(false);
    // 5 個選項：錯 0 個得 1、錯 1 個得 3/5、錯 2 個得 1/5、錯 3 個以上和沒作答都是 0
    expect(msWrong(q, [0])).toBe(1);
    expect(msScore(q, [0, 2])).toBe(1);
    expect(msScore(q, [0])).toBeCloseTo(0.6);
    expect(msScore(q, [0, 3])).toBeCloseTo(0.2);
    expect(msScore(q, [1, 3, 4])).toBe(0);
    expect(msScore(q, [])).toBe(0);
    expect(msNote(q, [0])).toBe('答錯 1 個選項：學測這題可得 3/5 的分數');
    expect(msNote(q, [1, 3])).toBe('答錯 4 個選項：學測這題 0 分');
  });

  it('非選擇題：自評每個要點都寫到才算對；一個都沒勾也是有效的作答（答錯）', () => {
    const q = { type: 'open', answer: 'I should not have taken her help for granted.', points: ['should not have + p.p.', 'take … for granted', '受詞 her help'] };
    expect(isCorrect(q, [0, 1, 2])).toBe(true);
    expect(isCorrect(q, [0, 2])).toBe(false);
    expect(isCorrect(q, [])).toBe(false);
    expect(isCorrect(q, null)).toBe(false);
    // 參考答案是字串：不能拿來和作答比
    expect(isCorrect(q, q.answer)).toBe(false);
    expect(openNote(q, [0, 2])).toBe('自評：寫到 2／3 個要點');
    expect(openNote(q, [])).toBe('自評：寫到 0／3 個要點');
    expect(openNote(q, null)).toBe('自評：寫到 0／3 個要點');
  });

  it('非選擇題照一般題計分：全寫到加分、接連擊，沒全寫到連擊歸零；自評的要點記在作答紀錄', () => {
    const s = createSession('ten', [{ id: 'a' }, { id: 'b' }]);
    expect(submit(s, 'right', [0, 1])).toBe(10);
    advance(s);
    expect(submit(s, 'wrong', [1])).toBe(0);
    expect(s).toMatchObject({ right: 1, wrong: 1, combo: 0 });
    expect(s.log).toEqual([
      { id: 'a', outcome: 'right', chosen: [0, 1] },
      { id: 'b', outcome: 'wrong', chosen: [1] },
    ]);
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

  it('答對後標成猜的：那天的答對數扣回來（這台的同步紀錄也是），取消再加回；作答量不變', () => {
    const st = freshState();
    st.cloud = { device: 'me', devices: {}, legacy: {} };
    recordAnswer(st, 'right', day1);
    adjustRight(st, -1, day1);
    expect(today(st, day1)).toEqual({ answered: 1, right: 0 });
    expect(st.cloud.devices.me[dayKey(day1)]).toEqual({ answered: 1, right: 0 });
    adjustRight(st, 1, day1);
    expect(today(st, day1)).toEqual({ answered: 1, right: 1 });
    expect(st.cloud.devices.me[dayKey(day1)]).toEqual({ answered: 1, right: 1 });
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

  it('時鐘往回調（或往西跨過換日線）：最後練習日比今天晚，連續天數不歸零', () => {
    const st = freshState();
    recordAnswer(st, 'right', day1);
    recordAnswer(st, 'right', day2);
    recordAnswer(st, 'right', day1);
    expect(st.streak).toEqual({ count: 2, last: dayKey(day2) });
  });
});
