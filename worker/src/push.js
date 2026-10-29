// 每日提醒：Web Push（RFC 8030）＋ VAPID 驗證（RFC 8292）＋訊息加密（RFC 8291、aes128gcm）。
// 每小時由 Cron 觸發一次：找出「當地時間剛好到提醒時刻、今天還沒達成目標、今天還沒提醒過」的訂閱，送出通知。
// 訂閱不綁同步碼：只存推播服務給的網址與金鑰、提醒時刻、時區，以及 App 回報的今日進度。

/** 只接受各大瀏覽器推播服務的網址，避免被拿來轉送請求到任意網站 */
const PUSH_HOST = /(^|\.)(fcm\.googleapis\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|notify\.windows\.com)$/;
/** VAPID 的聯絡方式：用 App 網址，不放個人信箱 */
const VAPID_SUB = 'https://ragorothers-alt.github.io/gsat-fast-review/';
/** 推播服務最多保留幾秒（手機關機時，開機後 4 小時內還會送到） */
const TTL = 4 * 3600;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export class PushError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ── 編碼小工具 ──────────────────────────────────────
export function b64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const utf8 = (s) => new TextEncoder().encode(s);

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * RFC 8291：用瀏覽器給的 p256dh、auth 加密推播內容，回傳 aes128gcm 格式的訊息本體。
 * salt、serverKeys 只有測試（對照 RFC 的範例數值）才需要指定。
 */
export async function encryptPayload(plaintext, { p256dh, auth }, { salt, serverKeys } = {}) {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  salt ??= crypto.getRandomValues(new Uint8Array(16));
  serverKeys ??= await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdh, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 只有一筆紀錄：內容後面接 0x02（最後一筆的分隔符號），不加填充
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));

  // 標頭：salt(16) + 紀錄大小(4) + 金鑰長度(1) + 伺服器公鑰(65)
  const header = new Uint8Array(86);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

