import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../worker/src/index.js';
import { b64url, encryptPayload, fromB64url, localDay, reminderText, sendReminders, vapidAuth } from '../worker/src/push.js';
import { createD1 } from './helpers/d1.js';

// RFC 8291 附錄 A 的範例數值
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ciphertext: '8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ',
};

/** 測試用的 VAPID 金鑰 */
async function vapidEnv() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { pair, VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_PUBLIC: b64url(raw) };
}

/** 瀏覽器那一端的訂閱金鑰 */
async function browserKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

describe('推播加密（RFC 8291）', () => {
  it('用 RFC 的範例金鑰與 salt，算出和 RFC 一模一樣的訊息', async () => {
    const pub = fromB64url(RFC.asPublic);
    const jwk = { kty: 'EC', crv: 'P-256', d: RFC.asPrivate, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)) };
    const serverKeys = {
      privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
      publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
    };
    const out = await encryptPayload(fromB64url(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: fromB64url(RFC.salt), serverKeys });
    expect(b64url(out.slice(0, 86))).toBe(RFC.header);
    expect(b64url(out.slice(86))).toBe(RFC.ciphertext);
  });
});

describe('VAPID', () => {
  it('JWT 用私鑰簽名、公鑰驗得過，aud 是推播服務的網域', async () => {
    const env = await vapidEnv();
    const header = await vapidAuth(env, 'https://fcm.googleapis.com', Date.UTC(2026, 9, 29));
    const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
    expect(k).toBe(env.VAPID_PUBLIC);
    const [h, c, sig] = jwt.split('.');
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://ragorothers-alt.github.io/gsat-fast-review/' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, env.pair.publicKey, fromB64url(sig), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });
});

describe('每日提醒', () => {
  // 台灣時間 2026/10/29 20:00 = UTC 12:00
  const AT_8PM = Date.UTC(2026, 9, 29, 12, 0, 5);
  const TW = 480;
  let env;
  let keys;
  const post = async (path, body) => {
    const res = await worker.fetch(new Request(`https://sync.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env);
    return { status: res.status, data: await res.json() };
  };
  const endpoint = (n) => `https://fcm.googleapis.com/fcm/send/device-${n}`;

  beforeEach(async () => {
    env = { DB: createD1(), ...(await vapidEnv()) };
    keys = await browserKeys();
  });

  it('只接受推播服務的網址與格式正確的金鑰', async () => {
    expect((await post('/v1/push/subscribe', { endpoint: 'https://evil.example/x', keys, hour: 20, tz: TW })).status).toBe(400);
    expect((await post('/v1/push/subscribe', { endpoint: endpoint(1), keys: { p256dh: 'x', auth: 'y' }, hour: 20, tz: TW })).status).toBe(400);
    expect((await post('/v1/push/subscribe', { endpoint: endpoint(1), keys, hour: 24, tz: TW })).status).toBe(400);
    expect((await post('/v1/push/subscribe', { endpoint: endpoint(1), keys, hour: 20, tz: TW })).data).toEqual({ ok: true });
    expect((await post('/v1/push/progress', { endpoint: endpoint(9), tz: TW, progress: { day: '2026-10-29', answered: 1, goal: 30 } })).status).toBe(404);
  });

  it('整點對上提醒時刻、今天還沒達標才送，一天只送一次；失效的訂閱會刪掉', async () => {
    const day = '2026-10-29';
    await post('/v1/push/subscribe', { endpoint: endpoint(1), keys, hour: 20, tz: TW, progress: { day, answered: 12, goal: 30, streak: 3 } });
    await post('/v1/push/subscribe', { endpoint: endpoint(2), keys, hour: 20, tz: TW, progress: { day, answered: 30, goal: 30, streak: 4 } });
    await post('/v1/push/subscribe', { endpoint: endpoint(3), keys, hour: 21, tz: TW });
    await post('/v1/push/subscribe', { endpoint: endpoint(4), keys, hour: 20, tz: TW });

    const sentTo = [];
    const fetchImpl = async (url, init) => {
      sentTo.push(url);
      expect(init.headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '14400' });
      expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=/);
      // 86 位元組標頭 + 內容 + 1 位元組分隔 + 16 位元組驗證碼
      expect(init.body.length).toBeGreaterThan(86 + 17);
      return new Response(null, { status: url.endsWith('-4') ? 410 : 201 });
    };
    // 1 號練了 12 題還沒達標 → 送；2 號已達標、3 號是 21 點、4 號已經解除訂閱（410）→ 刪掉
    expect(await sendReminders(env, AT_8PM, fetchImpl)).toEqual({ sent: 1, gone: 1, failed: 0 });
    expect(sentTo.sort()).toEqual([endpoint(1), endpoint(4)]);
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM push_subs').get().n).toBe(3);

    // 同一個小時重跑不會重送；隔天同一時間再送
    sentTo.length = 0;
    expect(await sendReminders(env, AT_8PM + 60_000, fetchImpl)).toMatchObject({ sent: 0 });
    expect(await sendReminders(env, AT_8PM + 86_400_000, fetchImpl)).toMatchObject({ sent: 2 });
    expect(sentTo.sort()).toEqual([endpoint(1), endpoint(2)]);
  });

  it('回報達標後當天就不再提醒', async () => {
    await post('/v1/push/subscribe', { endpoint: endpoint(1), keys, hour: 20, tz: TW, progress: { day: '2026-10-29', answered: 5, goal: 30 } });
    expect((await post('/v1/push/progress', { endpoint: endpoint(1), tz: TW, progress: { day: '2026-10-29', answered: 31, goal: 30, streak: 6 } })).data).toEqual({ ok: true });
    expect(await sendReminders(env, AT_8PM, async () => new Response(null, { status: 201 }))).toMatchObject({ sent: 0 });
  });

  it('通知文字：今天練了幾題、昨天有練就提連續天數、太久沒練就單純提醒', () => {
    const base = { tz: TW, goal: 30 };
    expect(localDay(AT_8PM, TW)).toBe('2026-10-29');
    expect(localDay(Date.UTC(2026, 9, 29, 16, 30), TW)).toBe('2026-10-30');
    expect(reminderText({ ...base, day: '2026-10-29', answered: 12, streak: 3 }, AT_8PM).body).toContain('再 18 題');
    expect(reminderText({ ...base, day: '2026-10-28', answered: 40, streak: 3 }, AT_8PM).title).toBe('連續 3 天了');
    expect(reminderText({ ...base, day: '2026-10-20', answered: 40, streak: 3 }, AT_8PM).title).toBe('今天還沒練習');
  });
});
