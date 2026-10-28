// 進度存在 localStorage。私密瀏覽或被清除時讀不到也要能正常玩，所以全部包 try/catch。
import { SUBJECTS } from './subjects.js';

const KEY = 'gsat-quiz:v1';

/** 116 學年度學測首日（大考中心簡章：2027/1/22–24）；玩家可在設定裡改成自己的考試日期 */
export const DEFAULT_EXAM_DATE = '2027-01-22';

export function freshState() {
  return {
    version: 1,
    cards: {},
    daily: {},
    streak: { count: 0, last: null },
    best: { blitz: 0 },
    // 玩家回報有問題的題目：id → 回報時間；回報後先不出這題
    flags: {},
    // scratch：平板上草稿區要不要展開（手機上一律收起）
    settings: {
      subjects: SUBJECTS.map((s) => s.id),
      excludedUnits: [],
      goal: 30,
      sound: false,
      scratch: true,
      examDate: DEFAULT_EXAM_DATE,
    },
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const saved = JSON.parse(raw);
    const base = freshState();
    // 舊版按「不會」不會降盒子；現在等同答錯，舊紀錄一併拉回第 0 盒
    for (const c of Object.values(saved.cards ?? {})) if (c.parked && c.box > 0) c.box = 0;
    return {
      ...base,
      ...saved,
      streak: { ...base.streak, ...saved.streak },
      best: { ...base.best, ...saved.best },
      settings: { ...base.settings, ...saved.settings },
    };
  } catch {
    return freshState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // 空間不足或被封鎖時放棄儲存，遊戲照常進行
  }
}

/** 請瀏覽器不要在空間吃緊時清掉進度（手機上特別有用） */
export function requestPersistence() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    // 不支援就算了
  }
}
