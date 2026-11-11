// 進度存在 localStorage。私密瀏覽或被清除時讀不到也要能正常玩，所以全部包 try/catch。
import { SUBJECTS } from './subjects.js';
import { rebuildDaily } from './cloud.js';
import { mergeExams } from './exam.js';
import { cleanPace, mergePace } from './pace.js';
import { applyPathRows, pathRows } from './path.js';
import { RELEARN_BOX } from './srs.js';
import { cleanCard, mergeState } from './sync.js';

export const KEY = 'gsat-quiz:v1';

/** 116 學年度學測首日（大考中心簡章：2027/1/22–24）；玩家可在設定裡改成自己的考試日期 */
export const DEFAULT_EXAM_DATE = '2027-01-22';

export function freshState() {
  return {
    version: 1,
    cards: {},
    daily: {},
    streak: { count: 0, last: null },
    best: { blitz: 0 },
    // 玩家回報有問題的題目：id → 回報時間；回報後先不出這題。flagsOff：取消回報的時間（同步用）
    flags: {},
    flagsOff: {},
    // 收藏的題目：id → 收藏時間；starsOff：取消收藏的時間（同步用）
    stars: {},
    starsOff: {},
    // 線上同步（cloud.js）；沒開過就是 null
    cloud: null,
    // 單元闖關的進度：科目 → { cleared, runs, clearedAt, resetAt }（見 path.js），會線上同步；pathLast 是這台最近闖的科目
    path: {},
    pathLast: null,
    // 模擬考：考到一半的卷（見 exam.js 的 newExam）只存在這台；最近的成績（logExam）會線上同步
    exam: null,
    examLog: [],
    // 作答速度：單元 → 計時的題數與秒數（見 pace.js），只存在這台
    pace: {},
    // scratch：平板上草稿區要不要展開（手機上一律收起）
    // theme：auto（跟著系統）／light／dark；fontScale：字體大小倍率
    // reminder：每日提醒，hour 是當地時間幾點（推播訂閱存在同步後端，見 ui/reminder.js）
    settings: {
      subjects: SUBJECTS.map((s) => s.id),
      excludedUnits: [],
      goal: 30,
      // quickOnly：只出單題（不出題組、圖表題、多選、演算題與非選擇題；見 session.js 的 quickOnlyFor）
      quickOnly: false,
      sound: false,
      scratch: true,
      // eraser：草稿區的橡皮擦 stroke（整條擦掉）／area（擦一塊）
      eraser: 'stroke',
      examDate: DEFAULT_EXAM_DATE,
      theme: 'auto',
      fontScale: 1,
      // motion：背景動畫 auto／on／lite／off（見 ui/appearance.js）
      motion: 'auto',
      // reportErrors：程式出錯時自動回報給開發者（見 errors.js）
      reportErrors: true,
      reminder: { on: false, hour: 20 },
    },
  };
}

/** 讀不懂的存檔先搬到這裡，不讓下一次存檔蓋掉（關於與診斷可以看到、之後也還救得回來） */
export const BROKEN_KEY = 'gsat-quiz:broken';

/** 把存檔字串還原成 state；壞掉的卡片個別丟掉，不連累整份進度 */
export function parseState(raw) {
  const saved = JSON.parse(raw);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('bad save');
  const base = freshState();
  const cards = {};
  for (const [id, c] of Object.entries(saved.cards ?? {})) {
    const card = cleanCard(c);
    if (!card) continue;
    // 舊版按「不會」不會降盒子；現在等同答錯，舊紀錄一併拉回失手後的那一盒
    if (card.parked && card.box > RELEARN_BOX) card.box = RELEARN_BOX;
    cards[id] = card;
  }
  const num = (x) => Number.isFinite(x);
  return {
    ...base,
    ...saved,
    cards,
    // 考到一半的卷開考前會再檢查一次（ui/exam.js）；成績紀錄壞掉的筆數丟掉
    exam: saved.exam && typeof saved.exam === 'object' && !Array.isArray(saved.exam) ? saved.exam : null,
    examLog: Array.isArray(saved.examLog) ? saved.examLog.filter((e) => e && typeof e.paper === 'string' && num(e.at) && num(e.right) && num(e.total) && e.total > 0) : [],
    pace: cleanPace(saved.pace),
    streak: { ...base.streak, ...saved.streak },
    best: { ...base.best, ...saved.best },
    settings: { ...base.settings, ...saved.settings, reminder: { ...base.settings.reminder, ...saved.settings?.reminder } },
  };
}

/** 這個分頁最後一次讀到或寫入的存檔字串：別的分頁寫入時用來判斷有沒有新東西 */
let lastRaw = null;

export function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const state = parseState(raw);
    lastRaw = raw;
    return state;
  } catch {
    try {
      if (raw) localStorage.setItem(BROKEN_KEY, raw);
    } catch {
      // 連備份都存不了：至少不影響開始玩
    }
    return freshState();
  }
}

/** 存檔；空間不足或被封鎖時回傳 false（遊戲照常進行，由呼叫端提示玩家） */
export function saveState(state) {
  try {
    const raw = JSON.stringify(state);
    localStorage.setItem(KEY, raw);
    lastRaw = raw;
    return true;
  } catch {
    return false;
  }
}

/**
 * 同時開著兩個分頁（或瀏覽器分頁＋安裝的 App）時，每個分頁都拿著自己那份進度，後存的會整份蓋掉先存的。
 * 別的分頁存檔時（storage 事件）把它的紀錄併進這個分頁：作答、收藏與回報、每日題數照同步的規則合併，
 * 設定與闖關進度採用對方較新的那份。合併後回傳 true，呼叫端重畫畫面並存回去。
 */
export function absorbState(state, raw) {
  if (!raw || raw === lastRaw) return false;
  let other;
  try {
    other = parseState(raw);
  } catch {
    return false;
  }
  lastRaw = raw;
  const merged = mergeState(state, other).state;
  // 闖關進度、模擬考成績跟線上同步用同一套規則合併（重新闖、做到一半的關都比時間）
  const path = state.path ?? {};
  applyPathRows(path, pathRows(other.path));
  mergeExams(merged, other.examLog);
  Object.assign(state, merged, {
    settings: Object.assign(state.settings, other.settings),
    path,
    pathLast: other.pathLast,
    pace: mergePace(state.pace, other.pace),
    cloud: mergeCloud(state.cloud, other.cloud),
  });
  // 開了同步時，每日題數由各台的紀錄加總而來
  if (state.cloud?.code) rebuildDaily(state, Date.now());
  return true;
}

/** 兩個分頁的同步狀態：同一組同步碼時，各台裝置的每日題數取較大值（同一台的兩個分頁各記了一部分） */
function mergeCloud(mine, other) {
  if (!mine?.code) return other ?? mine;
  if (other?.code !== mine.code) return mine;
  const maxDays = (a, b) => {
    for (const [k, d] of Object.entries(b ?? {})) {
      const m = a[k] ?? { answered: 0, right: 0 };
      a[k] = { answered: Math.max(m.answered, d.answered), right: Math.max(m.right, d.right) };
    }
  };
  maxDays(mine.legacy, other.legacy);
  for (const [device, days] of Object.entries(other.devices ?? {})) maxDays((mine.devices[device] ||= {}), days);
  return mine;
}

/** 請瀏覽器不要在空間吃緊時清掉進度（手機上特別有用） */
export function requestPersistence() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    // 不支援就算了
  }
}
