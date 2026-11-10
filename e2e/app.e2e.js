// 主要流程：首頁、作答到結算、收藏與搜尋、設定、手機橫放、離線開啟
import { answerFirst, answerToResult, audit, expect, openHome, roundSize, skipToResult, skipToSingle, startMode, test, waitForBoot } from './fixtures.js';

test('首頁載入題庫，十個科目都在', async ({ page }) => {
  await openHome(page);
  await expect(page.locator('#subject-chips .chip')).toHaveCount(10);
  await expect(page.locator('#bank-info')).toContainText(/還沒做過 \d+／\d+ 題/);
});

test('首頁的「還沒做過」題數作答後減少；「看存量」打開學習分析的題庫存量', async ({ page }) => {
  await openHome(page);
  const fresh = async () => Number((await page.locator('#bank-info').textContent()).match(/還沒做過 (\d+)／/)[1]);
  const before = await fresh();
  await startMode(page, 'ten');
  const size = await roundSize(page);
  await skipToResult(page);
  await page.locator('#r-home').click();
  expect(await fresh()).toBe(before - size);

  await page.locator('#open-stock').click();
  await expect(page.locator('#stats-stock')).toBeInViewport();
  await expect(page.locator('#stock-text')).toContainText(`還有 ${(before - size).toLocaleString('zh-TW')} 題沒做過`);
  // 展開一科看各單元還剩幾題
  await page.locator('#stock-subjects summary').first().click();
  await expect(page.locator('#stock-subjects details[open] .stock-unit').first()).toContainText(/剩 \d+／\d+/);
});

test.describe('iPhone 的 Safari', () => {
  test.use({ installHint: true });

  test('練過一輪回到首頁時提醒加入主畫面；按「知道了」之後這次不再跳出來', async ({ page, browserName, isMobile }) => {
    test.skip(!(browserName === 'webkit' && isMobile), '只有 iPhone 的 Safari 直接開網頁時才提醒');
    // 面板是淡入的：關掉動畫，無障礙檢查才不會量到淡入到一半的對比
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page);
    await expect(page.locator('#install-sheet')).toBeHidden();
    await startMode(page, 'ten');
    await skipToResult(page);
    await page.locator('#r-home').click();
    // 練滿 10 題才提醒；按掉之後記下時間，30 天內不再提醒
    await expect(page.locator('#install-sheet')).toBeVisible();
    await audit(page, '加入主畫面的提醒');
    await page.locator('#install-ok').click();
    await expect(page.locator('#install-sheet')).toBeHidden();
    expect(Number(await page.evaluate(() => localStorage.getItem('gsat-quiz:install-hint')))).toBeGreaterThan(Date.now() - 60_000);
    await startMode(page, 'ten');
    await skipToResult(page);
    await page.locator('#r-home').click();
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#install-sheet')).toBeHidden();
  });
});

test('10 題一輪：作答到結算，算進今日進度', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'ten');
  // 最後一包是題組時整組出完，一輪最多多出一組（共用選項的題組 7 題以內）
  const size = await roundSize(page);
  expect(size).toBeGreaterThanOrEqual(10);
  expect(size).toBeLessThanOrEqual(16);
  await expect(page.locator('#play-progress')).toHaveText(`1 / ${size}`);
  await answerToResult(page);
  await expect(page.locator('#r-mode')).toHaveText('10 題一輪');
  await page.locator('#r-home').click();
  await expect(page.locator('#daily-count')).toHaveText(String(size));
});

test('只看解答不作答：結算列出全部題目，但不算進今日題數', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'ten');
  const size = await roundSize(page);
  await skipToResult(page);
  await expect(page.locator('#r-list .r-item')).toHaveCount(size);
  await page.locator('#r-home').click();
  await expect(page.locator('#daily-count')).toHaveText('0');
});

test('單選題點選項作答，答對或答錯都有回饋', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'free');
  await skipToSingle(page);
  const first = page.locator('#answers .answer').first();
  await first.click();
  // 答對會蓋上圈、答錯會蓋上叉，正解一定會標出來
  await expect(page.locator('#answers .answer.correct')).toHaveCount(1);
  await expect(page.locator('#q-explain')).toBeVisible();
});

