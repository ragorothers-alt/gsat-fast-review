// 模擬考的草稿存在 IndexedDB（每題一頁，key 是 ui/exam.js 給的頁名 exam-<開考時間>-<第幾題>）：
// 考到一半重新整理或關掉 App，接著考時每題的草稿還在。筆跡點很多，放 localStorage 會擠到進度存檔的空間，所以另外放。
// 只存看得到的筆劃（packPage）；私密瀏覽、空間不足或瀏覽器不支援時讀不到也存不了，就當作沒有，不影響作答。

const DB = 'gsat-scratch';
const STORE = 'pages';

/** @type {Promise<IDBDatabase | null> | null} */
let opening = null;

function db() {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/**
 * 開一個交易跑 fn，交易完成後回傳 fn 給的請求的結果；任何一步失敗都回傳 null
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest | void} fn
 */
async function run(mode, fn) {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result ?? null) : null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** 讀一頁（packPage 存的格式）；沒有或讀不到是 null */
export const loadPage = (key) => run('readonly', (store) => store.get(key));

/** 存一頁；空白頁直接刪掉 */
export const savePage = (key, data) => run('readwrite', (store) => (data?.strokes?.length ? store.put(data, key) : store.delete(key)));

/** 刪掉頁名開頭是 prefix 的頁（交卷、放棄或開新卷時，清掉之前的卷） */
export const dropPages = (prefix) =>
  run('readwrite', (store) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
  });
