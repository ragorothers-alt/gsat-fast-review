import { describe, expect, it } from 'vitest';
import worker, { logError, reportQuestion as reportToServer } from '../worker/src/index.js';
import { errorEntry, firstFrame } from '../src/errors.js';
import { reportQuestion, setQuestionReporting } from '../src/report.js';
import { speechText } from '../src/ui/speech.js';
import { createD1 } from './helpers/d1.js';

const mc = (q, choices, answer) => ({ subject: 'english', type: 'mc', q, choices, answer });

describe('英文發音的句子', () => {
  it('作答前空格念成停頓，作答後填入正解', () => {
    const q = mc('I look forward to ____ from you soon.', ['heard', 'hearing', 'hear', 'be heard'], 1);
    expect(speechText(q)).toBe('I look forward to … from you soon.');
    expect(speechText(q, { filled: true })).toBe('I look forward to hearing from you soon.');
  });

  it('對話題不念 A:、B:', () => {
    const q = mc('A: Could you help me carry this box? B: ____', ['Sure. Let me help you.', 'Congratulations!', 'No.', 'Bye.'], 0);
    expect(speechText(q, { filled: true })).toBe('Could you help me carry this box? Sure. Let me help you.');
  });

  it('兩個空格時不硬填，維持停頓；是非題照念', () => {
    const q = mc('Neither Tom ____ Amy ____ here.', ['nor / is', 'or / are', 'and / is', 'but / are'], 0);
    expect(speechText(q, { filled: true })).toBe('Neither Tom … Amy … here.');
    expect(speechText({ subject: 'english', type: 'tf', q: "'Children' is the plural form of 'child'.", answer: true }, { filled: true })).toBe(
      "'Children' is the plural form of 'child'.",
    );
  });
});

describe('錯誤紀錄', () => {
  it('堆疊只留第一個呼叫位置，去掉網址', () => {
    const stack = 'TypeError: x is undefined\n    at render (https://ragorothers-alt.github.io/gsat-fast-review/assets/index-abc123.js:12:345)\n    at main';
    expect(firstFrame(stack)).toBe('render (index-abc123.js:12:345)');
    expect(firstFrame('')).toBe('');
  });

  it('擴充功能、跨網域腳本與 ResizeObserver 的雜訊不記', () => {
    expect(errorEntry('Script error.', '', 1)).toBeNull();
    expect(errorEntry('ResizeObserver loop completed with undelivered notifications.', '', 1)).toBeNull();
    expect(errorEntry('boom', 'at x (chrome-extension://abc/content.js:1:2)', 1)).toBeNull();
    expect(errorEntry('  ', '', 1)).toBeNull();
    expect(errorEntry('boom', 'at f (https://a.b/assets/x.js:1:2)', 7)).toEqual({ at: 7, message: 'boom', source: 'f (x.js:1:2)' });
  });
});

describe('同步後端收錯誤回報', () => {
  const post = (env, body) => worker.fetch(new Request('https://sync.test/v1/log', { method: 'POST', body: JSON.stringify(body) }), env);

  it('同一版本、訊息、位置累計次數；缺欄位回 400', async () => {
    const env = { DB: createD1() };
    const body = { version: 'abc1234', message: 'x is undefined', source: 'render (index.js:1:2)', ua: 'Mozilla/5.0' };
    expect((await post(env, body)).status).toBe(200);
    expect((await post(env, body)).status).toBe(200);
    expect((await post(env, { ...body, source: 'other (index.js:3:4)' })).status).toBe(200);
    expect((await post(env, { message: 'no version' })).status).toBe(400);
    const rows = await env.DB.prepare('SELECT source, count FROM errors ORDER BY source').all();
    expect(rows.results).toEqual([
      { source: 'other (index.js:3:4)', count: 1 },
      { source: 'render (index.js:1:2)', count: 2 },
    ]);
  });

  it('過長的欄位會截斷；版本號不是 commit 格式就不收', async () => {
    const env = { DB: createD1() };
    expect((await post(env, { version: 'v'.repeat(50), message: 'x' })).status).toBe(400);
    await post(env, { version: 'abc1234', message: 'm'.repeat(1000), source: '', ua: 'u'.repeat(1000) });
    const row = await env.DB.prepare('SELECT version, message, ua FROM errors').first();
    expect([row.version, row.message.length, row.ua.length]).toEqual(['abc1234', 300, 200]);
  });

  it('最多留 500 列，同一毫秒寫進來的也照樣截斷', async () => {
    const env = { DB: createD1() };
    for (let i = 0; i < 505; i++) await logError(env.DB, { version: 'abc1234', message: `e${i}` }, 1000);
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM errors').get().n).toBe(500);
  });
});

describe('回報題目', () => {
  const post = (env, body) => worker.fetch(new Request('https://sync.test/v1/report', { method: 'POST', body: JSON.stringify(body) }), env);

  it('後端照題號累計次數，記下最近一次回報的版本；題號或版本格式不對回 400', async () => {
    const env = { DB: createD1() };
    expect((await post(env, { id: 'math-0123', version: 'abc1234' })).status).toBe(200);
    expect((await post(env, { id: 'math-0123', version: 'def5678' })).status).toBe(200);
    expect((await post(env, { id: 'earth-001', version: 'dev' })).status).toBe(200);
    for (const bad of [{ id: 'math-1', version: 'abc1234' }, { id: 'nope-001', version: 'abc1234' }, { id: 'math-0123' }, { id: 123, version: 'abc1234' }, {}]) {
      expect((await post(env, bad)).status).toBe(400);
    }
    const rows = await env.DB.prepare('SELECT id, count, version FROM reports ORDER BY count DESC').all();
    expect(rows.results).toEqual([
      { id: 'math-0123', count: 2, version: 'def5678' },
      { id: 'earth-001', count: 1, version: 'dev' },
    ]);
  });

  it('最多留 3000 題：留最近被回報的', async () => {
    const env = { DB: createD1() };
    for (let i = 0; i < 3005; i++) await reportToServer(env.DB, { id: `math-${String(i + 1).padStart(4, '0')}`, version: 'abc1234' }, 1000 + i);
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM reports').get().n).toBe(3000);
    expect(env.DB.raw.prepare("SELECT count(*) AS n FROM reports WHERE id = 'math-0001'").get().n).toBe(0);
    expect(env.DB.raw.prepare("SELECT count(*) AS n FROM reports WHERE id = 'math-3005'").get().n).toBe(1);
  });

  it('前端：正式版才送，同一題開一次 App 只送一次；設定關掉就不送', () => {
    const calls = [];
    const send = (url, init) => {
      calls.push([url, JSON.parse(init.body)]);
      return Promise.reject(new Error('offline'));
    };
    expect(reportQuestion('math-0001', { send, prod: false })).toBe(false);
    expect(reportQuestion('math-0001', { send, prod: true })).toBe(true);
    expect(reportQuestion('math-0001', { send, prod: true })).toBe(false);
    setQuestionReporting(false);
    expect(reportQuestion('math-0002', { send, prod: true })).toBe(false);
    setQuestionReporting(true);
    expect(reportQuestion('math-0002', { send, prod: true })).toBe(true);
    expect(calls.map(([url, body]) => [url.replace(/^.*\/v1/, '/v1'), body.id, typeof body.version])).toEqual([
      ['/v1/report', 'math-0001', 'string'],
      ['/v1/report', 'math-0002', 'string'],
    ]);
  });
});
