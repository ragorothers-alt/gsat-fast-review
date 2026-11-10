import { describe, expect, it } from 'vitest';
import { PLAN_STRETCH, dayIndex, dueBuckets, estimateRates, keepUpGoal, planVerdict, reviewForecast, simulate, studyPlan } from '../src/forecast.js';
import { DAY, schedule } from '../src/srs.js';
import { GOALS } from '../src/stats.js';

// 本地時間中午，加減幾天都不會跨到別的日期
const NOW = new Date(2026, 10, 4, 12).getTime();
const card = (box, dueInDays, extra = {}) => ({ box, due: NOW + dueInDays * DAY, seen: 2, right: 1, wrong: 1, missed: 1, ...extra });
const round = (rows) => rows.map((r) => ({ review: +r.review.toFixed(2), fresh: +r.fresh.toFixed(2) }));

describe('dayIndex / dueBuckets', () => {
  it('過期的算今天，其他照本地日期算第幾天', () => {
    expect(dayIndex(NOW - 3 * DAY, NOW)).toBe(0);
    expect(dayIndex(NOW + 6 * 3600_000, NOW)).toBe(0);
    expect(dayIndex(NOW + 13 * 3600_000, NOW)).toBe(1);
    expect(dayIndex(NOW + 3 * DAY, NOW)).toBe(3);
  });

  it('依到期日與盒子分組；答對過、從沒失手的不再出，不算', () => {
    const never = schedule(undefined, 'right', NOW);
    const buckets = dueBuckets([card(2, 1), card(2, 1), card(4, 3), card(0, -1), never], NOW);
    expect(buckets.get(0)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(buckets.get(1)).toEqual([0, 0, 2, 0, 0, 0, 0]);
    expect(buckets.get(3)).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect([...buckets.keys()].sort()).toEqual([0, 1, 3]);
  });
});

describe('simulate', () => {
  // 作答量夠多：到期的都複習得完
  const plenty = () => 1000;

  it('一直答對：每次升一盒，隔 1、3、7 天再出', () => {
    const rows = simulate(dueBuckets([card(2, 1)], NOW), { days: 13, budget: plenty, fresh: 0, recall: 1, first: 1 });
    // 第 1 天複習（升到第 3 盒）→ 第 4 天（第 4 盒）→ 第 11 天（第 5 盒）
    expect(rows.map((r) => r.review)).toEqual([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]);
    expect(rows.map((r) => r.due)).toEqual([0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0]);
  });

  it('答錯的部分當天重學兩次，隔天從第 2 盒再複習', () => {
    const rows = simulate(dueBuckets([card(3, 0)], NOW), { days: 5, budget: plenty, fresh: 0, recall: 0.5, first: 1 });
    // 第 0 天：複習 1 次＋一半答錯重學 2 次；答錯的一半隔天從第 2 盒複習（一樣一半錯、一半升盒），答對的一半升到第 4 盒隔 7 天
    // 第 4 天：第 1 天答對升到第 3 盒的 0.25 張到期，加上連錯三次的 0.0625 張
    expect(round(rows).map((r) => r.review)).toEqual([2, 1, 0.5, 0.25, 0.63]);
  });

  it('剛答錯還在第 0、1 盒的卡：當天再答一兩次，隔天到第 2 盒', () => {
    const rows = simulate(dueBuckets([card(0, 0), card(1, 0)], NOW), { days: 3, budget: plenty, fresh: 0, recall: 1, first: 1 });
    expect(rows.map((r) => r.review)).toEqual([3, 2, 0]);
  });

  it('沒有到期的複習時全部做新題；新題做完就沒有了', () => {
    const rows = simulate(new Map(), { days: 4, budget: () => 10, fresh: 25, recall: 1, first: 1 });
    expect(round(rows)).toEqual([
      { review: 0, fresh: 10 },
      { review: 0, fresh: 10 },
      { review: 0, fresh: 5 },
      { review: 0, fresh: 0 },
    ]);
  });

  it('新題答錯的當天重學、隔天開始複習，占掉之後的作答量', () => {
    const rows = simulate(new Map(), { days: 2, budget: () => 10, fresh: 100, recall: 1, first: 0.5 });
    // 每題新題平均要答 1 + 0.5×2 = 2 次 → 第 0 天 5 題新題、重學 5 次；第 1 天複習 2.5 次，剩 7.5 次給新題（3.75 題）
    expect(round(rows)).toEqual([
      { review: 5, fresh: 5 },
      { review: 6.25, fresh: 3.75 },
    ]);
  });

  it('到期的太多：複習先出、每 2 題複習配 1 題新題，沒輪到的複習留到隔天', () => {
    const many = dueBuckets(Array.from({ length: 40 }, () => card(2, 0)), NOW);
    const [day0, day1] = simulate(many, { days: 2, budget: () => 30, fresh: 100, recall: 1, first: 1 });
    const fix = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(6)]));
    // 30 題裡複習占 2/3 = 20 題，新題 10 題；沒輪到的 20 題留到隔天
    expect(fix(day0)).toEqual({ due: 40, review: 20, fresh: 10, carry: 20 });
    expect(fix(day1)).toEqual({ due: 20, review: 20, fresh: 10, carry: 0 });
    // 新題做完了：作答量全部給複習
    const [only] = simulate(many, { days: 1, budget: () => 30, fresh: 0, recall: 1, first: 1 });
    expect(only).toEqual({ due: 40, review: 30, fresh: 0, carry: 10 });
  });
});

