// 考前重點卡：每科一個 JSON 檔（src/data/keypoints/<科目>.json），打開卡片時才下載。
// 檔名含內容雜湊、會被 service worker 預先快取，裝成 App 後跟題庫一樣離線可看。
const urls = import.meta.glob('./keypoints/*.json', { eager: true, query: '?url', import: 'default' });
const cache = new Map();

/**
 * @param {string} subject
 * @returns {Promise<{ unit: string, points: string[], traps: string[] }[] | null>} 這科還沒有重點卡就是 null
 */
export function loadKeypoints(subject) {
  const url = urls[`./keypoints/${subject}.json`];
  if (!url) return Promise.resolve(null);
  if (!cache.has(subject)) {
    const job = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`重點卡下載失敗（${res.status}）`);
        return res.json();
      })
      .catch((e) => {
        cache.delete(subject); // 下次打開再試
        throw e;
      });
    cache.set(subject, job);
  }
  return cache.get(subject);
}
