// 草稿區：復原與重做、長草稿紙往下捲、停住拉直線、模擬考每題一頁
import { audit, expect, openHome, startMode, test } from './fixtures.js';

const KEY = 'gsat-quiz:v1';

/** 拉出草稿區（平板、桌機可能已經開著）。拉出來後題目卡會縮小、版面重排一次（約 50ms），等畫布位置穩定再畫 */
async function openScratch(page) {
  if (!(await page.locator('#play').evaluate((p) => p.classList.contains('scratch-open')))) await page.locator('#scratch-toggle').click();
  await expect(page.locator('#scratch-canvas')).toBeVisible();
  let last = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await page.locator('#scratch-canvas').boundingBox());
        const same = now === last;
        last = now;
        return same;
      },
      { intervals: [120] },
    )
    .toBe(true);
}

/** 手機上草稿區拉出來時蓋住選項與換題列：按「作答 ›」收起（平板、桌機並排，不用收） */
async function backToAnswers(page) {
  const close = page.locator('#scratch-close');
  if ((await close.isVisible()) && (await close.textContent()).includes('作答')) await close.click();
}

/** 畫布上有墨水的像素數；rect = [x, y, w, h]（CSS px）只算那一塊 */
const inked = (page, rect) =>
  page.locator('#scratch-canvas').evaluate((c, rect) => {
    const k = c.width / c.getBoundingClientRect().width;
    const [x, y, w, h] = rect ? rect.map((v) => Math.round(v * k)) : [0, 0, c.width, c.height];
    const d = c.getContext('2d').getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  }, rect);

/** 用滑鼠在畫布上畫一筆（畫布內的座標） */
async function draw(page, [x0, y0], [x1, y1], steps = 8) {
  const b = await page.locator('#scratch-canvas').boundingBox();
  await page.mouse.move(b.x + x0, b.y + y0);
  await page.mouse.down();
  await page.mouse.move(b.x + x1, b.y + y1, { steps });
  await page.mouse.up();
}

/** 從上寫到下，寫滿這一頁 */
async function fillPage(page) {
  const { height } = await page.locator('#scratch-canvas').boundingBox();
  for (let y = 24; y < height - 16; y += 44) await draw(page, [20, y], [160, y + 4], 4);
}

const gridY = (page) => page.locator('#scratch-sheet').evaluate((s) => parseFloat(s.style.backgroundPosition.split(' ')[1] || '0'));

/** 按 ↑ 直到捲回頂端（到頂之後 ↑ 不能按） */
async function scrollToTop(page) {
  for (let i = 0; i < 6 && (await page.locator('#scratch-up').isEnabled()); i++) await page.locator('#scratch-up').click();
  await expect.poll(() => gridY(page)).toBe(0);
}

/** 整頁重畫和邊畫邊顯示的反鋸齒可能差幾個像素 */
const near = (a, b) => expect(Math.abs(a - b), `${a} 和 ${b} 差太多`).toBeLessThanOrEqual(Math.max(8, b * 0.02));

test('草稿區：畫一筆可以復原、重做，清空也能復原；工具列在 360 寬的手機放得下', async ({ page }, info) => {
  if (info.project.name === 'phone') await page.setViewportSize({ width: 360, height: 640 });
  await openHome(page);
  await startMode(page, 'free');
  await openScratch(page);
  // 空白頁：有提示，復原、重做、清空都不能按
  await expect(page.locator('#scratch-hint')).toBeVisible();
  for (const id of ['#scratch-undo', '#scratch-redo', '#scratch-clear']) await expect(page.locator(id)).toBeDisabled();
  const fits = await page.locator('.scratch-bar').evaluate((bar) => bar.scrollWidth <= bar.clientWidth && [...bar.querySelectorAll('button')].every((b) => b.getBoundingClientRect().right <= innerWidth));
  expect(fits, '草稿區的工具列沒有被擠出畫面').toBe(true);

  await draw(page, [30, 40], [200, 90]);
  expect(await inked(page)).toBeGreaterThan(0);
  await expect(page.locator('#scratch-hint')).toBeHidden();
  await page.locator('#scratch-undo').click();
  expect(await inked(page)).toBe(0);
  await page.locator('#scratch-redo').click();
  expect(await inked(page)).toBeGreaterThan(0);
  await expect(page.locator('#scratch-redo')).toBeDisabled();

  await page.locator('#scratch-clear').click();
  expect(await inked(page)).toBe(0);
  await page.locator('#scratch-undo').click();
  expect(await inked(page)).toBeGreaterThan(0);
  // 鍵盤：Ctrl+Z 復原、Ctrl+Shift+Z 重做
  await page.keyboard.press('Control+z');
  expect(await inked(page)).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  expect(await inked(page)).toBeGreaterThan(0);
});

for (const scheme of ['light', 'dark']) {
  test(`草稿區寫滿、出現捲動箭頭時沒有嚴重的無障礙問題（${scheme === 'light' ? '淺色' : '深色'}）`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openHome(page);
    await startMode(page, 'free');
    await openScratch(page);
    await fillPage(page);
    await expect(page.locator('#scratch-nav')).toBeVisible();
    await audit(page, '草稿區');
  });
}

