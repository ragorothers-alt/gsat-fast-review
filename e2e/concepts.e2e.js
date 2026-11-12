// 考點：作答後標在解析旁、重點卡面板列出單元的考點與練過的狀態、學習分析各科練過幾個
import { audit, expect, openHome, startMode, test, waitForBoot } from './fixtures.js';

/** el 有沒有整個在 box 裡面（左右） */
const inside = (a, b) => a.x >= b.x - 0.5 && a.x + a.width <= b.x + b.width + 0.5;

test('考點：作答前不顯示，看解析時標在標題旁；重點卡面板把這個考點標成有錯題、其餘還沒練', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  await startMode(page, 'free');
  // 跨單元綜合的題目借用別的單元的考點、探究與實作好幾科都有：換到一般單元的題目，等一下才找得到它的重點卡
  let unit = '';
  // 跳過的跨單元題借用的考點（可能在別的單元）：之後翻到那些單元時會標成有錯題
  const borrowed = [];
  for (let i = 0; i < 20; i++) {
    await expect(page.locator('#q-text')).toBeVisible();
    unit = (await page.locator('#q-topic .topic-name').textContent()).trim();
    if (!/跨單元|探究與實作/.test(unit)) break;
    await page.locator('#skip').click();
    borrowed.push((await page.locator('#q-explain .kp-tag').textContent()).replace('考點：', ''));
    await page.locator('#next').click();
  }
  const subject = (await page.locator('#q-subject').textContent()).trim();
  // 作答前不透露考點（考點名稱常常就是解題的提示）
  await expect(page.locator('.kp-tag')).toHaveCount(0);
  await page.locator('#skip').click();
  const tag = page.locator('#q-explain .kp-tag');
  await expect(tag).toHaveText(/^考點：.{2,14}$/);
  const name = (await tag.textContent()).replace('考點：', '');
  expect(inside(await tag.boundingBox(), await page.locator('#q-explain').boundingBox()), '考點標籤不超出解析框').toBe(true);
  await audit(page, '解析上的考點');

  // 重新整理後從單元面板打開這個單元的重點卡
  await page.reload();
  await waitForBoot(page);
  await page.locator('#open-units').click();
  await page.locator('#units-tabs button', { hasText: subject }).click();
  await page.locator(`#units-list .kp-btn[aria-label="${unit}：考前重點"]`).click();
  await expect(page.locator('#keypoints-sheet')).toBeVisible();
  await expect(page.locator('#kp-unit')).toHaveText(unit);
  await expect(page.locator('#kp-concepts')).toBeVisible();
  const total = Number((await page.locator('#kp-concepts-n').textContent()).match(/練過 1／(\d+)/)?.[1]);
  expect(total).toBeGreaterThanOrEqual(5);
  await expect(page.locator('#kp-meta')).toContainText(`考點 1／${total}`);
  const chips = page.locator('#kp-concept-list .kp-chip');
  await expect(chips).toHaveCount(total);
  await expect(page.locator('#kp-concept-list .kp-chip.weak .kp-chip-name')).toHaveText(name);
  await expect(page.locator('#kp-concept-list .kp-chip.weak .kp-chip-n')).toHaveText(/^錯題 1・練過 1／\d+$/);
  await expect(page.locator('#kp-concept-list .kp-chip.todo')).toHaveCount(total - 1);
  await expect(page.locator('#kp-concept-list .kp-chip.todo .kp-chip-n').first()).toHaveText(/^還沒練・\d+ 題$/);
  // 兩欄排、不超出面板
  const list = await page.locator('#kp-concept-list').boundingBox();
  for (const box of await chips.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()))) expect(inside(box, list)).toBe(true);
  await page.locator('#kp-concepts').scrollIntoViewIfNeeded();
  await audit(page, '重點卡面板的考點');

  // 翻到下一個單元：考點跟著換；有錯題的只會是前面跳過的跨單元題借用的考點
  const names = () => page.locator('#kp-concept-list .kp-chip-name').allTextContents();
  const before = (await names()).join('|');
  await page.locator('#kp-next').click();
  await expect(page.locator('#kp-unit')).not.toHaveText(unit);
  // 等清單換成下一個單元的考點再看（不同單元可能有同名的考點，所以比整份清單）；
  // 下一個單元是沒有自己考點的跨單元綜合時，考點區塊整個收起來
  const box = page.locator('#kp-concepts');
  await expect.poll(async () => !(await box.isVisible()) || (await names()).join('|') !== before).toBe(true);
  if (await box.isVisible()) for (const weak of await page.locator('#kp-concept-list .kp-chip.weak .kp-chip-name').allTextContents()) expect(borrowed).toContain(weak);
});

