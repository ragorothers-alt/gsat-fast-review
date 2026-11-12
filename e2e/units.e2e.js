// 選單元：數學分頁上方選考數學 A 還是 B，一次關掉只有另一份才考的單元
import { audit, expect, openHome, test, waitForBoot } from './fixtures.js';

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gsat-quiz:v1')));

test('選單元的數學分頁：數學 A 關掉數B 專屬主題、數學 B 關掉空間向量，其他單元不動；別科不顯示；重新整理後還在', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  await page.locator('#open-units').click();
  const box = page.locator('#units-math');
  const seg = page.locator('#units-math-seg');
  const pressed = seg.locator('[aria-pressed="true"]');
  const unit = (name) => page.locator('#units-list .unit', { has: page.locator('.unit-name', { hasText: name }) });
  await page.locator('#units-tabs button', { hasText: '國文' }).click();
  await expect(box).toBeHidden();
  await page.locator('#units-tabs button', { hasText: '數學' }).click();
  await expect(box).toBeVisible();
  await expect(seg.locator('.seg-btn')).toHaveText(['數學 A', '數學 B', '都考']);
  await expect(seg).toHaveAccessibleName('數學考哪一份？');
  await expect(pressed).toHaveText('都考');

  // 先自己關掉一個無關的單元：換數學 A、B 都不會動到它
  await unit('矩陣').click();
  await expect(unit('矩陣')).toHaveAttribute('aria-pressed', 'false');
  await seg.locator('button', { hasText: '數學 A' }).click();
  await expect(pressed).toHaveText('數學 A');
  await expect(unit('數B 專屬主題')).toHaveAttribute('aria-pressed', 'false');
  await expect(unit('空間向量與平面直線')).toHaveAttribute('aria-pressed', 'true');
  await expect(unit('矩陣')).toHaveAttribute('aria-pressed', 'false');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `選單元：數學考哪一份（${scheme}）`);
  }

  await seg.locator('button', { hasText: '數學 B' }).click();
  await expect(pressed).toHaveText('數學 B');
  await expect(unit('數B 專屬主題')).toHaveAttribute('aria-pressed', 'true');
  await expect(unit('空間向量與平面直線')).toHaveAttribute('aria-pressed', 'false');
  expect([...(await saved(page)).settings.excludedUnits].sort()).toEqual(['math/矩陣', 'math/空間向量與平面直線'].sort());

  // 自己把空間向量勾回來：兩個都開著就是都考；兩個都關掉不是任何一份
  await unit('空間向量與平面直線').click();
  await expect(pressed).toHaveText('都考');
  await unit('空間向量與平面直線').click();
  await unit('數B 專屬主題').click();
  await expect(pressed).toHaveCount(0);

  // 重新整理後還在
  await seg.locator('button', { hasText: '數學 A' }).click();
  await page.reload();
  await waitForBoot(page);
  await page.locator('#open-units').click();
  await page.locator('#units-tabs button', { hasText: '數學' }).click();
  await expect(pressed).toHaveText('數學 A');
  await expect(unit('數B 專屬主題')).toHaveAttribute('aria-pressed', 'false');
});

test('數學沒選時按數學 A：數學一起選上，只關數B 專屬主題', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('gsat-quiz:v1')) localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, settings: { subjects: ['chinese', 'english'] } }));
  });
  await openHome(page);
  await page.locator('#open-units').click();
  await page.locator('#units-tabs button', { hasText: '數學' }).click();
  await expect(page.locator('#units-list .unit[aria-pressed="true"]')).toHaveCount(0);
  await page.locator('#units-math-seg button', { hasText: '數學 A' }).click();
  await expect(page.locator('#units-list .unit[aria-pressed="false"] .unit-name')).toHaveText(['數B 專屬主題']);
  expect((await saved(page)).settings).toMatchObject({ subjects: ['chinese', 'english', 'math'], excludedUnits: ['math/數B 專屬主題'] });
});

test('數學考哪一份在 320 寬一行放得下，按鈕文字不被截', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openHome(page);
  await page.locator('#open-units').click();
  await page.locator('#units-tabs button', { hasText: '數學' }).click();
  const m = await page.evaluate(() => {
    const row = document.querySelector('#units-math .math-exam').getBoundingClientRect();
    const body = document.querySelector('#units-sheet .sheet-body').getBoundingClientRect();
    const label = document.querySelector('#units-math-label').getBoundingClientRect();
    const btns = [...document.querySelectorAll('#units-math-seg .seg-btn')];
    const rects = btns.map((b) => b.getBoundingClientRect());
    return {
      rowRight: row.right,
      bodyRight: body.right,
      oneRow: new Set(rects.map((r) => Math.round(r.top))).size === 1 && rects.every((r) => r.top < label.bottom && r.bottom > label.top && r.left >= label.right),
      clipped: btns.filter((b) => b.scrollWidth > b.clientWidth).map((b) => b.textContent),
      pageWidth: document.documentElement.scrollWidth,
    };
  });
  expect(m.rowRight).toBeLessThanOrEqual(m.bodyRight);
  expect(m.oneRow, '標籤和三個按鈕排在同一行').toBe(true);
  expect(m.clipped).toEqual([]);
  expect(m.pageWidth).toBeLessThanOrEqual(320);
});