test('長草稿紙：寫到下半部後可以往下捲，格線跟著捲、捲回頂端字還在；滾輪與兩指拖動也能捲', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  await startMode(page, 'free');
  await openScratch(page);
  // 只寫在上半部：還不能捲
  await draw(page, [20, 30], [160, 34]);
  await expect(page.locator('#scratch-nav')).toBeHidden();

  await fillPage(page);
  await expect(page.locator('#scratch-nav')).toBeVisible();
  await expect(page.locator('#scratch-up')).toBeDisabled();
  const top = await inked(page, [0, 0, 200, 60]);
  await page.locator('#scratch-down').click();
  await expect.poll(() => gridY(page)).toBeLessThan(0);
  await expect(page.locator('#scratch-up')).toBeEnabled();
  // 捲下去之後在空出來的地方寫字，捲回頂端：原本頂端的字還在，剛寫的字不在畫面上
  const { height } = await page.locator('#scratch-canvas').boundingBox();
  await draw(page, [220, height - 30], [300, height - 30]);
  await scrollToTop(page);
  near(await inked(page, [0, 0, 200, 60]), top);
  expect(await inked(page, [215, height - 40, 90, 20])).toBe(0);

  // 滾輪往下
  const b = await page.locator('#scratch-canvas').boundingBox();
  await page.mouse.move(b.x + 100, b.y + 100);
  await page.mouse.wheel(0, 200);
  await expect.poll(() => gridY(page)).toBeLessThan(0);
  await scrollToTop(page);

  // 兩指一起往上拖 90px：紙捲 90px
  await page.locator('#scratch-canvas').evaluate(async (c) => {
    const r = c.getBoundingClientRect();
    const fire = (type, id, y) =>
      c.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 21, clientX: r.left + 60 + (id - 21) * 80, clientY: r.top + y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1 }));
    fire('pointerdown', 21, 200);
    fire('pointerdown', 22, 200);
    for (let k = 1; k <= 9; k++) {
      fire('pointermove', 21, 200 - k * 10);
      fire('pointermove', 22, 200 - k * 10);
    }
    fire('pointerup', 21, 110);
    fire('pointerup', 22, 110);
  });
  expect(await gridY(page)).toBe(-90);
});

test('畫線後停住會拉成直線，接近水平時對齊；復原一次就拿掉整條', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'free');
  await openScratch(page);
  const b = await page.locator('#scratch-canvas').boundingBox();
  // 畫一條上下起伏的線，停住 0.8 秒，再把終點拉到右邊、比起點低 4px
  await page.mouse.move(b.x + 30, b.y + 80);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 30 + i * 10, b.y + 80 + (i % 2 ? 24 : -24));
  await page.waitForTimeout(800);
  await page.mouse.move(b.x + 260, b.y + 84, { steps: 6 });
  await page.mouse.up();
  // 拉成從起點出發的水平線：線上有墨水，原本起伏的高低點沒有
  expect(await inked(page, [150, 77, 20, 6])).toBeGreaterThan(0);
  expect(await inked(page, [245, 77, 10, 6])).toBeGreaterThan(0);
  expect(await inked(page, [37, 101, 6, 6])).toBe(0);
  expect(await inked(page, [47, 53, 6, 6])).toBe(0);
  await page.locator('#scratch-undo').click();
  expect(await inked(page)).toBe(0);
});

test('模擬考每題一頁：選了答案換到下一題是新的一頁，回到前一題草稿還在', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-exam').click();
  await page.locator('[data-paper="social"]').click();
  await expect(page.locator('#play')).toHaveClass(/exam/);
  await openScratch(page);
  await draw(page, [30, 40], [220, 120]);
  const first = await inked(page);
  expect(first).toBeGreaterThan(0);
  await backToAnswers(page);
  await page.locator('#answers .answer').first().click();
  await expect(page.locator('#play-progress')).toHaveText('2 / 40');
  await openScratch(page);
  expect(await inked(page)).toBe(0);
  await expect(page.locator('#scratch-hint')).toBeVisible();
  await backToAnswers(page);
  await page.locator('#exam-prev').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 40');
  await openScratch(page);
  near(await inked(page), first);
  await expect(page.locator('#scratch-undo')).toBeEnabled();
});

test('手機：中途離開時草稿區開著，下一輪仍從收起開始，不會蓋住選項', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', '只看手機（平板、桌機的草稿區是並排常駐的）');
  await openHome(page);
  await startMode(page, 'free');
  await openScratch(page);
  await expect(page.locator('#answers')).toBeHidden();
  await page.locator('#quit').click();
  if (await page.locator('#r-home').isVisible()) await page.locator('#r-home').click();
  await startMode(page, 'free');
  await expect(page.locator('#play')).not.toHaveClass(/scratch-open/);
  await expect(page.locator('#answers')).toBeVisible();
  // 平板記住的開關不受影響：手機不存草稿區開關
  expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}').settings?.scratch ?? null, KEY)).not.toBe(true);
});