describe('reviewForecast', () => {
  it('只預報已經練過的題目：新題答錯的不算回來；今天只剩目標減掉已經做的', () => {
    const rows = reviewForecast(dueBuckets([card(2, 1)], NOW), { days: 3, goal: 10, today: 4, fresh: 100, recall: 1, first: 0 });
    expect(rows.map((r) => r.due)).toEqual([0, 1, 0]);
    // 今天剩 6 題、新題每題要答 3 次（第一次加上答錯的重學）
    expect(rows[0].fresh).toBe(2);
    const all = simulate(dueBuckets([card(2, 1)], NOW), { days: 3, budget: () => 10, fresh: 100, recall: 1, first: 0 });
    expect(all[1].due).toBeGreaterThan(1);
  });
});

describe('keepUpGoal', () => {
  it('選項裡最小的、讓到期的複習每天都做得完的每日目標', () => {
    const buckets = dueBuckets(Array.from({ length: 20 }, () => card(2, 1)), NOW);
    // 還有新題時複習最多分到四分之三：明天 20 題到期，目標要 27 題以上，選項裡是 30
    expect(keepUpGoal(buckets, { days: 14, goals: GOALS, fresh: 1000, recall: 1, first: 1 })).toBe(30);
    expect(keepUpGoal(buckets, { days: 14, goals: GOALS, fresh: 0, recall: 1, first: 1 })).toBe(20);
    expect(keepUpGoal(dueBuckets(Array.from({ length: 500 }, () => card(2, 1)), NOW), { days: 14, goals: GOALS, fresh: 1000, recall: 1, first: 1 })).toBeNull();
  });
});

