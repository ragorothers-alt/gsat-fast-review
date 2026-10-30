// 主要流程：首頁、作答到結算、收藏與搜尋、設定、手機橫放、離線開啟
import { answerToResult, expect, openHome, skipToResult, startMode, test } from './fixtures.js';

test('首頁載入題庫，十個科目都在', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#subject-chips .chip')).toHaveCount(10);
  await expect(page.locator('#bank-info')).toContainText(/題庫共 \d+ 題/);
});

test('10 題一輪：作答到結算，算進今日進度', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'ten');
  await expect(page.locator('#play-progress')).toHaveText('1 / 10');
  await answerToResult(page);
  await expect(page.locator('#r-mode')).toHaveText('10 題一輪');
  await page.locator('#r-home').click();
  await expect(page.locator('#daily-count')).toHaveText('10');
});

test('只看解答不作答：結算列出全部題目，但不算進今日題數', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'ten');
  await skipToResult(page);
  await expect(page.locator('#r-list .r-item')).toHaveCount(10);
  await page.locator('#r-home').click();
  await expect(page.locator('#daily-count')).toHaveText('0');
});

test('單選題點選項作答，答對或答錯都有回饋', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'free');
  const first = page.locator('#answers .answer').first();
  await first.click();
  // 答對會蓋上圈、答錯會蓋上叉，正解一定會標出來
  await expect(page.locator('#answers .answer.correct')).toHaveCount(1);
  await expect(page.locator('#q-explain')).toBeVisible();
});

test('收藏的題目出現在錯題本的「收藏」，搜尋找得到並能練一輪', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'ten');
  const subject = await page.locator('#q-subject').textContent();
  await page.locator('#star').click();
  await expect(page.locator('#star')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#quit').click();

  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="star"]').click();
  await expect(page.locator('#notebook-list .r-item')).toHaveCount(1);
  await expect(page.locator('#notebook-list .tag')).toHaveText(subject);

  await page.locator('#notebook-views [data-view="search"]').click();
  await page.locator('#notebook-search').fill('H2O');
  await expect(page.locator('#notebook-count')).not.toHaveText('0');
  await page.locator('#notebook-train').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play-progress')).toHaveText(/^1 \/ \d+$/);
});

test('設定：深色模式與字體大小，重新整理後還在', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-settings').click();
  await page.locator('#theme-options button', { hasText: '深色' }).click();
  await page.locator('#font-options button', { hasText: '特大' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('#boot')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim())).toBe('1.25');
});

test('手機橫放：首頁不用捲動，作答時題目在左、選項在右', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', '只看手機');
  await page.setViewportSize({ width: 844, height: 390 });
  await openHome(page);
  const home = page.locator('#home');
  expect(await home.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
  await startMode(page, 'ten');
  const card = await page.locator('#card').boundingBox();
  const answers = await page.locator('#answers').boundingBox();
  expect(answers.x).toBeGreaterThan(card.x + card.width);
});

test('裝好離線快取後，斷網也能開', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.route('https://gsat-sync.ragorothers.workers.dev/**', (route) => route.abort());
  await page.goto('./');
  await expect(page.locator('#boot')).toBeHidden();
  // 等 service worker 把所有檔案存進快取並接手這個頁面
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#boot')).toBeHidden();
  await expect(page.locator('#subject-chips .chip')).toHaveCount(10);
  await page.locator('[data-mode="ten"]').click();
  await expect(page.locator('#play')).toBeVisible();
  await context.close();
});

test('考前重點卡：從錯題本的「重點」打開，能翻單元、直接練這個單元', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="cards"]').click();
  const first = page.locator('#notebook-list .kp-unit').first();
  const unit = await first.locator('.kp-unit-name').textContent();
  await first.click();
  await expect(page.locator('#keypoints-sheet')).toBeVisible();
  await expect(page.locator('#kp-unit')).toHaveText(unit);
  await expect(page.locator('#kp-prev')).toBeDisabled();
  await page.locator('#kp-next').click();
  await expect(page.locator('#kp-unit')).not.toHaveText(unit);
  await page.locator('#kp-train').click();
  await expect(page.locator('#keypoints-sheet')).toBeHidden();
  await expect(page.locator('#play')).toBeVisible();
});