test('作答時回看上一題：當時的選項順序、正解與解析，看完回到原本那題', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'ten');
  await expect(page.locator('#back')).toBeHidden();
  const q1 = await page.locator('#q-text').textContent();
  const choices1 = await page.locator('#answers .answer-text').allTextContents();
  await page.locator('#skip').click();
  await expect(page.locator('#back')).toBeHidden();
  await page.locator('#next').click();

  const q2 = await page.locator('#q-text').textContent();
  const size = await roundSize(page);
  await answerFirst(page);
  // 答對會自己換題，按「繼續」時可能已經換過了，所以不用 locator.click 等按鈕
  await page.waitForFunction(() => !document.querySelector('#next').hidden || document.querySelector('#play-progress').textContent.startsWith('3 '));
  await page.evaluate(() => document.querySelector('#next').hidden || document.querySelector('#next').click());
  await expect(page.locator('#play-progress')).toHaveText(`3 / ${size}`);
  const q3 = await page.locator('#q-text').textContent();

  await page.locator('#back').click();
  await expect(page.locator('#past-sheet')).toBeVisible();
  await expect(page.locator('#past-n')).toHaveText('第 2 題');
  await expect(page.locator('#past-result')).toHaveText(/^答(對|錯)$/);
  await expect(page.locator('#past-card .r-q')).toHaveText(q2);
  await expect(page.locator('#past-next')).toBeDisabled();
  await page.locator('#past-prev').click();
  await expect(page.locator('#past-n')).toHaveText('第 1 題');
  await expect(page.locator('#past-result')).toHaveText('看了解答');
  await expect(page.locator('#past-card .r-q')).toHaveText(q1);
  await expect(page.locator('#past-card .past-choice .answer-text')).toHaveText(choices1);
  // 第 1 題可能是多選題，正解不只一個
  expect(await page.locator('#past-card .past-choice.right').count()).toBeGreaterThan(0);
  await expect(page.locator('#past-card .explain')).toBeVisible();
  await expect(page.locator('#past-prev')).toBeDisabled();

  // 回到原本那題，還沒作答
  await expect(page.locator('#past-back')).toHaveText('回到第 3 題');
  await page.locator('#past-back').click();
  await expect(page.locator('#past-sheet')).toBeHidden();
  await expect(page.locator('#q-text')).toHaveText(q3);
  await expect(page.locator('#answers .answer:disabled')).toHaveCount(0);
  // Esc 只關面板，不會結束這一輪
  await page.locator('#back').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#past-sheet')).toBeHidden();
  await expect(page.locator('#play')).toBeVisible();
});

// KaTeX 對齊分數的隱形元素曾經伸出公式、蓋住上一排的選項：點上面那顆卻選到下面那顆
test('兩欄的分數選項，點哪裡都選到那一顆', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openHome(page);
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="search"]').click();
  await page.locator('#notebook-search').fill('math-685');
  await expect(page.locator('#notebook-count')).toHaveText('1');
  await page.locator('#notebook-train').click();
  await expect(page.locator('#answers.grid-2 .answer')).toHaveCount(4);
  const stray = await page.locator('#answers .answer').evaluateAll((buttons) =>
    buttons.map((b) => {
      const r = b.getBoundingClientRect();
      let n = 0;
      for (let x = 0.1; x < 1; x += 0.2)
        for (let y = 0.1; y < 1; y += 0.2) {
          const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)?.closest('.answer');
          if (hit && hit !== b) n++;
        }
      return n;
    }),
  );
  expect(stray).toEqual([0, 0, 0, 0]);
});