describe('studyPlan', () => {
  const base = { buckets: new Map(), goals: GOALS, recall: 1, first: 1 };

  it('沒有複習負擔時：剩下的新題平均分到每一天', () => {
    const p = studyPlan({ ...base, total: 1000, fresh: 800, daysLeft: 40, pace: 30 });
    expect(p).toMatchObject({ remaining: 800, projected: 800, coverage: 0.2, projectedCoverage: 1, needDaily: 20, needReview: 0, suggest: 20 });
    expect(studyPlan({ ...base, total: 1000, fresh: 800, daysLeft: 40, pace: 10 }).projected).toBe(400);
  });

  it('新題常答錯時要複習的變多，每天要做的題數也跟著變多', () => {
    const easy = studyPlan({ ...base, total: 1000, fresh: 800, daysLeft: 40, pace: 30 });
    const hard = studyPlan({ ...base, total: 1000, fresh: 800, daysLeft: 40, pace: 30, recall: 0.7, first: 0.4 });
    expect(hard.needDaily).toBeGreaterThan(easy.needDaily * 2);
    expect(hard.needReview).toBeGreaterThan(0);
    expect(hard.projected).toBeLessThan(easy.projected);
  });

  it('已經排在後面的複習也算進去', () => {
    const backlog = dueBuckets(Array.from({ length: 200 }, (_, i) => card(2, i % 5)), NOW);
    const p = studyPlan({ ...base, buckets: backlog, total: 1000, fresh: 800, daysLeft: 40, pace: 30 });
    expect(p.needDaily).toBeGreaterThan(20);
  });

  it('做不完時沒有建議目標；已經全部做過就不用加量', () => {
    expect(studyPlan({ ...base, total: 1e6, fresh: 1e6, daysLeft: 1, pace: 30 })).toMatchObject({ needDaily: null, suggest: null });
    expect(studyPlan({ ...base, total: 500, fresh: 500, daysLeft: 1, pace: 0 })).toMatchObject({ projected: 0, needDaily: 500, suggest: null });
    expect(studyPlan({ ...base, total: 500, fresh: 0, daysLeft: 10, pace: 30 })).toMatchObject({ remaining: 0, needDaily: 0, suggest: 10 });
  });
});

describe('planVerdict', () => {
  const base = { buckets: new Map(), goals: GOALS, recall: 1, first: 1 };
  const plan = (total, fresh, daysLeft) => studyPlan({ ...base, total, fresh, daysLeft, pace: 30 });

  it('沒選範圍、全部練過', () => {
    expect(planVerdict(plan(0, 0, 40), { total: 0, goal: 30 })).toBe('empty');
    expect(planVerdict(plan(500, 0, 40), { total: 500, goal: 30 })).toBe('done');
  });

  it('每天要做的題數不超過每日目標的 3 倍：說得出每天做幾題就練得完一輪', () => {
    // 800 題分 40 天：每天 20 題
    expect(planVerdict(plan(1000, 800, 40), { total: 1000, goal: 30 })).toBe('reachable');
    // 剛好 3 倍還算練得完：3,600 題分 40 天是每天 90 題
    const edge = plan(3600, 3600, 40);
    expect(edge.needDaily).toBe(30 * PLAN_STRETCH);
    expect(planVerdict(edge, { total: 3600, goal: 30 })).toBe('reachable');
    // 同一份規劃，每日目標比較小就練不完
    expect(planVerdict(edge, { total: 3600, goal: 20 })).toBe('beyond');
  });

  it('範圍很大（三萬多題、剩 70 天）：每天要做幾百題以上，算練不完一輪；根本排不完（needDaily 是 null）也是', () => {
    const huge = plan(33_490, 33_480, 70);
    expect(huge.needDaily).toBeGreaterThan(30 * PLAN_STRETCH);
    expect(planVerdict(huge, { total: 33_490, goal: 30 })).toBe('beyond');
    expect(planVerdict(huge, { total: 33_490, goal: 120 })).toBe('beyond');
    expect(planVerdict({ remaining: 1e6, needDaily: null }, { total: 1e6, goal: 120 })).toBe('beyond');
  });
});

describe('estimateRates', () => {
  it('練得太少用預設值；比例有上下限', () => {
    expect(estimateRates([], null)).toEqual({ recall: 0.75, first: 0.6 });
    const never = schedule(undefined, 'right', NOW);
    const missed = schedule(undefined, 'wrong', NOW);
    const cards = [...Array(40).fill(never), ...Array(10).fill(missed)];
    expect(estimateRates(cards, 0.9)).toEqual({ recall: 0.9, first: 0.8 });
    expect(estimateRates(Array(50).fill(never), 1)).toEqual({ recall: 0.97, first: 0.95 });
  });
});
