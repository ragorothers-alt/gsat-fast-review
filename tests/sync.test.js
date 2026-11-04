import { describe, expect, it } from 'vitest';
import { exportBackup, mergeCard, mergeState, parseBackup, setFlag, setStar } from '../src/sync.js';
import { shiftDay } from '../src/stats.js';
import { freshState } from '../src/storage.js';

const card = (last, extra = {}) => ({ box: 1, due: last + 1, seen: 1, right: 1, wrong: 0, parked: false, last, ...extra });

function state(patch) {
  return { ...freshState(), ...patch };
}

describe('backup', () => {
  it('匯出再讀回，進度欄位不變', () => {
    const s = state({ cards: { a: card(5) }, flags: { b: 9 }, stars: { c: 7 }, starsOff: { d: 8 } });
    const back = parseBackup(exportBackup(s, 100));
    expect(back.cards).toEqual(s.cards);
    expect(back.flags).toEqual({ b: 9 });
    expect(back.stars).toEqual({ c: 7 });
    expect(back.starsOff).toEqual({ d: 8 });
    expect(back.settings).toBeUndefined();
  });

  it('不是這個遊戲的檔案就丟出錯誤', () => {
    expect(() => parseBackup('not json')).toThrow('不是有效的進度備份');
    expect(() => parseBackup('{"app":"other","state":{}}')).toThrow('不是學測快問快答');
  });
});

describe('mergeState', () => {
  it('同一題以較晚作答的排程為準，累計次數取較大值', () => {
    const local = state({ cards: { 'math-001': card(10, { box: 3, seen: 5, right: 4, wrong: 1 }) } });
    const incoming = { cards: { 'math-001': card(20, { box: 0, seen: 3, right: 1, wrong: 2 }), 'math-002': card(7) } };
    const { state: s, added, updated } = mergeState(local, incoming);
    expect(s.cards['math-001']).toMatchObject({ box: 0, last: 20, seen: 5, right: 4, wrong: 2 });
    expect(s.cards['math-002'].last).toBe(7);
    expect({ added, updated }).toEqual({ added: 1, updated: 1 });
  });

  it('重複匯入同一份檔案，結果不變', () => {
    const local = state({ cards: { 'math-001': card(10) }, daily: { '2026-10-27': { answered: 5, right: 3 } } });
    const incoming = { cards: { 'math-001': card(30, { seen: 2 }) }, daily: { '2026-10-27': { answered: 8, right: 6 } } };
    const once = mergeState(local, incoming).state;
    const twice = mergeState(once, incoming).state;
    expect(twice).toEqual(once);
    expect(once.daily['2026-10-27']).toEqual({ answered: 8, right: 6 });
  });

  it('保留本機設定物件，回報題目取聯集', () => {
    const local = state({ flags: { 'math-001': 5 } });
    const { state: s } = mergeState(local, { flags: { 'math-001': 9, 'math-002': 3 } });
    expect(s.settings).toBe(local.settings);
    expect(s.flags).toEqual({ 'math-001': 9, 'math-002': 3 });
  });

  it('取消回報比另一份的回報晚，就維持取消；比較早則以回報為準', () => {
    const local = state();
    setFlag(local, 'math-001', true, 5);
    setFlag(local, 'math-001', false, 8);
    setFlag(local, 'math-002', false, 2);
    const { state: s } = mergeState(local, { flags: { 'math-001': 6, 'math-002': 4 } });
    expect(s.flags).toEqual({ 'math-002': 4 });
    expect(s.flagsOff).toEqual({ 'math-001': 8 });
    // 對方取消得更晚
    expect(mergeState(s, { flagsOff: { 'math-002': 9 } }).state.flags).toEqual({});
  });

  it('收藏與回報各自合併，互不影響', () => {
    const local = state();
    setStar(local, 'math-001', true, 5);
    setStar(local, 'math-002', false, 9);
    const { state: s } = mergeState(local, { stars: { 'math-002': 6, 'math-003': 3 }, flags: { 'math-001': 4 } });
    expect(s.stars).toEqual({ 'math-001': 5, 'math-003': 3 });
    expect(s.starsOff).toEqual({ 'math-002': 9 });
    expect(s.flags).toEqual({ 'math-001': 4 });
  });

  it('欄位不是合理整數的卡片、格式不對的題目 id、時間不是數字的標記，整筆略過', () => {
    const incoming = {
      cards: {
        'math-001': { ...card(5), wrong: 'oops' },
        'math-002': { ...card(5), box: 100 },
        'not an id': card(5),
        'math-003': card(5),
      },
      stars: { 'math-004': 'x', 'math-005': 6 },
      daily: { '2026-10-27': { answered: 'x', right: 0 }, '2026-10-28': { answered: 3, right: 2 } },
    };
    const { state: s, added } = mergeState(state(), incoming);
    expect(Object.keys(s.cards)).toEqual(['math-003']);
    expect(added).toBe(1);
    expect(s.stars).toEqual({ 'math-005': 6 });
    expect(s.daily).toEqual({ '2026-10-28': { answered: 3, right: 2 } });
  });

  it('一邊看過解答、一邊答對：合併後次數被拉平，但記得失手過', () => {
    const right = { box: 3, due: 50, seen: 2, right: 2, wrong: 0, parked: false, last: 2 };
    const skipped = { box: 0, due: 60, seen: 1, right: 0, wrong: 0, parked: true, last: 3 };
    for (const merged of [mergeCard(right, skipped), mergeCard(skipped, right)]) {
      expect(merged).toMatchObject({ seen: 2, right: 2, wrong: 0, missed: 1 });
    }
    // 之後在另一台連續答對，到期時間照算，missed 仍在
    const later = mergeCard({ ...right, last: 9, box: 5 }, mergeCard(right, skipped));
    expect(later.missed).toBe(1);
  });

  it('舊版備份沒有收藏欄位也能匯入', () => {
    const local = state({ stars: { 'math-001': 5 } });
    expect(mergeState(local, { cards: {} }).state.stars).toEqual({ 'math-001': 5 });
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