/** RFC 8292：給某個推播服務（aud）的 VAPID 授權標頭 */
export async function vapidAuth(env, aud, now) {
  const head = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(utf8(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: VAPID_SUB })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64url(sig)}, k=${env.VAPID_PUBLIC}`;
}

// ── 訂閱 ───────────────────────────────────────────
function endpointOf(body) {
  const endpoint = String(body.endpoint ?? '');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PushError(400, 'bad endpoint');
  }
  if (url.protocol !== 'https:' || !PUSH_HOST.test(url.hostname) || endpoint.length > 1000) throw new PushError(400, 'bad endpoint');
  return endpoint;
}

const int = (v, lo, hi, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new PushError(400, `bad ${name}`);
  return n;
};

/** App 回報的今日進度（day 是 App 那邊的當地日期） */
function progressOf(body) {
  const p = body.progress ?? {};
  if (p.day != null && !DAY_RE.test(String(p.day))) throw new PushError(400, 'bad day');
  return {
    day: p.day ?? null,
    answered: int(p.answered ?? 0, 0, 100000, 'answered'),
    goal: int(p.goal ?? 30, 1, 1000, 'goal'),
    streak: int(p.streak ?? 0, 0, 100000, 'streak'),
  };
}

export async function subscribe(db, body, now) {
  const endpoint = endpointOf(body);
  const keys = body.keys ?? {};
  if (!/^[\w-]{80,100}$/.test(keys.p256dh ?? '') || !/^[\w-]{16,32}$/.test(keys.auth ?? '')) throw new PushError(400, 'bad keys');
  const hour = int(body.hour, 0, 23, 'hour');
  const tz = int(body.tz, -720, 840, 'tz');
  const p = progressOf(body);
  await db
    .prepare(
      `INSERT INTO push_subs (endpoint, p256dh, auth, hour, tz, day, answered, goal, streak, sent_day, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?10)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, hour = ?4, tz = ?5, day = ?6, answered = ?7, goal = ?8, streak = ?9, updated_at = ?10`,
    )
    .bind(endpoint, keys.p256dh, keys.auth, hour, tz, p.day, p.answered, p.goal, p.streak, now)
    .run();
  return { ok: true };
}

export async function unsubscribe(db, body) {
  await db.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(endpointOf(body)).run();
  return { ok: true };
}

/** 回報今日進度；訂閱不存在（例如已被推播服務註銷）回 404，App 會重新訂閱 */
export async function progress(db, body, now) {
  const endpoint = endpointOf(body);
  const tz = int(body.tz, -720, 840, 'tz');
  const p = progressOf(body);
  const res = await db
    .prepare('UPDATE push_subs SET tz = ?2, day = ?3, answered = ?4, goal = ?5, streak = ?6, updated_at = ?7 WHERE endpoint = ?1')
    .bind(endpoint, tz, p.day, p.answered, p.goal, p.streak, now)
    .run();
  if (!res.meta.changes) throw new PushError(404, 'unknown subscription');
  return { ok: true };
}

// ── 每小時送提醒 ──────────────────────────────────────
/** 某個時區（UTC 偏移分鐘）的當地日期，offsetDays 可往前推 */
export function localDay(now, tz, offsetDays = 0) {
  return new Date(now + tz * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** 通知內容：今天還沒練、練了但還沒達標；昨天有練的話提一下連續天數 */
export function reminderText(sub, now) {
  const today = localDay(now, sub.tz);
  const answered = sub.day === today ? sub.answered : 0;
  const streak = sub.day === today || sub.day === localDay(now, sub.tz, -1) ? sub.streak : 0;
  if (answered > 0) return { title: '再幾題就達標', body: `今天練了 ${answered} 題，再 ${sub.goal - answered} 題就達成每日目標！` };
  if (streak > 0) return { title: `連續 ${streak} 天了`, body: '今天還沒練習，來一輪 60 秒快閃，別讓紀錄斷掉！' };
  return { title: '今天還沒練習', body: '花一分鐘來一輪 60 秒快閃吧！' };
}

/**
 * Cron 每小時呼叫一次。now 往後抓 2 分鐘，觸發時間稍微提早也算在下一個整點。
 * @returns {Promise<{ sent: number, gone: number, failed: number }>}
 */
export async function sendReminders(env, now, fetchImpl = fetch) {
  const db = env.DB;
  const minute = Math.floor((now + 120_000) / 60_000);
  // 當地時間 = UTC + tz 分鐘；整點對上提醒時刻，而且今天還沒提醒過、還沒達標（分鐘數先轉成整數，除法才是整數除法）
  const { results } = await db
    .prepare(
      `WITH t AS (SELECT CAST(?1 AS INTEGER) AS m)
       SELECT endpoint, p256dh, auth, tz, day, answered, goal, streak FROM push_subs, t
       WHERE ((t.m + tz) % 1440 + 1440) % 1440 / 60 = hour
         AND COALESCE(sent_day, '') <> date((t.m + tz) * 60, 'unixepoch')
         AND NOT (COALESCE(day, '') = date((t.m + tz) * 60, 'unixepoch') AND answered >= goal)`,
    )
    .bind(minute)
    .all();

  const auths = new Map();
  const sent = [];
  const gone = [];
  let failed = 0;
  await Promise.all(
    results.map(async (sub) => {
      const aud = new URL(sub.endpoint).origin;
      if (!auths.has(aud)) auths.set(aud, vapidAuth(env, aud, now));
      const body = await encryptPayload(utf8(JSON.stringify(reminderText(sub, now))), sub);
      try {
        const res = await fetchImpl(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await auths.get(aud),
            TTL: String(TTL),
            Urgency: 'normal',
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
          },
          body,
        });
        // 404／410：使用者關掉通知或解除安裝，訂閱已失效
        if (res.status === 404 || res.status === 410) gone.push(sub.endpoint);
        else if (res.ok) sent.push(sub);
        else failed++;
      } catch {
        failed++;
      }
    }),
  );

  const stmts = [
    ...sent.map((s) => db.prepare('UPDATE push_subs SET sent_day = ?2 WHERE endpoint = ?1').bind(s.endpoint, localDay(minute * 60_000, s.tz))),
    ...gone.map((e) => db.prepare('DELETE FROM push_subs WHERE endpoint = ?1').bind(e)),
  ];
  if (stmts.length) await db.batch(stmts);
  return { sent: sent.length, gone: gone.length, failed };
}
