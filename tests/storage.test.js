import { beforeEach, describe, expect, it, vi } from 'vitest';
import { schedule } from '../src/srs.js';

const NOW = 1_800_000_000_000;
let store;

beforeEach(() => {
  store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  vi.resetModules();
});

/** 每個分頁各自載入一份 storage.js（模組裡記著這個分頁最後讀寫的存檔） */
const tab = () => import('../src/storage.js');

describe('讀檔', () => {
  it('壞掉的卡片個別丟掉，其他進度照常', async () => {
    const { KEY, loadState } = await tab();
    const good = schedule(undefined, 'right', NOW);
    store.set(KEY, JSON.stringify({ cards: { 'math-001': good, 'math-002': null, 'math-003': { ...good, seen: 'oops' } }, settings: { goal: 50 } }));
    const s = loadState();
    expect(Object.keys(s.cards)).toEqual(['math-001']);
    expect(s.settings.goal).toBe(50);
    // 舊存檔少了巢狀設定的欄位也補上預設值
    expect(s.settings.reminder).toEqual({ on: false, hour: 20 });
  });

  it('模擬考：考到一半的卷照存；成績紀錄壞掉的筆數丟掉', async () => {
    const { KEY, loadState } = await tab();
    const exam = { paper: 'math', ids: ['math-001'] };
    const ok = { paper: 'math', at: NOW, right: 3, total: 25, blank: 0, secs: 900 };
    store.set(KEY, JSON.stringify({ cards: {}, exam, examLog: [ok, null, { paper: 'math', right: 'x', total: 25, at: NOW }, { ...ok, total: 0 }] }));
    expect(loadState()).toMatchObject({ exam, examLog: [ok] });
    store.set(KEY, JSON.stringify({ cards: {}, exam: [1], examLog: 'oops' }));
    expect(loadState()).toMatchObject({ exam: null, examLog: [] });
  });

  it('整份讀不懂：先把原始內容搬到備份，再從頭開始，下次存檔不會蓋掉它', async () => {
    const { BROKEN_KEY, KEY, loadState, saveState } = await tab();
    store.set(KEY, '{"cards": {');
    const s = loadState();
    expect(s.cards).toEqual({});
    expect(store.get(BROKEN_KEY)).toBe('{"cards": {');
    saveState(s);
    expect(store.get(BROKEN_KEY)).toBe('{"cards": {');
  });

  it('存不進去時回傳 false', async () => {
    const { freshState, saveState } = await tab();
    globalThis.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(saveState(freshState())).toBe(false);
  });
});

describe('同時開兩個分頁', () => {
  it('別的分頁存檔時併進來，之後存檔不會整份蓋掉對方的作答', async () => {
    const a = await tab();
    const stateA = a.loadState();
    vi.resetModules();
    const b = await tab();
    const stateB = b.loadState();

    stateA.cards['math-001'] = schedule(undefined, 'right', NOW);
    a.saveState(stateA);
    // B 收到 storage 事件
    expect(b.absorbState(stateB, store.get(a.KEY))).toBe(true);
    stateB.cards['math-002'] = schedule(undefined, 'wrong', NOW + 1);
    b.saveState(stateB);

    expect(Object.keys(JSON.parse(store.get(a.KEY)).cards).sort()).toEqual(['math-001', 'math-002']);
    // 同一份內容再收到一次不會重複處理
    expect(b.absorbState(stateB, store.get(a.KEY))).toBe(false);
  });

  it('闖關進度與模擬考成績兩邊合併，不會整份換成對方的', async () => {
    const a = await tab();
    const stateA = a.loadState();
    vi.resetModules();
    const b = await tab();
    const stateB = b.loadState();
    const exam = (at, paper) => ({ paper, at, total: 25, right: 10, points: 10, blank: 0, secs: 900 });
    stateA.path = { math: { cleared: ['A'], clearedAt: { A: NOW }, runs: {} } };
    stateA.examLog = [exam(NOW, 'math')];
    a.saveState(stateA);
    stateB.path = { physics: { cleared: ['力學'], clearedAt: { 力學: NOW + 1 }, runs: {} } };
    stateB.examLog = [exam(NOW + 5, 'science')];
    b.absorbState(stateB, store.get(a.KEY));
    expect(Object.keys(stateB.path).sort()).toEqual(['math', 'physics']);
    expect(stateB.examLog.map((e) => e.paper)).toEqual(['math', 'science']);
  });

  it('設定沿用同一個物件（各畫面拿著它的參照），內容換成對方較新的', async () => {
    const a = await tab();
    const stateA = a.loadState();
    vi.resetModules();
    const b = await tab();
    const stateB = b.loadState();
    const settings = stateB.settings;
    stateA.settings.goal = 90;
    a.saveState(stateA);
    b.absorbState(stateB, store.get(a.KEY));
    expect(stateB.settings).toBe(settings);
    expect(settings.goal).toBe(90);
  });
});
