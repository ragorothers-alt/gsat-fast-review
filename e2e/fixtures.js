// 共用的測試前置：擋掉同步後端（測試不能寫到正式資料庫，錯誤回報也不能送出去），
// 並記下頁面上的未捕捉錯誤，每個測試結束時必須是零。
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // 固定亂數種子：每次跑都出同一批題目、同樣的選項順序，無障礙檢查掃到的畫面一樣，失敗才重現得出來
    await page.addInitScript(() => {
      let seed = 20261104;
      Math.random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    await page.route('https://gsat-sync.ragorothers.workers.dev/**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"blocked in e2e"}' }),
    );
    await use(page);
    expect(errors, '頁面上不該有未捕捉的錯誤').toEqual([]);
  },
});

export { expect };

/** 等題庫載入完成：題庫有兩萬多題，平行跑的測試一起下載、解析時會超過預設的 10 秒，所以放寬 */
export async function waitForBoot(page) {
  await expect(page.locator('#boot')).toBeHidden({ timeout: 30_000 });
}

/** 開首頁並等題庫載入完成 */
export async function openHome(page) {
  await page.goto('./');
  await waitForBoot(page);
  await expect(page.locator('#home')).toBeVisible();
}

/** 從首頁開始一個模式 */
export async function startMode(page, mode) {
  await page.locator(`[data-mode="${mode}"]`).click();
  await expect(page.locator('#play')).toBeVisible();
}

/** 按「不會？看解答」再按「繼續」，一題一題看完直到結算 */
export async function skipToResult(page, max = 30) {
  for (let i = 0; i < max; i++) {
    if (await page.locator('#result').isVisible()) return;
    await page.locator('#skip').click();
    await page.locator('#next').click();
  }
  await expect(page.locator('#result')).toBeVisible();
}

/** 每題都點第一個選項作答（答錯就按「繼續」），直到結算 */
export async function answerToResult(page, max = 30) {
  for (let i = 0; i < max; i++) {
    if (await page.locator('#result').isVisible()) return;
    const progress = await page.locator('#play-progress').textContent();
    await page.locator('#answers .answer').first().click();
    // 答對會自己換下一題；答錯或要看解析時等「繼續」出現
    await page.waitForFunction(
      (p) => !document.querySelector('#next').hidden || document.querySelector('#play').hidden || document.querySelector('#play-progress').textContent !== p,
      progress,
    );
    if (await page.locator('#next').isVisible()) await page.locator('#next').click();
  }
  await expect(page.locator('#result')).toBeVisible();
}
