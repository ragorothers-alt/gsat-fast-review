// 線上同步：多台裝置輸入同一組同步碼，作答紀錄、收藏與回報、每日作答量、單元闖關進度、模擬考成績透過雲端（worker/）自動合併。
// 設定、考到一半的模擬考只存在各台。這裡是資料邏輯與網路請求，不碰 DOM；畫面和同步時機在 ui/cloud.js。
//
// state.cloud：
//   code      同步碼；停止同步後為 null（lastCodeHash 記住上一組的雜湊，重新加入同一組時沿用這台的裝置代號）
//   device    這台裝置的代號
//   cursor    已經拉到雲端的哪個版本（rev）
//   pushedAt  上次成功上傳時的本機時間：作答時間比它晚的題目下次要上傳
//   syncedAt  上次同步成功的時間（顯示用）
//   legacy    開始同步前的每日作答量：各台取較大值（跟匯入備份檔的規則一樣）
//   devices   開始同步後，每台裝置各自的每日作答量：各台相加
//   schema    同步的資料到哪一版（見 SCHEMA）；bestSent 上次上傳的快閃最高分
import { everMissed } from './srs.js';
import { CARD_ID, MARKS, applyMark, cleanCard, mergeCard, mergeStreak } from './sync.js';
import { dayKey, pruneDaily } from './stats.js';
import { applyPathRows, pathRows } from './path.js';
import { mergeExams } from './exam.js';

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

/**
 * 同步碼的雜湊（不可逆）：停止同步後只留這個，用來認出「重新加入同一組」；
 * 共用電腦上停止同步之後，裝置上就不會留著能讀寫雲端資料的同步碼
 */
