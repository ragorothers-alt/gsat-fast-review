// 進度存在 localStorage。私密瀏覽或被清除時讀不到也要能正常玩，所以全部包 try/catch。
import { SUBJECTS } from './subjects.js';

const KEY = 'gsat-quiz:v1';

export function freshState() {
  return {
    version: 1,
    cards: {},
    daily: {},
    streak: { count: 0, last: null },
    best: { blitz: 0 },
    // scratch：平板上草稿區要不要展開（手機上一律收起）
    settings: { subjects: SUBJECTS.map((s) => s.id), excludedUnits: [], goal: 30, sound: false, scratch: true },
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const saved = JSON.parse(raw);
    const base = freshState();
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
