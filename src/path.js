// 單元闖關：選一科，依單元順序一關一關過。每關先出 30 題；答錯、看解答或標成猜的，
// 就在這關最後補一題同單元最像的題目，最後一題也答對才算過關、解鎖下一關。純邏輯，不碰 DOM，方便測試。
import { relatedQuestions } from './related.js';
import { UNITS, unitKey } from './units.js';

/** 每關一開始出幾題 */
export const PATH_SIZE = 30;

/** 這科要闖的單元：依 src/units.js 的順序，跳過在「選單元」裡關掉的 */
export function pathUnits(subject, excludedUnits = []) {
  const off = new Set(excludedUnits);
  return (UNITS[subject] || []).filter((u) => !off.has(unitKey(subject, u)));
}

/**
 * 這科的進度：cleared 已過關的單元；runs 每個做到一半的關（ids 這關的題目順序、index 下一題的位置、
 * extra 補進來的類似題）。重闖已過關的單元也有自己的一份，不會蓋掉正在闖的那關。
 * 沒有紀錄時建一份空的，存檔時一起存下來。
 */
export function pathProgress(state, subject) {
  state.path ||= {};
  return (state.path[subject] ||= { cleared: [], runs: {} });
}

/** 題目都答完的關（例如答完最後一題就離開）：記成過關、清掉進行中的紀錄 */
export function settleRuns(progress) {
  for (const [unit, run] of Object.entries(progress.runs)) {
    if (run.index < run.ids.length) continue;
    if (!progress.cleared.includes(unit)) progress.cleared.push(unit);
    delete progress.runs[unit];
  }
}

/** 現在該闖的關：第一個還沒過關的單元；全部過關回傳 null */
export function currentUnit(units, progress) {
  return units.find((u) => !progress.cleared.includes(u)) ?? null;
}

/** 單元的狀態：done 已過關、current 現在這關（或做到一半的關）、locked 還沒解鎖 */
export function unitStatus(units, progress, unit) {
  if (progress.cleared.includes(unit)) return 'done';
  return unit === currentUnit(units, progress) || progress.runs[unit] ? 'current' : 'locked';
}

/**
 * 答錯（或看解答、標成猜的）之後要補的題：同單元裡最像、這關還沒出過的；
 * 類似題都出過了，就把這題本身排到最後再考一次。
 * @param {Iterable<string>} used 這關已經排進去的題目 id
 * @param {Iterable<string>} avoid 不要出的題目 id（被回報的）
 */
export function followUp(bank, q, used, avoid = []) {
  const [similar] = relatedQuestions(bank, q, { count: 1, exclude: [...used, ...avoid] });
  return similar ?? q;
}
