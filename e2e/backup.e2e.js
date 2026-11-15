// 進度備份：匯入另一台匯出的檔案，作答紀錄、闖關進度與模擬考成績都併進這台
import { expect, openHome, test } from './fixtures.js';

test('匯入備份檔：作答、闖關進度與模擬考成績都併進來，重複匯入不會變', async ({ page }) => {
  await openHome(page);
  const now = Date.now();
  const backup = {
    app: 'gsat-quiz',
    version: 1,
    exportedAt: now,
    state: {
      cards: { 'math-001': { box: 2, due: now + 86_400_000, seen: 1, right: 1, wrong: 0, parked: false, last: now - 1000 } },
      daily: {},
      streak: { count: 0, last: null },
      best: { blitz: 0 },
      flags: {},
      flagsOff: {},
      stars: {},
      starsOff: {},
      path: { math: { cleared: ['數與式'], clearedAt: { 數與式: now - 5000 }, runs: {} } },
      examLog: [{ paper: 'math', at: now - 9000, total: 25, right: 12, points: 13.5, blank: 1, secs: 1500 }],
    },
  };
  const file = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) };
  await page.locator('#open-settings').click();
  await page.locator('#import-file').setInputFiles(file);
  await expect(page.locator('#toast')).toContainText('新增 1 題、更新 0 題的紀錄，也併入了闖關進度與模擬考成績');
  const s = await page.evaluate(() => JSON.parse(localStorage.getItem('gsat-quiz:v1')));
  expect(Object.keys(s.cards)).toEqual(['math-001']);
  expect(s.path.math.cleared).toEqual(['數與式']);
  expect(s.examLog).toHaveLength(1);

  await page.locator('#import-file').setInputFiles(file);
  await expect(page.locator('#toast')).toContainText('沒有比這台更新的紀錄');
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('gsat-quiz:v1')))).examLog).toHaveLength(1);
});
