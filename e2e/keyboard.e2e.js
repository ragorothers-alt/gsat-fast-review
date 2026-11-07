// 鍵盤與螢幕閱讀器：面板的焦點、作答後的 Enter、念出作答結果、重點卡練別科的單元
import { expect, openHome, skipToSingle, startMode, test } from './fixtures.js';

test('設定面板：焦點移進面板、背景按不到，Esc 關閉後焦點回到齒輪', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-settings').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#settings-sheet')).toBeVisible();
  expect(await page.evaluate(() => !!document.activeElement.closest('#settings-sheet'))).toBe(true);
  // 往前、往後按 Tab 都不會跑到背景的首頁
  for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab']) {
    await page.keyboard.press(key);
    expect(await page.evaluate(() => !document.activeElement.closest('#home'))).toBe(true);
  }
  expect(await page.locator('#home').evaluate((el) => !!el.closest('[inert]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-sheet')).toBeHidden();
  await expect(page.locator('#open-settings')).toBeFocused();
  expect(await page.locator('#home').evaluate((el) => !!el.closest('[inert]'))).toBe(false);
});

test('答對後用鍵盤按「猜對的」：按鈕作用，不會直接換到下一題；結果念得出來', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'free');
  for (let i = 0; i < 40; i++) {
    await skipToSingle(page);
    await page.locator('#answers .answer').first().click();
    if (await page.locator('#certain').isVisible()) break;
    await expect(page.locator('#answer-status')).toContainText('正解是');
    await page.locator('#next').click();
  }
  await expect(page.locator('#answer-status')).toHaveText('答對！');
  const progress = await page.locator('#play-progress').textContent();
  await page.locator('#guess').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#guess')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#play-progress')).toHaveText(progress);
  // 焦點在「繼續」上按 Enter 才換題
  await page.locator('#next').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#play-progress')).not.toHaveText(progress);
});

test('重點卡的「練這個單元」：首頁沒選的科目也出得了題', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('gsat-quiz:v1')) localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, settings: { subjects: ['english'] } }));
  });
  await openHome(page);
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="cards"]').click();
  await page.locator('#notebook-list .kp-unit', { hasText: '多項式' }).first().click();
  await expect(page.locator('#keypoints-sheet')).toBeVisible();
  await page.locator('#kp-train').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#q-subject')).toHaveText('數學');
});

test('疊在單元面板上的重點卡：Esc 只關上面那層', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-units').click();
  await expect(page.locator('#units-sheet')).toBeVisible();
  await page.locator('#units-list .kp-btn').first().click();
  await expect(page.locator('#keypoints-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#keypoints-sheet')).toBeHidden();
  await expect(page.locator('#units-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#units-sheet')).toBeHidden();
});
