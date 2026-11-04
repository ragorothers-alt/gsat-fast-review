// 題庫：每科一個 JSON 檔，建置時輸出成獨立檔案（檔名含內容雜湊），開啟時再下載。
// 題庫有上萬題，不打包進主程式：改版時只有內容變了的科目要重新下載，裝成 PWA 後也一樣離線可玩。
// 開機時先載入首頁選的科目就能開始玩，其他科在背景補上（見 main.js）。
import { SUBJECTS } from '../subjects.js';

const files = import.meta.glob('./questions/*.json', { eager: true, query: '?url', import: 'default' });
const URL_OF = Object.fromEntries(Object.entries(files).map(([path, url]) => [path.match(/([a-z]+)\.json$/)[1], url]));
const order = new Map(SUBJECTS.map((s, i) => [s.id, i]));
/** 下載中或已下載的科目；失敗的會移除，下次再試 */
const pending = new Map();

/** 有題庫檔的科目 */
export const BANK_SUBJECTS = SUBJECTS.map((s) => s.id).filter((id) => URL_OF[id]);

function loadSubject(id) {
  if (!pending.has(id)) {
    const p = fetch(URL_OF[id]).then((res) => {
      if (!res.ok) throw new Error(`題庫下載失敗（${res.status}）`);
      return res.json();
    });
    p.catch(() => pending.delete(id));
    pending.set(id, p);
  }
  return pending.get(id);
}

/** 下載這些科目的題目，依科目順序排好 */
export async function loadBank(ids = BANK_SUBJECTS) {
  const lists = await Promise.all(ids.filter((id) => URL_OF[id]).map(loadSubject));
  return lists.flat().sort((a, b) => order.get(a.subject) - order.get(b.subject));
}

/** 依科目順序排序（補上其他科之後重排） */
export function sortBank(bank) {
  return bank.sort((a, b) => order.get(a.subject) - order.get(b.subject));
}
