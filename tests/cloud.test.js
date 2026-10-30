import { beforeEach, describe, expect, it } from 'vitest';
import worker, { SUBJECT_IDS } from '../worker/src/index.js';
import { CHUNK, CloudError, createCode, deleteCloud, makeRequest, normalizeCode, startCloud, stopCloud, syncCloud } from '../src/cloud.js';
import { schedule } from '../src/srs.js';
import { dayKey, recordAnswer } from '../src/stats.js';
import { freshState } from '../src/storage.js';
import { SUBJECTS } from '../src/subjects.js';
import { setFlag, setStar } from '../src/sync.js';
import { statusText } from '../src/ui/cloud.js';
import { createD1 } from './helpers/d1.js';

const T0 = new Date(2026, 9, 28, 10, 0).getTime();
const TODAY = dayKey(T0);

let env;
let calls;
let request;
let clock;
const now = () => clock;

beforeEach(() => {
  env = { DB: createD1() };
  calls = 0;
  request = makeRequest('https://sync.test', async (url, init) => {
    calls++;
    return worker.fetch(new Request(url, init), env);
  });
  clock = T0;
});

/** 模擬作答：跟 ui/play.js 一樣更新排程與每日作答量 */
function answer(state, id, outcome) {
  clock += 1000;
  state.cards[id] = schedule(state.cards[id], outcome, clock);
  recordAnswer(state, outcome, clock);
}

const sync = (state) => syncCloud(state, request, { now });
const rev = () => env.DB.raw.prepare('SELECT rev FROM spaces').get().rev;

/** A 建立同步碼、B 加入 */
async function pair(a = freshState(), b = freshState()) {
  const code = await createCode(request);
  startCloud(a, code);
  await sync(a);
  startCloud(b, code);
  await sync(b);
  return { a, b, code };
}

describe('同步碼', () => {
  it('容忍小寫、空白，O/I/L 當成數字；長度或字元不對就是 null', () => {
    expect(normalizeCode('ab12 cd34-efgh-jkmn')).toBe('AB12-CD34-EFGH-JKMN');
    expect(normalizeCode('oooo-iiii-llll-0000')).toBe('0000-1111-1111-0000');
    expect(normalizeCode('AB12-CD34-EFGH')).toBeNull();
    expect(normalizeCode('AB12-CD34-EFGH-JKMU')).toBeNull();
  });

  it('後端建立的同步碼格式正確，科目清單和前端一致', async () => {
    const code = await createCode(request);
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    expect(SUBJECT_IDS).toEqual(SUBJECTS.map((s) => s.id));
  });

  it('不存在的同步碼回傳 404；刪除雲端資料後其他裝置也會收到 404', async () => {
    await expect(request('/v1/sync', { code: 'AAAA-BBBB-CCCC-DDDD' })).rejects.toMatchObject({ status: 404 });
    const { b, code } = await pair();
    await deleteCloud(request, code);
    const err = await sync(b).catch((e) => e);
    expect(err).toBeInstanceOf(CloudError);
    expect(err.status).toBe(404);
  });
});

describe('合併', () => {
  it('B 加入後兩台的作答紀錄合併；開始同步前的每日作答量取較大值', async () => {
    const a = freshState();
    answer(a, 'math-001', 'right');
    answer(a, 'chinese-002', 'wrong');
    const b = freshState();
    answer(b, 'english-003', 'right');
    await pair(a, b);
    expect(Object.keys(b.cards).sort()).toEqual(['chinese-002', 'english-003', 'math-001']);
    expect(b.daily[TODAY]).toEqual({ answered: 2, right: 1 });
    await sync(a);
    expect(a.cards['english-003']).toEqual(b.cards['english-003']);
    expect(a.daily[TODAY]).toEqual({ answered: 2, right: 1 });
  });

  it('開始同步後兩台各自作答，每日作答量相加，連續天數一致', async () => {
    const { a, b } = await pair();
    for (const id of ['math-001', 'math-002', 'math-003']) answer(a, id, 'right');
    answer(b, 'physics-001', 'right');
    answer(b, 'physics-002', 'wrong');
    await sync(a);
    await sync(b);
    await sync(a);
    expect(a.daily[TODAY]).toEqual({ answered: 5, right: 4 });
    expect(b.daily[TODAY]).toEqual({ answered: 5, right: 4 });
    expect(b.streak).toEqual({ count: 1, last: TODAY });
    expect(Object.keys(a.cards)).toHaveLength(5);
  });

  it('同一題兩台離線各自作答：排程以較晚作答的為準，次數取較大值', async () => {
    const { a, b } = await pair();
    answer(a, 'math-001', 'right');
    await sync(a);
    await sync(b);
    answer(a, 'math-001', 'wrong'); // 較早
    answer(a, 'math-001', 'wrong');
    answer(b, 'math-001', 'right'); // 較晚
    await sync(a);
    await sync(b);
    await sync(a);
    expect(a.cards['math-001']).toEqual(b.cards['math-001']);
    expect(a.cards['math-001']).toMatchObject({ box: 3, wrong: 2, seen: 3, last: clock });
  });

  it('一台取消回報，另一台同步後也取消', async () => {
    const { a, b } = await pair();
    clock += 1000;
    setFlag(a, 'physics-010', true, clock);
    await sync(a);
    await sync(b);
    expect(Object.keys(b.flags)).toEqual(['physics-010']);
    clock += 1000;
    setFlag(b, 'physics-010', false, clock);
    await sync(b);
    await sync(a);
    expect(a.flags).toEqual({});
  });

  it('收藏在兩台之間同步，取消也同步；跟回報互不影響', async () => {
    const { a, b } = await pair();
    clock += 1000;
    setStar(a, 'history-020', true, clock);
    setStar(a, 'math-003', true, clock);
    setFlag(a, 'math-003', true, clock);
    await sync(a);
    await sync(b);
    expect(Object.keys(b.stars).sort()).toEqual(['history-020', 'math-003']);
    clock += 1000;
    setStar(b, 'math-003', false, clock);
    await sync(b);
    await sync(a);
    expect(Object.keys(a.stars)).toEqual(['history-020']);
    expect(Object.keys(a.flags)).toEqual(['math-003']);
  });

  it('快閃最高分取較大值', async () => {
    const { a, b } = await pair();
    a.best.blitz = 42;
    clock += 1000;
    await sync(a);
    await sync(b);
    expect(b.best.blitz).toBe(42);
  });

  it('停止後重新加入同一組同步碼，作答量不會重複計算', async () => {
    const { a, b, code } = await pair();
    answer(a, 'math-001', 'right');
    await sync(a);
    stopCloud(a);
    answer(a, 'math-002', 'right'); // 停止期間也照樣記在這台
    startCloud(a, code);
    await sync(a);
    await sync(b);
    expect(a.daily[TODAY]).toEqual({ answered: 2, right: 2 });
    expect(b.daily[TODAY]).toEqual({ answered: 2, right: 2 });
  });
});

