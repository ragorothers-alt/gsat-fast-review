import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export default defineConfig({
  // 相對路徑：放在任何子路徑（GitHub Pages 等）都能跑
  base: './',
  // 題庫是另外下載的 JSON（見 src/data/bank.js）；主程式約 900 kB 幾乎都是 three.js 與 KaTeX，一次快取就好，不再拆
  build: { target: 'es2020', chunkSizeWarningLimit: 1000 },
  plugins: [precacheServiceWorker()],
});

/**
 * 建置時產生 sw.js：預先快取所有輸出檔，裝好之後完全離線可玩。
 * KaTeX 的 .woff/.ttf 是舊瀏覽器備援，不快取（現代瀏覽器只抓 .woff2）。
 */
function precacheServiceWorker() {
  return {
    name: 'precache-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const built = Object.keys(bundle).filter((f) => !/\.(map|woff|ttf)$/.test(f));
      const pub = listFiles('public');
      const hash = createHash('sha256');
      for (const f of built.sort()) hash.update(f);
      for (const f of pub) hash.update(f).update(readFileSync(join('public', f)));
      const version = `gsat-${hash.digest('hex').slice(0, 12)}`;
      const urls = ['./', ...built, ...pub];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, urls) });
    },
  };
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full).map((f) => `${name}/${f}`) : [relative(dir, full).replace(/\\/g, '/')];
  });
}

function serviceWorkerSource(version, urls) {
  return `// 由 vite.config.js 產生，請勿手動修改
const CACHE = ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(urls, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((url) => reuse(url).then((hit) => (hit ? c.put(url, hit) : c.add(url))))))
      .then(() => self.skipWaiting()),
  );
});

// assets/ 底下的檔名含內容雜湊，內容不會變：舊版快取裡有就直接沿用，改版時只下載真的變了的檔案（例如某一科題庫）
function reuse(url) {
  return url.startsWith('assets/') ? caches.match(url) : Promise.resolve(undefined);
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 快取優先：沒網路也能開；新版本會在下次開啟時生效
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./') : Response.error()));
    }),
  );
});

// 每日提醒（同步後端 worker/src/push.js 送來的推播）：顯示通知，點了就打開 App
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(msg.title || '學測快問快答', {
      body: msg.body || '今天還沒練習，來一輪 60 秒快閃吧！',
      icon: 'icons/icon-192.png',
      tag: 'daily-reminder',
      lang: 'zh-Hant-TW',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
`;
}