test('答對後標「猜對的」：結算列出這題，今天的答對數不算它', async ({ page }) => {
  await openHome(page);
  await startMode(page, 'free');
  // 每題點第一個選項，直到答對一題（答對才會出現「猜對的」）
  for (let i = 0; i < 40; i++) {
    await skipToSingle(page);
    await page.locator('#answers .answer').first().click();
    if (await page.locator('#certain').isVisible()) break;
    await page.locator('#next').click();
  }
  await page.locator('#guess').click();
  await expect(page.locator('#guess')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#unsure')).toBeHidden();
  await expect(page.locator('#related')).toBeVisible();
  await page.locator('#quit').click();
  await expect(page.locator('#r-list')).toContainText('答對了，但你標了「猜對的」');
  await expect(page.locator('#r-acc')).toHaveText('0%');
  await page.locator('#r-home').click();
  await expect(page.locator('#daily-acc')).toHaveText('正確率 0%');
});

test('單元闖關：每關先出 30 題，看解答就在這關最後補一題，離開後從下一題接著做', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-path').click();
  await expect(page.locator('#path-sheet')).toBeVisible();
  await expect(page.locator('#path-reset')).toBeDisabled();
  const unit = await page.locator('#path-list .path-unit[data-status="current"] .unit-name').first().textContent();
  await expect(page.locator('#path-list .path-unit[data-status="locked"]').first()).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#path-go').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 30');
  await expect(page.locator('#q-topic')).toContainText(unit);

  await page.locator('#skip').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 31');
  await expect(page.locator('#q-explain .path-note')).toBeVisible();
  await page.locator('#next').click();
  await expect(page.locator('#play-progress')).toHaveText('2 / 31');

  await page.locator('#quit').click();
  await expect(page.locator('#r-mode')).toHaveText(`單元闖關・${unit}`);
  await expect(page.locator('#r-cheer')).toHaveText('這關還有 30 題，下次從這裡接著做。');
  await expect(page.locator('#r-again')).toHaveText('繼續這一關');
  await page.locator('#r-again').click();
  await expect(page.locator('#play-progress')).toHaveText('2 / 31');

  // 這次一題都沒答就離開：直接回首頁
  await page.locator('#quit').click();
  await expect(page.locator('#path-sub')).toHaveText(/・第 1 關$/);
  await page.locator('#open-path').click();
  await expect(page.locator('#path-go')).toHaveText(`繼續：${unit}`);
  await expect(page.locator('#path-list .path-unit[data-status="current"] .unit-meta').first()).toHaveText('進行中 1 / 31');
});

/**
 * 在 localStorage 放好作答紀錄：這個單元的題目都答對過、從沒失手，只留 missed 題答錯過（已到期該複習）、fresh 題沒做過。
 * 題庫從開機時下載的 JSON 再抓一次；回傳 { missed, fresh } 的題數
 */
async function seedUnitCleared(page, unit, { missed = 0, fresh = 0 } = {}) {
  await page.evaluate(
    async ({ unit, missed, fresh }) => {
      const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /\/[a-z]+-[\w-]+\.json$/.test(u));
      const bank = (await Promise.all(urls.map((u) => fetch(u).then((r) => r.json())))).flat();
      const ids = bank.filter((q) => q.topic === unit).map((q) => q.id);
      const now = Date.now();
      const cards = {};
      ids.forEach((id, i) => {
        if (i < missed) cards[id] = { box: 1, due: now - 1000, seen: 2, right: 1, wrong: 1, parked: false, last: now - 86_400_000 };
        else if (i >= missed + fresh) cards[id] = { box: 2, due: now - 1000, seen: 1, right: 1, wrong: 0, parked: false, last: now - 86_400_000 };
      });
      localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, cards }));
    },
    { unit, missed, fresh },
  );
  await page.reload();
  await waitForBoot(page);
}

test('答對過、從沒失手的題目不再出，答錯過的照常複習；整個單元都答對過的闖關直接過關', async ({ page }) => {
  await openHome(page);
  await page.locator('#open-path').click();
  const units = await page.locator('#path-list .path-unit .unit-name').allTextContents();

  // 第一關只剩一題答錯過、一題沒做過：這關只出這兩題
  await seedUnitCleared(page, units[0], { missed: 1, fresh: 1 });
  await page.locator('#open-path').click();
  await page.locator('#path-go').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 2');
  await page.locator('#quit').click();

  // 全部答對過：直接過關，接著闖第二關
  await seedUnitCleared(page, units[0]);
  await page.locator('#open-path').click();
  await page.locator('#path-go').click();
  await expect(page.locator('#toast')).toContainText(`「${units[0]}」的題目都答對過了，直接過關`);
  await expect(page.locator('#play-progress')).toHaveText('1 / 30');
  await expect(page.locator('#q-topic')).toContainText(units[1]);
});

