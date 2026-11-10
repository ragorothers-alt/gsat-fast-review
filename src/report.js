// 回報題目：按旗子時，除了這台先不出這題，也把題號送給同步後端累計次數，題庫維護者才知道大家回報了哪些題。
// 只送題號與 App 版本，不含是誰、作答紀錄或同步碼；設定裡關掉「自動回報」就不送（這台照樣先不出這題）。
import { SYNC_API } from './cloud.js';
import { VERSION } from './version.js';

/** 開一次 App 最多送幾題（連按、壞掉的迴圈不會一直送） */
const MAX_SEND = 30;
const sent = new Set();
let reporting = true;

export function setQuestionReporting(on) {
  reporting = on;
}

/**
 * 送出一題的回報；同一題開一次 App 只送一次（取消再回報不重複算）。
 * @param {string} id 題號
 * @param {{ send?: (url: string, init: object) => Promise<unknown>, prod?: boolean }} [opts] 測試用：換掉 fetch、當成正式版
 * @returns {boolean} 有沒有送出
 */
export function reportQuestion(id, { send = fetch, prod = !!import.meta.env?.PROD } = {}) {
  if (!reporting || !prod || sent.has(id) || sent.size >= MAX_SEND) return false;
  sent.add(id);
  const body = JSON.stringify({ id, version: VERSION });
  // text/plain：不觸發 CORS 預檢，離開頁面時（keepalive）也送得出去
  Promise.resolve(send(`${SYNC_API}/v1/report`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true })).catch(() => {});
  return true;
}