describe('傳輸', () => {
  it('沒有變動時同步不會寫入，也不會回傳變動', async () => {
    const { a } = await pair();
    answer(a, 'math-001', 'right');
    await sync(a);
    const before = rev();
    clock += 60_000;
    expect(await sync(a)).toBe(0);
    expect(rev()).toBe(before);
  });

  it('第一次同步有上千題時分批上傳', async () => {
    const a = freshState();
    for (let i = 1; i <= CHUNK + 10; i++) a.cards[`math-${String(i).padStart(4, '0')}`] = schedule(undefined, 'right', T0 + i);
    const code = await createCode(request);
    startCloud(a, code);
    calls = 0;
    await sync(a);
    expect(calls).toBe(2);
    const b = freshState();
    startCloud(b, code);
    await sync(b);
    expect(Object.keys(b.cards)).toHaveLength(CHUNK + 10);
  });

  it('連線被中斷時自動重送一次；再失敗才算沒有網路', async () => {
    let fails = 1;
    const flaky = makeRequest('https://sync.test', async (url, init) => {
      if (fails-- > 0) throw new TypeError('Failed to fetch');
      return worker.fetch(new Request(url, init), env);
    });
    expect(await createCode(flaky)).toMatch(/^[0-9A-Z-]{19}$/);
    fails = 2;
    await expect(createCode(flaky)).rejects.toMatchObject({ status: 0 });
  });

  it('上次同步時間的顯示', () => {
    const t = new Date(2026, 9, 29, 9, 5).getTime();
    expect(statusText(null, 0, t)).toBe('還沒同步過');
    expect(statusText(null, t - 20_000, t)).toBe('上次同步：剛剛');
    expect(statusText(null, t - 5 * 60_000, t)).toBe('上次同步：5 分鐘前');
    expect(statusText(null, new Date(2026, 9, 29, 7, 3).getTime(), t)).toBe('上次同步：今天 7:03');
    expect(statusText(null, new Date(2026, 9, 27, 21, 40).getTime(), t)).toBe('上次同步：10/27 21:40');
    expect(statusText('offline', t, t)).toBe('目前沒有網路，連上後會自動同步');
  });

  it('後端略過格式不對的資料，太大的請求直接拒絕', async () => {
    const code = await createCode(request);
    const res = await request('/v1/sync', {
      code,
      cards: {
        'math-001': [1, 2, 3, 2, 1, 0, 5],
        'hack-001': [1, 2, 3, 2, 1, 0, 5],
        'math-002': [1, 2, 3, 2, 1, 'x', 5],
        'math-003': [1, 2, 3],
      },
      daily: [['', TODAY, 3, 1], ['BAD DEVICE', TODAY, 1, 1], ['abcdef', 'today', 1, 1]],
      flags: { 'math-001': [9, 1], 'math-002': [9, 2] },
    });
    expect(Object.keys(res.cards)).toEqual(['math-001']);
    expect(res.daily).toEqual([['', TODAY, 3, 1]]);
    expect(Object.keys(res.flags)).toEqual(['math-001']);
    const tooMany = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`math-${i + 1000}`, [0, 0, 1, 0, 1, 0, 1]]));
    await expect(request('/v1/sync', { code, cards: tooMany })).rejects.toMatchObject({ status: 413 });
  });
});
