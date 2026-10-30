// 端對端測試：先 npm run build，再用 vite preview 開起建置好的版本，在無頭 Chromium 裡實際操作（npm run e2e）。
// 手機與桌機各跑一次；測試檔是 e2e/*.e2e.js（不叫 .test.js，免得被 vitest 撿去跑）。
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    // 大部分測試不需要離線快取；要測離線的那一個會自己打開
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
});