test('自由練習：複習和新題一題一題輪流出，一批出完接著下一批也不會連出 2 題複習（整組題組除外）', async ({ page }) => {
  await openHome(page);
  // 物理每一題都答錯過、到期該複習，數學全是新題；看 30 題，跨過一批 20 題的交界
  const physicsJson = /\/physics-[\w-]+\.json$/;
  await page.waitForFunction((re) => performance.getEntriesByType('resource').some((e) => new RegExp(re).test(e.name)), physicsJson.source);
  await page.evaluate(async (re) => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((u) => new RegExp(re).test(u));
    const physics = (await Promise.all(urls.map((u) => fetch(u).then((r) => r.json())))).flat();
    const now = Date.now();
    const card = { box: 2, due: now - 60_000, seen: 2, right: 1, wrong: 1, parked: false, missed: 1, last: now - 2 * 86_400_000 };
    const cards = Object.fromEntries(physics.map((q) => [q.id, card]));
    localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, cards, settings: { subjects: ['math', 'physics'] } }));
  }, physicsJson.source);
  await page.reload();
  await waitForBoot(page);
  await startMode(page, 'free');
  // n：數學新題；d：物理的單題複習；G、g：物理題組的第一題、同組後面的題目
  let kinds = '';
  for (let i = 0; i < 30; i++) {
    const subject = await page.locator('#q-subject').textContent();
    const topic = await page.locator('#q-topic').textContent();
    kinds += subject.includes('數學') ? 'n' : /^題組 1／/.test(topic) ? 'G' : /^題組/.test(topic) ? 'g' : 'd';
    await page.locator('#skip').click();
    await page.locator('#next').click();
  }
  expect(kinds).toMatch(/n.*d|d.*n/);
  for (const run of kinds.split('n')) if (run.length > 1) expect(run, `出題順序 ${kinds}`).toMatch(/^Gg+$/);
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
  await waitForBoot(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim())).toBe('1.25');
});

test('只選一科時先載入那一科就能開始玩，其他科在背景補上', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('gsat-quiz:v1')) localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, settings: { subjects: ['english'] } }));
  });
  // 數學題庫晚一點才回來：首頁不必等它
  let release;
  const held = new Promise((r) => (release = r));
  await page.route('**/assets/math-*.json', async (route) => {
    await held;
    await route.continue();
  });
  await openHome(page);
  await startMode(page, 'ten');
  await expect(page.locator('#q-subject')).toContainText('英文');
  // 還沒作答就離開：直接回首頁
  await page.locator('#quit').click();
  await expect(page.locator('#home')).toBeVisible();
  release();
  // 學習分析要用到每一科：數學載完後各科都有題數
  await page.locator('#daily').click();
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('#stats-subjects')).toContainText('數學');
});

test('背景動畫關閉：不載入背景場景的程式', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('gsat-quiz:v1')) localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, settings: { motion: 'off' } }));
  });
  const scene = [];
  page.on('request', (req) => /assets\/scene-/.test(req.url()) && scene.push(req.url()));
  await openHome(page);
  await expect(page.locator('#world')).toBeHidden();
  await startMode(page, 'ten');
  expect(scene).toEqual([]);
  // 改成省電：這時才載入，畫布出現
  await page.locator('#quit').click();
  await page.locator('#open-settings').click();
  await page.locator('#motion-options button', { hasText: '省電' }).click();
  await expect(page.locator('#world')).toBeVisible();
  await expect.poll(() => scene.length).toBeGreaterThan(0);
});

test('320px 寬的小手機：首頁不會左右捲動，設定齒輪在畫面內', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openHome(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const gear = await page.locator('#open-settings').boundingBox();
  expect(gear.x + gear.width).toBeLessThanOrEqual(320);
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
  await waitForBoot(page);
  // 等 service worker 把所有檔案存進快取並接手這個頁面
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  });
  await context.setOffline(true);
  await page.reload();
  await waitForBoot(page);
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
