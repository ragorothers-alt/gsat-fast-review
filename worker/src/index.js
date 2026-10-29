// 學測快問快答的線上同步後端：Cloudflare Worker + D1。
// 同步碼就是鑰匙（不用帳號）：資料庫只存它的 SHA-256。
// 合併規則與前端 src/sync.js 相同：作答排程以較晚作答的為準、次數取較大值；回報以較晚的動作為準；
// 每日作答量每台裝置各記一份（相加），開始同步前的舊紀錄取較大值。

/** 同步碼字元：Crockford Base32（去掉 I、L、O、U），16 碼 = 80 bits */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 要和 src/subjects.js 的科目一致（tests/cloud.test.js 會檢查） */
export const SUBJECT_IDS = ['chinese', 'english', 'math', 'physics', 'chemistry', 'biology', 'earth', 'history', 'geography', 'civics'];

const CARD_ID = new RegExp(`^(${SUBJECT_IDS.join('|')})-\\d{3,5}$`);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE = /^[a-z0-9]{6,16}$/;
const MAX_BODY = 1_000_000;
const MAX_CARDS = 2000;
const MAX_DAILY = 1000;
const MAX_FLAGS = 2000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/') return new Response('gsat-sync ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'not found' }, 404);
    try {
      await limit(env, req, pathname);
      const text = await req.text();
      if (text.length > MAX_BODY) throw new HttpError(413, 'too large');
      let body;
      try {
        body = JSON.parse(text || '{}');
      } catch {
        throw new HttpError(400, 'bad json');
      }
      if (!body || typeof body !== 'object') throw new HttpError(400, 'bad request');
      if (pathname === '/v1/create') return json(await create(env.DB));
      if (pathname === '/v1/sync') return await sync(env.DB, body);
      if (pathname === '/v1/delete') return json(await remove(env.DB, body));
      throw new HttpError(404, 'not found');
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      throw e;
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

/** 每個 IP 每分鐘的請求上限（Cloudflare Rate Limiting binding；本機測試沒有就略過） */
async function limit(env, req, pathname) {
  const limiter = pathname === '/v1/create' ? env.CREATE_LIMIT : env.SYNC_LIMIT;
  if (!limiter) return;
  const { success } = await limiter.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
  if (!success) throw new HttpError(429, 'too many requests');
}

/** 「ab12-CD34…」→「AB12CD34…」；格式不對回傳 null。O/I/L 容易跟 0/1 看錯，一律當成數字 */
export function normalizeCode(code) {
  const s = String(code ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s : null;
}

async function hashCode(code) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function spaceId(db, code) {
  const normal = normalizeCode(code);
  if (!normal) throw new HttpError(404, 'unknown code');
  const sid = await db.prepare('SELECT sid FROM spaces WHERE hash = ?1').bind(await hashCode(normal)).first('sid');
  if (sid == null) throw new HttpError(404, 'unknown code');
  return sid;
}

async function create(db) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // 256 是 32 的倍數，取餘數不會偏向某些字元
  const code = [...bytes].map((b) => ALPHABET[b % 32]).join('');
  const now = Date.now();
  await db
    .prepare('INSERT INTO spaces (hash, rev, best, created_at, updated_at) VALUES (?1, 0, 0, ?2, ?2)')
    .bind(await hashCode(code), now)
    .run();
  return { code: code.match(/.{4}/g).join('-') };
}

async function remove(db, body) {
  const sid = await spaceId(db, body.code);
  await db.batch(['cards', 'daily', 'flags', 'spaces'].map((t) => db.prepare(`DELETE FROM ${t} WHERE sid = ?1`).bind(sid)));
  return { ok: true };
}

// 寫入的列標上「下一個版本」；有列真的被改到，才把 space 的版本推進（沒變動的同步不會寫資料庫）
const REV = '(SELECT rev + 1 FROM spaces WHERE sid = ?1)';
const BUMP = `
UPDATE spaces SET rev = rev + 1, updated_at = ?2
WHERE sid = ?1 AND (
  EXISTS (SELECT 1 FROM cards WHERE sid = ?1 AND rev > spaces.rev) OR
  EXISTS (SELECT 1 FROM daily WHERE sid = ?1 AND rev > spaces.rev) OR
  EXISTS (SELECT 1 FROM flags WHERE sid = ?1 AND rev > spaces.rev))`;

const UPSERT_CARDS = `
INSERT INTO cards (sid, id, box, due, seen, rights, wrongs, parked, last, rev)
SELECT ?1, j.key, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'),
       json_extract(j.value, '$[3]'), json_extract(j.value, '$[4]'), json_extract(j.value, '$[5]'), json_extract(j.value, '$[6]'), ${REV}
FROM json_each(?2) AS j WHERE true
ON CONFLICT (sid, id) DO UPDATE SET
  box = CASE WHEN excluded.last > cards.last THEN excluded.box ELSE cards.box END,
  due = CASE WHEN excluded.last > cards.last THEN excluded.due ELSE cards.due END,
  parked = CASE WHEN excluded.last > cards.last THEN excluded.parked ELSE cards.parked END,
  last = max(cards.last, excluded.last),
  seen = max(cards.seen, excluded.seen),
  rights = max(cards.rights, excluded.rights),
  wrongs = max(cards.wrongs, excluded.wrongs),
  rev = excluded.rev
WHERE excluded.last > cards.last OR excluded.seen > cards.seen OR excluded.rights > cards.rights OR excluded.wrongs > cards.wrongs`;

const UPSERT_DAILY = `
INSERT INTO daily (sid, device, day, answered, rights, rev)
SELECT ?1, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]'), json_extract(j.value, '$[3]'), ${REV}
FROM json_each(?2) AS j WHERE true
ON CONFLICT (sid, device, day) DO UPDATE SET
  answered = max(daily.answered, excluded.answered),
  rights = max(daily.rights, excluded.rights),
  rev = excluded.rev
WHERE excluded.answered > daily.answered OR excluded.rights > daily.rights`;

const UPSERT_FLAGS = `
INSERT INTO flags (sid, id, at, flagged, rev)
SELECT ?1, j.key, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), ${REV}
FROM json_each(?2) AS j WHERE true
ON CONFLICT (sid, id) DO UPDATE SET at = excluded.at, flagged = excluded.flagged, rev = excluded.rev
WHERE excluded.at > flags.at`;

// 回傳的 JSON 直接由 SQLite 組好，Worker 不必逐列處理（免費方案每次請求只有 10 ms CPU）
const PULL = `
SELECT rev, best,
  (SELECT json_group_object(id, json_array(box, due, seen, rights, wrongs, parked, last)) FROM cards WHERE sid = ?1 AND rev > ?2) AS cards,
  (SELECT json_group_array(json_array(device, day, answered, rights)) FROM daily WHERE sid = ?1 AND rev > ?2) AS daily,
  (SELECT json_group_object(id, json_array(at, flagged)) FROM flags WHERE sid = ?1 AND rev > ?2) AS flags
FROM spaces WHERE sid = ?1`;

/**
 * 一次同步：寫入這台的變動，回傳 rev 比 since 新的所有列。
 * 整批在同一個交易裡執行，所以拉回的資料和 rev 一定對得上，不會漏掉同時寫入的另一台。
 */
async function sync(db, body) {
  const sid = await spaceId(db, body.code);
  const since = isInt(body.since) ? body.since : 0;
  const best = isInt(body.best, 1e6) ? body.best : 0;
  const cards = cleanCards(body.cards);
  const daily = cleanDaily(body.daily);
  const flags = cleanFlags(body.flags);
  const writes = [];
  if (Object.keys(cards).length) writes.push(db.prepare(UPSERT_CARDS).bind(sid, JSON.stringify(cards)));
  if (daily.length) writes.push(db.prepare(UPSERT_DAILY).bind(sid, JSON.stringify(daily)));
  if (Object.keys(flags).length) writes.push(db.prepare(UPSERT_FLAGS).bind(sid, JSON.stringify(flags)));

  const stmts = [...writes];
  if (writes.length) stmts.push(db.prepare(BUMP).bind(sid, Date.now()));
  if (best) stmts.push(db.prepare('UPDATE spaces SET best = ?2 WHERE sid = ?1 AND best < ?2').bind(sid, best));
  stmts.push(db.prepare(PULL).bind(sid, since));
  const results = await db.batch(stmts);
  const row = results.at(-1).results[0];
  const text = `{"rev":${row.rev},"best":${row.best},"cards":${row.cards},"daily":${row.daily},"flags":${row.flags}}`;
  return new Response(text, { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const isInt = (x, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const isObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/** { id: [box, due, seen, right, wrong, parked, last] }；格式不對的列直接略過 */
function cleanCards(input) {
  const out = {};
  if (!isObject(input)) return out;
  const entries = Object.entries(input);
  if (entries.length > MAX_CARDS) throw new HttpError(413, 'too many cards');
  for (const [id, v] of entries) {
    if (!CARD_ID.test(id) || !Array.isArray(v) || v.length !== 7) continue;
    const [box, due, seen, right, wrong, parked, last] = v;
    if (!isInt(box, 10) || !isInt(due) || !isInt(seen, 1e6) || !isInt(right, 1e6) || !isInt(wrong, 1e6)) continue;
    if ((parked !== 0 && parked !== 1) || !isInt(last)) continue;
    out[id] = [box, due, seen, right, wrong, parked, last];
  }
  return out;
}

/** [[device, day, answered, right]]；device 空字串 = 開始同步前的舊紀錄 */
function cleanDaily(input) {
  if (!Array.isArray(input)) return [];
  if (input.length > MAX_DAILY) throw new HttpError(413, 'too many days');
  return input.filter(
    (v) =>
      Array.isArray(v) &&
      v.length === 4 &&
      (v[0] === '' || DEVICE.test(v[0])) &&
      DAY.test(v[1]) &&
      isInt(v[2], 1e5) &&
      isInt(v[3], 1e5) &&
      v[3] <= v[2],
  );
}

/** { id: [at, flagged] } */
function cleanFlags(input) {
  const out = {};
  if (!isObject(input)) return out;
  const entries = Object.entries(input);
  if (entries.length > MAX_FLAGS) throw new HttpError(413, 'too many flags');
  for (const [id, v] of entries) {
    if (CARD_ID.test(id) && Array.isArray(v) && v.length === 2 && isInt(v[0]) && (v[1] === 0 || v[1] === 1)) out[id] = v;
  }
  return out;
}
