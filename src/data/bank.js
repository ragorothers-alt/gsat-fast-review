// 題庫：每科一個 JSON 檔，建置時輸出成獨立檔案（檔名含內容雜湊），開啟時再下載。
// 題庫有上萬題，不打包進主程式：改版時只有內容變了的科目要重新下載，裝成 PWA 後也一樣離線可玩。
import { SUBJECTS } from '../subjects.js';

const urls = import.meta.glob('./questions/*.json', { eager: true, query: '?url', import: 'default' });
const order = new Map(SUBJECTS.map((s, i) => [s.id, i]));

export async function loadBank() {
  const lists = await Promise.all(
    Object.values(urls).map(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`題庫下載失敗（${res.status}）`);
      return res.json();
    }),
  );
  return lists.flat().sort((a, b) => order.get(a.subject) - order.get(b.subject));
}
