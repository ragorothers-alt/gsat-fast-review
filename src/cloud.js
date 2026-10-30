// 線上同步：多台裝置輸入同一組同步碼，作答紀錄透過雲端（worker/）自動合併。
// 這裡是資料邏輯與網路請求，不碰 DOM；畫面和同步時機在 ui/cloud.js。
//
// state.cloud：
//   code      同步碼；停止同步後為 null（lastCode 記住上一組，重新加入同一組時沿用這台的裝置代號）
//   device    這台裝置的代號
//   cursor    已經拉到雲端的哪個版本（rev）
//   pushedAt  上次成功上傳時的本機時間：作答時間比它晚的題目下次要上傳
//   syncedAt  上次同步成功的時間（顯示用）
//   legacy    開始同步前的每日作答量：各台取較大值（跟匯入備份檔的規則一樣）
//   devices   開始同步後，每台裝置各自的每日作答量：各台相加
import { MARKS, applyMark, mergeCard, mergeStreak } from './sync.js';
import { dayKey, pruneDaily } from './stats.js';

/** 部署好的 Worker；開發時可用 VITE_SYNC_API 指到本機的 wrangler dev */
export const SYNC_API = import.meta.env?.VITE_SYNC_API || 'https://gsat-sync.ragorothers.workers.dev';
/** 一次請求最多上傳幾題（第一次同步可能有上千題，分批送） */
export const CHUNK = 1500;

