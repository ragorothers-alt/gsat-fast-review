import { describe, expect, it } from 'vitest';
import { schedule } from '../src/srs.js';
import { freshState } from '../src/storage.js';
import { SUBJECTS } from '../src/subjects.js';
import { TRACKS, WELCOME_GOALS, needsWelcome, orderSubjects, trackOf } from '../src/welcome.js';

describe('第一次開啟的設定', () => {
  it('這台沒有作答紀錄、也沒看過才顯示', () => {
    const state = freshState();
    expect(needsWelcome(state, false)).toBe(true);
    // 看過（按了開始練習或之後再說）就不再顯示
    expect(needsWelcome(state, true)).toBe(false);
    // 已經有作答紀錄的舊使用者、從同步碼或匯入還原進度的人：不顯示
    state.cards['math-001'] = schedule(undefined, 'right', 1_800_000_000_000);
    expect(needsWelcome(state, false)).toBe(false);
  });

  it('快速選擇：自然組、社會組都含國英數，全部是十科', () => {
    const byId = Object.fromEntries(TRACKS.map((t) => [t.id, t.subjects]));
    expect(byId.science).toEqual(['chinese', 'english', 'math', 'physics', 'chemistry', 'biology', 'earth']);
    expect(byId.social).toEqual(['chinese', 'english', 'math', 'history', 'geography', 'civics']);
    expect(byId.all).toEqual(SUBJECTS.map((s) => s.id));
    expect(TRACKS.map((t) => t.name)).toEqual(['自然組', '社會組', '全部']);
  });

  it('選的科目剛好是某個快速選擇就標出來（順序不拘），多一科少一科都不算', () => {
    expect(trackOf(SUBJECTS.map((s) => s.id))).toBe('all');
    expect(trackOf(['civics', 'geography', 'history', 'math', 'english', 'chinese'])).toBe('social');
    expect(trackOf(['chinese', 'english', 'math', 'physics', 'chemistry', 'biology', 'earth'])).toBe('science');
    expect(trackOf(['chinese', 'english', 'math', 'physics', 'chemistry', 'biology'])).toBeNull();
    expect(trackOf([])).toBeNull();
  });

  it('存進設定前照科目表的順序排好，不認得的科目拿掉', () => {
    expect(orderSubjects(['civics', 'math', 'nope', 'chinese'])).toEqual(['chinese', 'math', 'civics']);
  });

  it('每日目標的選項包含預設值', () => {
    expect(WELCOME_GOALS).toEqual([10, 20, 30, 50]);
    expect(WELCOME_GOALS).toContain(freshState().settings.goal);
  });
});
