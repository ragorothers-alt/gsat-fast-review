import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export default defineConfig({
  // 相對路徑：放在任何子路徑（GitHub Pages 等）都能跑
  base: './',
  // 題庫是另外下載的 JSON（見 src/data/bank.js）；主程式約 900 kB 幾乎都是 three.js 與 KaTeX，一次快取就好，不再拆
  build: { target: 'es2020', chunkSizeWarningLimit: 1000 },
  // 版本號（設定裡的「關於與診斷」、錯誤回報用）：git commit 的前 7 碼與建置時間
  define: { __APP_VERSION__: JSON.stringify(commit()), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  plugins: [minifyJsonAssets(), precacheServiceWorker()],
});

/**
 * 題庫、重點卡 JSON 原檔有縮排方便閱讀與比對；輸出時去掉空白，裝成 PWA 後占的空間少約 14%，解析也快一點。
 * 檔名的雜湊照原檔內容算，內容有改才換檔名，不受這一步影響。
 */
function minifyJsonAssets() {
  return {
    name: 'minify-json-assets',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.json')) continue;
        const text = typeof file.source === 'string' ? file.source : Buffer.from(file.source).toString('utf8');
        file.source = JSON.stringify(JSON.parse(text));
      }
    },
  };
}

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

function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full).map((f) => `${name}/${f}`) : [relative(dir, full).replace(/\\/g, '/')];
  });
}

function serviceWorkerSource(version, urls) {
  return `// 由 vite.config.js 產生，請勿手動修改
// 同一個網域（例如 GitHub Pages 的 <帳號>.github.io）底下可能還有別的 App：快取名稱帶上這個 App 的網址，只動自己的快取
const PREFIX = 'gsat-quiz ' + self.registration.scope + ' ';
const CACHE = PREFIX + ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(urls, null, 2)};
// 主程式缺一個就開不起來，要全部下載成功才裝新版；題庫、重點卡、字型下載失敗就先略過，用到時再抓
const CRITICAL = (url) => url === './' || /\\.(js|css|webmanifest)$/.test(url);
// 舊版的快取名稱（gsat- 加 12 碼雜湊），升級時一併清掉
const LEGACY = /^gsat-[0-9a-f]{12}$/;
const own = (k) => k.startsWith(PREFIX) || LEGACY.test(k);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => {
      const put = (url) =>
        reuse(url).then((hit) => {
          if (hit) return c.put(url, hit);
          // 不含雜湊的網址（./、圖示）要繞過瀏覽器的 HTTP 快取，否則可能把舊版首頁存進新版快取
          const req = url.startsWith('assets/') ? url : new Request(url, { cache: 'reload' });
          return fetch(req).then((res) => {
            if (!res.ok) throw new Error(url + ' ' + res.status);
            return c.put(url, res);
          });
        });
      return Promise.all(PRECACHE.filter(CRITICAL).map(put)).then(() =>
        Promise.allSettled(PRECACHE.filter((url) => !CRITICAL(url)).map(put)),
      );
    }).then(() => self.skipWaiting()),
  );
});

/** 只在這個 App 的快取裡找；新版優先，找不到再看還留著的上一版 */
function ownMatch(req, opts) {
  return caches.keys().then((keys) =>
    keys.filter(own).reverse().reduce((p, k) => p.then((hit) => hit || caches.open(k).then((c) => c.match(req, opts))), Promise.resolve(undefined)),
  );
}

// assets/ 底下的檔名含內容雜湊，內容不會變：舊版快取裡有就直接沿用，改版時只下載真的變了的檔案（例如某一科題庫）
function reuse(url) {
  return url.startsWith('assets/') ? ownMatch(url) : Promise.resolve(undefined);
}

// 換上新版時保留上一版的快取：還開著的舊頁面（作答中，等回首頁才換新版）之後要載入的重點卡、字型還找得到
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const mine = keys.filter((k) => own(k) && k !== CACHE);
        return Promise.all(mine.slice(0, -1).map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

// 快取優先：沒網路也能開；新版本會在下次開啟時生效。
// ignoreVary：有些主機回應帶 Vary: Origin，而 <script crossorigin> 的請求帶 Origin、預先快取時沒帶，不忽略就會對不上
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    ownMatch(req, { ignoreSearch: req.mode === 'navigate', ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? ownMatch('./') : Response.error()));
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
      // 同網域可能開著別的 App 的視窗：只挑這個 App 的
      const open = list.find((c) => 'focus' in c && c.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow('./');
    }),
  );
});
`;
}