export function codeHash(code) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const ch of String(code)) {
    const c = ch.charCodeAt(0);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 開始同步（剛建立同步碼或加入別台的）。重新加入同一組時沿用原本的裝置代號，作答量才不會重複計算 */
export function startCloud(state, code) {
  const prev = state.cloud;
  // lastCode 是舊版存的明碼
  if (prev && (prev.lastCodeHash === codeHash(code) || prev.lastCode === code)) {
    Object.assign(prev, { code, cursor: 0, pushedAt: 0, legacyDirty: true });
    delete prev.lastCode;
    delete prev.lastCodeHash;
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
  if (!state.cloud?.code) return;
  state.cloud.lastCodeHash = codeHash(state.cloud.code);
  state.cloud.code = null;
  delete state.cloud.lastCode;
}

export const cloudOn = (state) => !!state.cloud?.code;

/**
 * 匯入備份檔之後：
 * - 每日紀錄：備份裡的是總量（可能已經含這台同步後的作答），只把比目前總量多出來的部分補進舊紀錄，
 *   匯回自己剛匯出的備份才不會變成兩倍。
 * - 匯入的作答紀錄時間多半比上次上傳早，照「上次上傳後的變動」挑不到：下次同步改成全部重新上傳（雲端合併是冪等的）。
 */
export function foldLegacy(state, daily, now) {
  const c = state.cloud;
  if (!c) return;
  const synced = {};
  for (const days of Object.values(c.devices)) {
    for (const [k, d] of Object.entries(days)) {
      const t = (synced[k] ||= { answered: 0, right: 0 });
      t.answered += d.answered;
      t.right += d.right;
    }
  }
  for (const [k, d] of Object.entries(daily ?? {})) {
    if (!Number.isSafeInteger(d?.answered) || !Number.isSafeInteger(d?.right)) continue;
    const mine = c.legacy[k] ?? { answered: 0, right: 0 };
    const s = synced[k] ?? { answered: 0, right: 0 };
    c.legacy[k] = {
      answered: Math.max(mine.answered, d.answered - s.answered, 0),
      right: Math.max(mine.right, d.right - s.right, 0),
    };
  }
  c.legacyDirty = true;
  c.pushedAt = 0;
  rebuildDaily(state, now);
}

const pack = (c) => [c.box, c.due, c.seen, c.right, c.wrong, c.parked ? 1 : 0, c.last, everMissed(c) ? 1 : 0];
// 舊版後端只回 7 欄（沒有 missed）：cleanCard 會從次數與盒子推回來
/** @param {unknown[]} row 雲端回來的一列（欄位數與內容都還沒檢查，交給 cleanCard） */
const unpack = ([box, due, seen, right, wrong, parked, last, missed]) => cleanCard({ box, due, seen, right, wrong, parked: !!parked, last, missed });

/**
 * 要上傳的變動：上次上傳之後作答過的題目、這台這幾天的作答量、回報與收藏、闖關進度、模擬考成績；第一次則全部上傳。
 * 每日作答量每次都帶今天的，不算「有變動」（見 hasChanges）
 */
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
  /** @type {{ flags?: Record<string, [number, number]>, stars?: Record<string, [number, number]> }} 題目 id → [時間, 1 標記／0 取消] */
  const marks = {};
  for (const kind of MARKS) {
    const out = (marks[kind] = {});
    for (const [id, at] of Object.entries(state[kind] ?? {})) if (at > since) out[id] = [at, 1];
    for (const [id, at] of Object.entries(state[`${kind}Off`] ?? {})) if (at > since) out[id] = [at, 0];
  }
  // 闖關進度與模擬考成績是後來才加進同步的：舊版開過同步的裝置，第一次用新版同步時全部上傳一次
  const since2 = (c.schema ?? 1) >= SCHEMA ? since : 0;
  const path = pathRows(state.path, since2);
  const exams = (state.examLog ?? []).filter((e) => e.at > since2);
  return { cards, daily, ...marks, path, exams, best: state.best.blitz };
}

/** state.cloud.schema：2 = 闖關進度與模擬考成績已經全部上傳過 */
export const SCHEMA = 2;

/** 上次上傳之後有沒有要送的變動（作答中定時同步用：沒有變動就不必連線） */
export function hasChanges(state) {
  const c = state.cloud;
  if (!c?.code) return false;
  if (!c.pushedAt || c.legacyDirty || c.pushedAt > Date.now() || (c.schema ?? 1) < SCHEMA) return true;
  const p = buildPush(state);
  return p.cards.length > 0 || p.path.length > 0 || p.exams.length > 0 || MARKS.some((k) => Object.keys(p[k]).length > 0) || state.best.blitz > (c.bestSent ?? 0);
}

/** 套用雲端拉回來的變動，回傳本機有幾筆紀錄（題目、標記、闖關的單元、模擬考成績）因此改變 */
export function applyPull(state, res, now) {
  const c = state.cloud;
  let changed = 0;
  for (const [id, arr] of Object.entries(res.cards ?? {})) {
    const card = CARD_ID.test(id) && Array.isArray(arr) && unpack(arr);
    if (!card) continue;
    const before = state.cards[id];
    const after = mergeCard(before, card);
    if (!before || after.last !== before.last || after.seen !== before.seen || after.right !== before.right || after.wrong !== before.wrong) changed++;
    state.cards[id] = after;
  }
  for (const [device, day, answered, right] of res.daily ?? []) {
    // 這台自己的作答量以本機為準（答對後標成猜的會把答對數扣回來，雲端那份可能還是扣之前的）
    if (device === c.device) continue;
    const map = device ? (c.devices[device] ||= {}) : c.legacy;
    const d = map[day] ?? { answered: 0, right: 0 };
    // 別台的那一列只有它自己會寫：作答量沒變少就採用雲端的（答對數可能被扣回來）；舊紀錄各台取較大值
    map[day] = device
      ? answered >= d.answered ? { answered, right } : d
      : { answered: Math.max(d.answered, answered), right: Math.max(d.right, right) };
  }
  for (const kind of MARKS) {
    const on = (state[kind] ||= {});
    const off = (state[`${kind}Off`] ||= {});
    for (const [id, [at, flag]] of Object.entries(res[kind] ?? {})) if (applyMark(on, off, id, at, !!flag)) changed++;
  }
  state.best.blitz = Math.max(state.best.blitz, res.best ?? 0);
  // 闖關進度、模擬考成績（舊版後端沒有這兩欄）
  if (Array.isArray(res.path) && res.path.length) changed += applyPathRows((state.path ||= {}), res.path);
  changed += mergeExams(state, res.exams);
  if (Number.isFinite(res.rev)) c.cursor = res.rev;
  rebuildDaily(state, now);
  return changed;
}

/** 每日作答量 = 舊紀錄 + 各台開始同步後的作答量；連續天數跟著重算 */
export function rebuildDaily(state, now) {
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
  // 裝置時間被往回調過：「上次上傳之後」的判斷不可靠，全部重新上傳
  if (c.pushedAt > snapshot) c.pushedAt = 0;
  const push = buildPush(state);
  // 作答、每日題數、收藏、回報都分批送（後端每批有列數上限）；第一批之外只帶還沒送完的部分
  const slices = (list, size = CHUNK) => {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  };
  const cardBatches = slices(push.cards);
  const dailyBatches = slices(push.daily, 500);
  const flagBatches = slices(Object.entries(push.flags));
  const starBatches = slices(Object.entries(push.stars));
  const pathBatches = slices(push.path, 200);
  const examBatches = slices(push.exams, 60);
  const count = Math.max(1, cardBatches.length, dailyBatches.length, flagBatches.length, starBatches.length, pathBatches.length, examBatches.length);
  let changed = 0;
  // 後端回了 path 才算支援闖關進度與成績（舊版後端會略過這兩欄）：不支援就不記 schema，之後換新後端再全部上傳
  let supported = true;
  for (let i = 0; i < count; i++) {
    const res = await request(
      '/v1/sync',
      {
        code: c.code,
        device: c.device,
        since: c.cursor,
        cards: Object.fromEntries(cardBatches[i] ?? []),
        daily: dailyBatches[i] ?? [],
        flags: Object.fromEntries(flagBatches[i] ?? []),
        stars: Object.fromEntries(starBatches[i] ?? []),
        path: pathBatches[i] ?? [],
        exams: examBatches[i] ?? [],
        best: push.best,
      },
      { keepalive },
    );
    if (state.cloud !== c || !c.code) return changed;
    if (!Array.isArray(res.path)) supported = false;
    changed += applyPull(state, res, now());
  }
  c.bestSent = push.best;
  if (supported) c.schema = SCHEMA;
  c.pushedAt = snapshot;
  c.legacyDirty = false;
  c.syncedAt = now();
  return changed;
}
