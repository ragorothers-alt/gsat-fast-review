import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export default defineConfig({
  // 相對路徑：放在任何子路徑（GitHub Pages 等）都能跑
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
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
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

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
`;
}