test('學習分析：各科寫出練過幾個考點；320 寬也不超出', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'free');
  await page.locator('#skip').click();
  await expect(page.locator('#q-explain .kp-tag')).toBeVisible();
  await page.reload();
  await waitForBoot(page);
  for (const width of [null, 320]) {
    if (width) await page.setViewportSize({ width, height: 640 });
    await page.locator('#daily').click();
    await expect(page.locator('#stats-subjects li')).toHaveCount(10, { timeout: 30_000 });
    const kp = page.locator('#stats-subjects .subject-kp');
    await expect(kp).toHaveCount(10);
    await expect(kp.first()).toHaveText(/^考點 \d+／\d+$/);
    // 剛剛練了一題：有一科練過 1 個考點，其他科是 0
    const texts = await kp.allTextContents();
    expect(texts.filter((t) => /^考點 1／/.test(t))).toHaveLength(1);
    expect(texts.filter((t) => /^考點 0／/.test(t))).toHaveLength(9);
    const rows = await page.locator('#stats-subjects li').evaluateAll((els) =>
      els.map((li) => ({ row: li.getBoundingClientRect().toJSON(), kp: li.querySelector('.subject-kp').getBoundingClientRect().toJSON() })),
    );
    for (const r of rows) expect(inside(r.kp, r.row), `寬 ${width ?? '預設'}`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#stats-back').click();
    await expect(page.locator('#home')).toBeVisible();
  }
});

/** 自由練習：跳過跨單元題，對第一道一般單元的題目按「不會」，回傳它的科目、單元與考點名稱 */
async function missOne(page) {
  await openHome(page);
  await startMode(page, 'free');
  for (let i = 0; i < 20; i++) {
    await expect(page.locator('#q-text')).toBeVisible();
    const unit = (await page.locator('#q-topic .topic-name').textContent()).trim();
    await page.locator('#skip').click();
    const name = (await page.locator('#q-explain .kp-tag').textContent()).replace('考點：', '');
    if (!/跨單元|探究與實作/.test(unit)) return { unit, name, subject: (await page.locator('#q-subject').textContent()).trim() };
    await page.locator('#next').click();
  }
  throw new Error('連續 20 題都是跨單元題');
}

/** 「練這個考點」這一輪：前兩題（按「不會」看解答）都標著同一個考點 */
async function expectConceptRound(page, name) {
  await expect(page.locator('#play')).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('#q-text')).toBeVisible();
    await page.locator('#skip').click();
    await expect(page.locator('#q-explain .kp-tag')).toHaveText(`考點：${name}`);
    await page.locator('#next').click();
  }
}

test('重點卡的考點可以點：只練這個考點，錯題先出', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { unit, name, subject } = await missOne(page);
  await page.reload();
  await waitForBoot(page);
  await page.locator('#open-units').click();
  await page.locator('#units-tabs button', { hasText: subject }).click();
  await page.locator(`#units-list .kp-btn[aria-label="${unit}：考前重點"]`).click();
  const chip = page.locator('#kp-concept-list .kp-chip.weak');
  // 螢幕閱讀器念的名稱：「練這個考點：名稱，進度」（區塊之間瀏覽器會補空白）
  await expect(chip).toHaveAccessibleName(new RegExp(`^練這個考點：\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*，\\s*錯題 1`));
  await audit(page, '考點按鈕');
  await chip.click();
  await expect(page.locator('#keypoints-sheet')).toBeHidden();
  // 第一題就是剛剛不會的那題（錯題先出），接著是同考點的其他題
  await expectConceptRound(page, name);
});

test('結算畫面與錯題本：正解旁標出考點，點了只練那個考點', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { name } = await missOne(page);
  // 這輪只做了這幾題就結束：結算畫面列出不會的題目，正解旁有考點
  await page.locator('#quit').click();
  await expect(page.locator('#result')).toBeVisible();
  const tag = page.locator('#r-list .kp-link').last();
  await expect(tag).toHaveText(`考點：${name}`);
  await audit(page, '結算畫面的考點');
  // 錯題本裡也有，點了開一輪只練這個考點
  await page.locator('#r-home').click();
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="wrong"]').click();
  const nb = page.locator('#notebook-list .kp-link', { hasText: `考點：${name}` }).first();
  await expect(nb).toBeVisible();
  await nb.click();
  await expectConceptRound(page, name);
});

test('學習分析的弱點考點：列出有錯題的考點，點了只練那個考點', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { name } = await missOne(page);
  await page.reload();
  await waitForBoot(page);
  await page.locator('#daily').click();
  const box = page.locator('#stats-weak-kp');
  await expect(box).toBeVisible({ timeout: 30_000 });
  await expect(box.locator('.weak-name')).toHaveText([name]);
  await expect(box.locator('.weak-meta')).toHaveText('錯題 1 題・失誤 100%');
  await box.scrollIntoViewIfNeeded();
  await audit(page, '弱點考點');
  await box.locator('.weak-kp').click();
  await expectConceptRound(page, name);
});
