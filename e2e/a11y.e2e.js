// 無障礙檢查（axe）：各畫面在淺色、深色下都不能有 serious／critical 等級的問題
import AxeBuilder from '@axe-core/playwright';
import { expect, openHome, skipToResult, startMode, test } from './fixtures.js';

/** 只看嚴重的問題；3D 畫布是裝飾（aria-hidden），不檢查 */
async function audit(page, where) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('#world').analyze();
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${where}｜${v.id}：${v.help}\n${v.nodes.slice(0, 5).map((n) => `  ${n.target.join(' ')}｜${n.failureSummary?.split('\n').slice(1, 2).join('')}`).join('\n')}`);
  expect(serious, serious.join('\n\n')).toEqual([]);
}

for (const scheme of ['light', 'dark']) {
  test(`各畫面沒有嚴重的無障礙問題（${scheme === 'light' ? '淺色' : '深色'}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openHome(page);
    await audit(page, '首頁');

    await startMode(page, 'ten');
    await audit(page, '作答');
    await page.locator('#skip').click();
    await audit(page, '看解答');
    await page.locator('#next').click();
    await skipToResult(page);
    await audit(page, '結算');

    await page.locator('#r-home').click();
    await page.locator('#open-notebook').click();
    await audit(page, '錯題本');
    await page.locator('#notebook-views [data-view="cards"]').click();
    await page.locator('#notebook-list .kp-unit').first().click();
    await expect(page.locator('#kp-status')).toBeHidden();
    await audit(page, '考前重點卡');
    await page.locator('#kp-close').click();
    await page.locator('#notebook-back').click();

    await page.locator('#open-settings').click();
    await audit(page, '設定');
    await page.locator('#settings-close').click();

    await page.locator('#open-path').click();
    await audit(page, '單元闖關');
  });
}

// 隨機抽到的題目不一定有公式選項，這裡固定練一題四個選項都是公式的
test('只有公式的選項，螢幕閱讀器也念得出來', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="search"]').click();
  await page.locator('#notebook-search').fill('math-685');
  await expect(page.locator('#notebook-count')).toHaveText('1');
  await page.locator('#notebook-train').click();
  await expect(page.locator('#play')).toBeVisible();
  for (const name of ['(3ⁿ⁻¹)/(3ⁿ−1)', '(2⋅3ⁿ⁻¹)/(3ⁿ−1)', '(2⋅3ⁿ)/(3ⁿ−1)', '(3ⁿ−1)/(2⋅3ⁿ⁻¹)']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await audit(page, '公式選項');
});
