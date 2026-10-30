// 執行時的錯誤：記在本機（設定裡的「關於與診斷」會列出最近幾筆），並送一份給同步後端，
// 手機上才會發生的問題也找得到。只送錯誤訊息、出錯位置、版本與瀏覽器型號，不含作答紀錄或同步碼。
import { SYNC_API } from './cloud.js';
import { VERSION } from './version.js';

const KEY = 'gsat-quiz:errors';
/** 本機保留幾筆 */
const KEEP = 10;
/** 開一次 App 最多回報幾筆（壞掉的迴圈不會一直送） */
const MAX_SEND = 5;

/** 跟這個 App 無關、或看不出任何資訊的錯誤：瀏覽器擴充功能、跨網域腳本、ResizeObserver 的警告 */
const NOISE = /^(Script error\.?|ResizeObserver loop)|extension:\/\//;

/** 堆疊的第一個呼叫位置，只留檔名（去掉網址），從不同網址開啟時同一個錯誤才會歸成同一筆 */
export function firstFrame(stack) {
  const line = String(stack ?? '')
    .split('\n')
    .map((s) => s.trim())
    .find((s) => /:\d+:\d+\)?$/.test(s));
  if (!line) return '';
  return line.replace(/^at\s+/, '').replace(/https?:\/\/[^\s)]*\//g, '').slice(0, 300);
}

/** 整理成要記錄的一筆；不值得記的回傳 null */
export function errorEntry(message, stack, now) {
  const m = String(message ?? '').trim().slice(0, 300);
  const source = firstFrame(stack);
  if (!m || NOISE.test(m) || NOISE.test(String(stack ?? ''))) return null;
  return { at: now, message: m, source };
}

export function recentErrors() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const sent = new Set();

function record(message, stack) {
  const entry = errorEntry(message, stack, Date.now());
  if (!entry) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...recentErrors()].slice(0, KEEP)));
  } catch {
    // 存不了就只回報
  }
  const key = `${entry.message}|${entry.source}`;
  if (!import.meta.env?.PROD || sent.has(key) || sent.size >= MAX_SEND) return;
  sent.add(key);
  const body = JSON.stringify({ version: VERSION, message: entry.message, source: entry.source, ua: navigator.userAgent.slice(0, 200) });
  fetch(`${SYNC_API}/v1/log`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
}

export function initErrorReporting() {
  window.addEventListener('error', (e) => record(e.message, e.error?.stack ?? (e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : '')));
  window.addEventListener('unhandledrejection', (e) => record(e.reason?.message ?? String(e.reason), e.reason?.stack));
}
