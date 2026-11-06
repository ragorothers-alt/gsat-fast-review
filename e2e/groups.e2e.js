// 閱讀題組：文章框、克漏字空格、同組接著出、展開文章、結算畫面的文章
import { audit, expect, openHome, test } from './fixtures.js';

// 英文克漏字（一篇 5 個空格）與國文現代文題組
const CLOZE = { group: 'english-g001', size: 5 };
const READING = { group: 'chinese-g001' };

/** 從錯題本搜尋題組代號，練這一組 */
async function practiceGroup(page, group, size) {
  await openHome(page);
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="search"]').click();
  await page.locator('#notebook-search').fill(group);
  if (size) await expect(page.locator('#notebook-count')).toHaveText(String(size));
  else await expect(page.locator('#notebook-list .r-passage').first()).toBeVisible();
  await page.locator('#notebook-train').click();
  await expect(page.locator('#play')).toBeVisible();
}

test('克漏字題組：文章在題目上方，這題問的空格塗上螢光；同組接著出，文章不重畫', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await practiceGroup(page, CLOZE.group, CLOZE.size);
  const passage = page.locator('#q-passage');
  await expect(passage).toBeVisible();
  await expect(page.locator('#q-topic')).toContainText(`題組 1／${CLOZE.size}`);
  await expect(passage.locator('.blank')).toHaveCount(CLOZE.size);
  await expect(passage.locator('.blank.on')).toHaveText(/空格\s*1/);
  await expect(page.locator('#q-text .blank')).toHaveText(/空格\s*1/);
  // 題組不念英文（文章太長）、不出現發音鈕
  await expect(page.locator('#speak')).toBeHidden();
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `克漏字題組（${scheme}）`);
  }

  // 看解答再繼續：下一題是同組的第 2 格，文章框還是同一篇（沒有重畫）
  await passage.evaluate((el) => (el.dataset.marker = 'same'));
  await page.locator('#skip').click();
  await page.locator('#next').click();
  await expect(page.locator('#q-topic')).toContainText(`題組 2／${CLOZE.size}`);
  await expect(passage).toHaveAttribute('data-marker', 'same');
  await expect(passage.locator('.blank.on')).toHaveText(/空格\s*2/);
  // 空格捲到文章框看得見的地方
  await expect
    .poll(() =>
      passage.evaluate((box) => {
        const on = box.querySelector('.blank.on').getBoundingClientRect();
        const r = box.getBoundingClientRect();
        return on.top >= r.top && on.bottom <= r.bottom;
      }),
    )
    .toBe(true);

  // 展開文章：選項收起來、文章占滿題目卡；再按一次回到題目
  await page.locator('#read-full').click();
  await expect(page.locator('#answers')).toBeHidden();
  await expect(page.locator('#skip')).toBeHidden();
  await expect(page.locator('#read-full')).toHaveAttribute('aria-pressed', 'true');
  await audit(page, '展開文章');
  await page.locator('#read-full').click();
  await expect(page.locator('#answers .answer')).toHaveCount(4);

  // 做完這組：結算畫面每題都能展開文章，克漏字標出那一題的空格
  for (let i = 2; i <= CLOZE.size; i++) {
    await page.locator('#skip').click();
    await page.locator('#next').click();
  }
  await expect(page.locator('#result')).toBeVisible();
  const details = page.locator('#r-list .r-passage');
  await expect(details).toHaveCount(CLOZE.size);
  await details.nth(2).locator('summary').click();
  await expect(details.nth(2).locator('.passage-body')).toBeVisible();
  await expect(details.nth(2).locator('.blank.on')).toHaveText(/空格\s*3/);
  await audit(page, '結算畫面的題組文章');
});

test('國文題組：回看上一題時文章收在可以展開的區塊', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await practiceGroup(page, READING.group);
  await expect(page.locator('#q-passage')).toBeVisible();
  await expect(page.locator('#q-passage .blank')).toHaveCount(0);
  await expect(page.locator('#q-topic')).toContainText('題組 1／');
  const text = await page.locator('#q-passage').innerText();

  await page.locator('#skip').click();
  await page.locator('#next').click();
  await expect(page.locator('#q-topic')).toContainText('題組 2／');
  // 回看上一題：文章收在可以展開的區塊
  await page.locator('#back').click();
  await expect(page.locator('#past-card .r-passage')).toBeVisible();
  await page.locator('#past-card .r-passage summary').click();
  // 分段的換行不比，只比文字
  await expect(page.locator('#past-card .passage-body')).toContainText(text.replace(/\s+/g, '').slice(0, 12));
  await audit(page, '回看上一題的題組文章');
  await page.locator('#past-back').click();
  await expect(page.locator('#past-sheet')).toBeHidden();
  await expect(page.locator('#q-topic')).toContainText('題組 2／');
});

test('模擬考：國文卷、英文卷標出含幾組閱讀題組', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-exam').click();
  await expect(page.locator('li:has([data-paper="english"]) .exam-paper-meta')).toContainText('含 2 組閱讀題組');
  await expect(page.locator('li:has([data-paper="chinese"]) .exam-paper-meta')).toContainText('含 3 組閱讀題組');
  await expect(page.locator('li:has([data-paper="math"]) .exam-paper-meta')).not.toContainText('題組');
});
