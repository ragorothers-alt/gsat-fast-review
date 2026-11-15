// 更新說明：舊使用者換上新版後開機跳出一次（只列沒看過的），按「知道了」就不再跳；設定的「更新紀錄」看得到全部；新使用者不跳
import { NEWS, latestNews } from '../src/news.js';
import { audit, expect, openHome, seedVeteran, test, waitForBoot } from './fixtures.js';

test('舊使用者：開機跳出沒看過的更新，知道了之後不再跳；設定裡的更新紀錄列出全部', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedVeteran(page);
  // 只在第一次載入時把「看到哪裡」改成很舊的一筆（測試共用的設定會記成全部看過）；重新整理後就照 App 自己存的
  await page.addInitScript(() => {
    if (sessionStorage.getItem('news-test')) return;
    sessionStorage.setItem('news-test', '1');
    localStorage.setItem('gsat-quiz:news', '2000-01-01-1');
  });
  await openHome(page);
  const sheet = page.locator('#news-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#news-title')).toHaveText('更新說明');
  await expect(page.locator('#news-list .news-item')).toHaveCount(NEWS.length);
  await expect(page.locator('#news-list .news-item h3').first()).toContainText(NEWS[0].title);
  await expect(page.locator('#news-list .news-item').first().locator('li')).toHaveCount(NEWS[0].items.length);
  await audit(page, '更新說明');

  await page.locator('#news-ok').click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('gsat-quiz:news'))).toBe(latestNews());

  // 重新整理：看過了，不再跳
  await page.reload();
  await waitForBoot(page);
  await expect(page.locator('#home')).toBeVisible();
  await expect(sheet).toBeHidden();

  // 設定 → 更新紀錄：全部列出
  await page.locator('#open-settings').click();
  await page.locator('#open-news').click();
  await expect(sheet).toBeVisible();
  await expect(page.locator('#news-list .news-item')).toHaveCount(NEWS.length);
  await page.locator('#news-close').click();
  await expect(sheet).toBeHidden();
});

test.describe('新使用者', () => {
  test.use({ welcome: true });

  test('第一次開啟只出現設定、不跳更新說明，並記成全部看過', async ({ page }) => {
    await openHome(page);
    await expect(page.locator('#welcome-sheet')).toBeVisible();
    await expect(page.locator('#news-sheet')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('gsat-quiz:news'))).toBe(latestNews());
  });
});
