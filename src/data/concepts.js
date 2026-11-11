// 考點清單：每科一個 JSON 檔（src/data/concepts/<科目>.json），要顯示考點名稱時才下載。
// 出題順序只用題目上的 kp 代號（src/priority.js），不必等這個檔；檔名含內容雜湊、會被 service worker 預先快取。
const urls = import.meta.glob('./concepts/*.json', { eager: true, query: '?url', import: 'default' });
/** @type {Map<string, Promise<{ unit: string, concepts: { id: string, name: string, scope: string }[] }[]>>} */
const cache = new Map();
/** 已經下載好的科目：考點代號 → { name, unit } */
const ready = new Map();

/**
 * @param {string} subject
 * @returns {Promise<{ unit: string, concepts: { id: string, name: string, scope: string }[] }[] | null>} 這科還沒有考點清單就是 null
 */
export function loadConcepts(subject) {
  const url = urls[`./concepts/${subject}.json`];
  if (!url) return Promise.resolve(null);
  if (!cache.has(subject)) {
    const job = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`考點清單下載失敗（${res.status}）`);
        return res.json();
      })
      .then((list) => {
        ready.set(subject, new Map(list.flatMap((u) => u.concepts.map((c) => [c.id, { name: c.name, unit: u.unit }]))));
        return list;
      })
      .catch((e) => {
        cache.delete(subject); // 下次要用再試
        throw e;
      });
    cache.set(subject, job);
  }
  return cache.get(subject);
}

/**
 * 這題的考點（名稱與所屬單元）；清單還沒下載好、或這題沒標考點就是 null。
 * 跨單元綜合的題目借用別的單元的考點，所以 unit 不一定是題目自己的單元
 * @param {{ subject: string, kp?: string }} q
 * @returns {{ name: string, unit: string } | null}
 */
export const conceptOf = (q) => (q.kp && ready.get(q.subject)?.get(q.kp)) || null;