export class CloudError extends Error {
  /** @param {number} status HTTP 狀態碼；0 = 連不上 */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** 「ab12 cd34…」→「AB12-CD34-…」；不是 16 碼的同步碼回傳 null。O/I/L 容易跟 0/1 看錯，一律當成數字 */
export function normalizeCode(text) {
  const s = String(text ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s.match(/.{4}/g).join('-') : null;
}

function newDeviceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

const copyDays = (daily) => Object.fromEntries(Object.entries(daily).map(([k, d]) => [k, { answered: d.answered, right: d.right }]));

/** 開始同步（剛建立同步碼或加入別台的）。重新加入同一組時沿用原本的裝置代號，作答量才不會重複計算 */
export function startCloud(state, code) {
  const prev = state.cloud;
  if (prev && prev.lastCode === code) {
    Object.assign(prev, { code, cursor: 0, pushedAt: 0, legacyDirty: true });
    return;
  }
  state.cloud = {
    code,
    device: newDeviceId(),
    cursor: 0,
    pushedAt: 0,
    syncedAt: 0,
    legacy: copyDays(state.daily),
    legacyDirty: true,
    devices: {},
  };
}

/** 這台停止同步；本機進度和雲端資料都保留 */
export function stopCloud(state) {
  if (state.cloud?.code) Object.assign(state.cloud, { lastCode: state.cloud.code, code: null });
}

export const cloudOn = (state) => !!state.cloud?.code;

/** 匯入備份檔時帶進來的每日紀錄：當成舊紀錄（取較大值）再重算總量 */
export function foldLegacy(state, daily, now) {
  const c = state.cloud;
  if (!c) return;
  for (const [k, d] of Object.entries(daily ?? {})) {
    const mine = c.legacy[k] ?? { answered: 0, right: 0 };
    c.legacy[k] = { answered: Math.max(mine.answered, d?.answered || 0), right: Math.max(mine.right, d?.right || 0) };
  }
  c.legacyDirty = true;
  rebuildDaily(state, now);
}

const pack = (c) => [c.box, c.due, c.seen, c.right, c.wrong, c.parked ? 1 : 0, c.last];
const unpack = ([box, due, seen, right, wrong, parked, last]) => ({ box, due, seen, right, wrong, parked: !!parked, last });

/** 要上傳的變動：上次上傳之後作答過的題目、這台這幾天的作答量、回報與收藏；第一次則全部上傳 */
export function buildPush(state) {
  const c = state.cloud;
  const since = c.pushedAt;
  const cards = Object.entries(state.cards)
    .filter(([, x]) => !since || x.last > since)
    .map(([id, x]) => [id, pack(x)]);
  const fromDay = since ? dayKey(since) : '';
  const daily = Object.entries(c.devices[c.device] ?? {})
    .filter(([day]) => day >= fromDay)
    .map(([day, d]) => [c.device, day, d.answered, d.right]);
  if (c.legacyDirty) for (const [day, d] of Object.entries(c.legacy)) daily.push(['', day, d.answered, d.right]);
  const marks = {};
  for (const kind of MARKS) {
    const out = (marks[kind] = {});
    for (const [id, at] of Object.entries(state[kind] ?? {})) if (at > since) out[id] = [at, 1];
    for (const [id, at] of Object.entries(state[`${kind}Off`] ?? {})) if (at > since) out[id] = [at, 0];
  }
  return { cards, daily, ...marks, best: state.best.blitz };
}

/** 套用雲端拉回來的變動，回傳本機有幾題的紀錄因此改變 */
export function applyPull(state, res, now) {
  const c = state.cloud;
  let changed = 0;
  for (const [id, arr] of Object.entries(res.cards ?? {})) {
    const before = state.cards[id];
    const after = mergeCard(before, unpack(arr));
    if (!before || after.last !== before.last || after.seen !== before.seen || after.right !== before.right || after.wrong !== before.wrong) changed++;
    state.cards[id] = after;
  }
  for (const [device, day, answered, right] of res.daily ?? []) {
    const map = device ? (c.devices[device] ||= {}) : c.legacy;
    const d = map[day] ?? { answered: 0, right: 0 };
    map[day] = { answered: Math.max(d.answered, answered), right: Math.max(d.right, right) };
  }
  for (const kind of MARKS) {
    const on = (state[kind] ||= {});
    const off = (state[`${kind}Off`] ||= {});
    for (const [id, [at, flag]] of Object.entries(res[kind] ?? {})) if (applyMark(on, off, id, at, !!flag)) changed++;
  }
  state.best.blitz = Math.max(state.best.blitz, res.best ?? 0);
  if (Number.isFinite(res.rev)) c.cursor = res.rev;
  rebuildDaily(state, now);
  return changed;
}

/** 每日作答量 = 舊紀錄 + 各台開始同步後的作答量；連續天數跟著重算 */
function rebuildDaily(state, now) {
  const c = state.cloud;
  pruneDaily(state, now);
  const daily = {};
  for (const map of [c.legacy, ...Object.values(c.devices)]) {
    for (const [k, d] of Object.entries(map)) {
      const t = (daily[k] ||= { answered: 0, right: 0 });
      t.answered += d.answered;
      t.right += d.right;
    }
  }
  state.daily = daily;
  const latest = Object.keys(daily).sort().pop() ?? null;
  state.streak = mergeStreak(daily, state.streak, { count: 0, last: latest });
}

/**
 * 送一個請求給同步後端。
 * 用 text/plain 送 JSON：瀏覽器不必先發 CORS 預檢，手機上少一趟來回。
 * @param {typeof fetch} fetchImpl
 */
export function makeRequest(base = SYNC_API, fetchImpl = (...a) => fetch(...a)) {
  return async (path, body, { keepalive = false } = {}) => {
    const text = JSON.stringify(body);
    // keepalive 讓切到背景時的上傳能送完，但內容有 64 KB 上限
    const send = () =>
      fetchImpl(base + path, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text, keepalive: keepalive && text.length < 60_000 });
    let res;
    try {
      res = await send();
    } catch {
      // 閒置後沿用到已被關掉的連線時，POST 不會自動重送；同步可以重複送，隔一秒再試一次
      try {
        await new Promise((r) => setTimeout(r, 1000));
        res = await send();
      } catch {
        throw new CloudError(0, 'offline');
      }
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new CloudError(res.status, data?.error ?? 'bad response');
    return data;
  };
}

/** 建立新的同步碼 */
export async function createCode(request) {
  const { code } = await request('/v1/create', {});
  return normalizeCode(code);
}

/** 確認同步碼存在（不寫入任何東西）；不存在時丟出 status 404 的 CloudError */
export async function checkCode(request, code) {
  await request('/v1/sync', { code, since: Number.MAX_SAFE_INTEGER });
}

/** 刪除這組同步碼在雲端的所有資料 */
export async function deleteCloud(request, code) {
  await request('/v1/delete', { code });
}

/**
 * 同步一次：上傳這台的變動、拉回其他裝置的變動並合併。回傳本機有幾題的紀錄改變。
 * 中途停止同步或換了同步碼就放棄這一輪。
 */
export async function syncCloud(state, request, { now = Date.now, keepalive = false } = {}) {
  const c = state.cloud;
  const snapshot = now();
  const push = buildPush(state);
  const batches = [];
  for (let i = 0; i < push.cards.length || i === 0; i += CHUNK) batches.push(push.cards.slice(i, i + CHUNK));
  let changed = 0;
  for (let i = 0; i < batches.length; i++) {
    const first = i === 0;
    const res = await request(
      '/v1/sync',
      {
        code: c.code,
        device: c.device,
        since: c.cursor,
        cards: Object.fromEntries(batches[i]),
        daily: first ? push.daily : [],
        flags: first ? push.flags : {},
        stars: first ? push.stars : {},
        best: push.best,
      },
      { keepalive },
    );
    if (state.cloud !== c || !c.code) return changed;
    changed += applyPull(state, res, now());
  }
  c.pushedAt = snapshot;
  c.legacyDirty = false;
  c.syncedAt = now();
  return changed;
}
