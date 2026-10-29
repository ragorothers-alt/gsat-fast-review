import { describe, expect, it } from 'vitest';
import { exportBackup, mergeState, parseBackup, setFlag } from '../src/sync.js';
import { shiftDay } from '../src/stats.js';
import { freshState } from '../src/storage.js';

const card = (last, extra = {}) => ({ box: 1, due: last + 1, seen: 1, right: 1, wrong: 0, parked: false, last, ...extra });

function state(patch) {
  return { ...freshState(), ...patch };
}

describe('backup', () => {
  it('匯出再讀回，進度欄位不變', () => {
    const s = state({ cards: { a: card(5) }, flags: { b: 9 } });
    const back = parseBackup(exportBackup(s, 100));
    expect(back.cards).toEqual(s.cards);
    expect(back.flags).toEqual({ b: 9 });
    expect(back.settings).toBeUndefined();
  });

  it('不是這個遊戲的檔案就丟出錯誤', () => {
    expect(() => parseBackup('not json')).toThrow('不是有效的進度備份');
    expect(() => parseBackup('{"app":"other","state":{}}')).toThrow('不是學測快問快答');
  });
});

describe('mergeState', () => {
  it('同一題以較晚作答的排程為準，累計次數取較大值', () => {
    const local = state({ cards: { a: card(10, { box: 3, seen: 5, right: 4, wrong: 1 }) } });
    const incoming = { cards: { a: card(20, { box: 0, seen: 3, right: 1, wrong: 2 }), b: card(7) } };
    const { state: s, added, updated } = mergeState(local, incoming);
    expect(s.cards.a).toMatchObject({ box: 0, last: 20, seen: 5, right: 4, wrong: 2 });
    expect(s.cards.b.last).toBe(7);
    expect({ added, updated }).toEqual({ added: 1, updated: 1 });
  });

  it('重複匯入同一份檔案，結果不變', () => {
    const local = state({ cards: { a: card(10) }, daily: { '2026-10-27': { answered: 5, right: 3 } } });
    const incoming = { cards: { a: card(30, { seen: 2 }) }, daily: { '2026-10-27': { answered: 8, right: 6 } } };
    const once = mergeState(local, incoming).state;
    const twice = mergeState(once, incoming).state;
    expect(twice).toEqual(once);
    expect(once.daily['2026-10-27']).toEqual({ answered: 8, right: 6 });
  });

  it('保留本機設定物件，回報題目取聯集', () => {
    const local = state({ flags: { a: 5 } });
    const { state: s } = mergeState(local, { flags: { a: 9, b: 3 } });
    expect(s.settings).toBe(local.settings);
    expect(s.flags).toEqual({ a: 9, b: 3 });
  });

  it('取消回報比另一份的回報晚，就維持取消；比較早則以回報為準', () => {
    const local = state();
    setFlag(local, 'a', true, 5);
    setFlag(local, 'a', false, 8);
    setFlag(local, 'b', false, 2);
    const { state: s } = mergeState(local, { flags: { a: 6, b: 4 } });
    expect(s.flags).toEqual({ b: 4 });
    expect(s.flagsOff).toEqual({ a: 8 });
    // 對方取消得更晚
    expect(mergeState(s, { flagsOff: { b: 9 } }).state.flags).toEqual({});
  });

  it('連續天數依合併後的每日紀錄重算', () => {
    const d = (k) => ({ [k]: { answered: 1, right: 1 } });
    const local = state({ daily: { ...d('2026-10-25'), ...d('2026-10-26') }, streak: { count: 2, last: '2026-10-26' } });
    const incoming = { daily: { ...d('2026-10-27'), ...d('2026-10-28') }, streak: { count: 2, last: '2026-10-28' } };
    expect(mergeState(local, incoming).state.streak).toEqual({ count: 4, last: '2026-10-28' });
  });

  it('日期推算跨月份', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
});
