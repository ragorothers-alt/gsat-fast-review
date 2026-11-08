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
 * extra 補進來的類似題、at 最後一次更新的時間）。重闖已過關的單元也有自己的一份，不會蓋掉正在闖的那關。
 * clearedAt 各單元過關的時間、resetAt 從第一關重新闖的時間：線上同步合併時用（舊紀錄沒有）。
 * 沒有紀錄時建一份空的，存檔時一起存下來。
 */
export function pathProgress(state, subject) {
  state.path ||= {};
  return (state.path[subject] ||= { cleared: [], runs: {} });
}

/** 過關：記下過關的時間，清掉這關進行中的紀錄 */
export function markCleared(progress, unit, now = Date.now()) {
  if (!progress.cleared.includes(unit)) progress.cleared.push(unit);
  (progress.clearedAt ||= {})[unit] = now;
  delete progress.runs[unit];
}

/** 題目都答完的關（例如答完最後一題就離開）：記成過關、清掉進行中的紀錄 */
export function settleRuns(progress, now = Date.now()) {
  for (const [unit, run] of Object.entries(progress.runs)) {
    if (run.index < run.ids.length) continue;
    markCleared(progress, unit, now);
  }
}

/** 從第一關重新闖：記下時間，同步時比它早的過關、進行中的關都不算 */
export const resetProgress = (now = Date.now()) => ({ cleared: [], runs: {}, resetAt: now });

// ── 線上同步：每科每個單元一列 [subject, unit, cleared, runAt, run]，unit 空字串那列是重新闖的時間 ──
// 舊紀錄沒有時間：過關、進行中的關當成時間 1（比任何一次重新闖都早），第一次同步時照樣上傳
const clearedTime = (prog, unit) => (prog.cleared.includes(unit) ? (prog.clearedAt?.[unit] ?? 1) : 0);
const runTime = (run) => (run ? (run.at ?? 1) : 0);

/** 要上傳的列：過關或進行中的關在 since 之後有變動的單元，以及 since 之後的重新闖 */
export function pathRows(path, since = 0) {
  const rows = [];
  for (const [subject, prog] of Object.entries(path ?? {})) {
    if ((prog.resetAt ?? 0) > since) rows.push([subject, '', prog.resetAt, 0, null]);
    for (const unit of new Set([...prog.cleared, ...Object.keys(prog.runs)])) {
      const cleared = clearedTime(prog, unit);
      const run = prog.runs[unit];
      if (cleared > since || runTime(run) > since) {
        rows.push([subject, unit, cleared, runTime(run), run ? { ids: run.ids, index: run.index, extra: run.extra ?? [] } : null]);
      }
    }
  }
  return rows;
}

/**
 * 併進別台的闖關進度（雲端拉回來的列，或另一個分頁的 pathRows）。規則和同步後端一致，重複併同一份不會變：
 * 過關時間取較大值；進行中的關以較晚的為準；比重新闖還早的過關與進行中的關都不算；
 * 進行中的關比這個單元的過關時間早，表示那關已經做完了，也不算。回傳本機有幾個單元因此改變。
 */
export function applyPathRows(path, rows) {
  const touched = new Set();
  for (const row of rows ?? []) {
    if (!Array.isArray(row) || row.length !== 5) continue;
    const [subject, unit, cleared, runAt, run] = row;
    if (typeof subject !== 'string' || typeof unit !== 'string' || !Number.isSafeInteger(cleared) || !Number.isSafeInteger(runAt)) continue;
    const prog = (path[subject] ||= { cleared: [], runs: {} });
    if (!unit) {
      if (cleared > (prog.resetAt ?? 0)) {
        prog.resetAt = cleared;
        touched.add(subject);
      }
      continue;
    }
    if (cleared > clearedTime(prog, unit)) {
      if (!prog.cleared.includes(unit)) prog.cleared.push(unit);
      (prog.clearedAt ||= {})[unit] = cleared;
      touched.add(`${subject}\n${unit}`);
    }
    const valid = run && Array.isArray(run.ids) && Number.isSafeInteger(run.index);
    if (valid && runAt > runTime(prog.runs[unit])) {
      prog.runs[unit] = { ids: run.ids, index: run.index, extra: Array.isArray(run.extra) ? run.extra : [], at: runAt };
      touched.add(`${subject}\n${unit}`);
    }
  }
  // 套用重新闖、做完的關
  for (const key of touched) {
    const [subject] = key.split('\n');
    const prog = path[subject];
    const reset = prog.resetAt ?? 0;
    prog.cleared = prog.cleared.filter((u) => clearedTime(prog, u) > reset);
    for (const u of Object.keys(prog.clearedAt ?? {})) if (!prog.cleared.includes(u)) delete prog.clearedAt[u];
    for (const [u, run] of Object.entries(prog.runs)) {
      if (runTime(run) <= reset || (prog.cleared.includes(u) && clearedTime(prog, u) >= runTime(run))) delete prog.runs[u];
    }
  }
  return touched.size;
}

/**
 * 接著做到一半的關：被回報（或題庫拿掉）的題目略過。下一題的位置只算它前面還留著的題數，
 * 前面少了一題也不會跳過還沒答的題。回傳 { ids, index }；index 到底表示剩下的題都被略過了。
 * @param {{ ids: string[], index: number }} run
 * @param {(id: string) => boolean} keep
 */
export function resumeRun(run, keep) {
  const ids = [];
  let index = 0;
  run.ids.forEach((id, i) => {
    if (!keep(id)) return;
    ids.push(id);
    if (i < run.index) index++;
  });
  return { ids, index };
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
