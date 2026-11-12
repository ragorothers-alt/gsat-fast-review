// 第一次開啟的設定、首頁的「開始今天的練習」與標題、只出單題（設定與新手期）
import { audit, expect, openHome, seedVeteran, test, waitForBoot } from './fixtures.js';

const KEY = 'gsat-quiz:v1';
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
const welcomed = (page) => page.evaluate(() => localStorage.getItem('gsat-quiz:welcome'));

test.describe('第一次開啟的設定', () => {
  test.use({ welcome: true });

  test('還沒有作答紀錄時跳出面板；選「社會組」、按「開始練習」後首頁是那 6 科、直接進自由練習；重新整理不再出現', async ({ page }) => {
    // 面板是淡入的：關掉動畫，無障礙檢查才不會量到淡入到一半的對比
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await waitForBoot(page);
    const sheet = page.locator('#welcome-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('#welcome-title')).toHaveText('先設定一下');
    // 背後的首頁按不到
    await expect(page.locator('#app')).toHaveAttribute('inert', '');

    // 預設值就是現有設定的預設：十科、116 學測、每天 30 題
    const pressed = page.locator('#welcome-subjects .chip[aria-pressed="true"]');
    await expect(page.locator('#welcome-subjects .chip')).toHaveCount(10);
    await expect(pressed).toHaveCount(10);
    await expect(page.locator('#welcome-tracks [aria-pressed="true"]')).toHaveText('全部');
    await expect(page.locator('#welcome-date')).toHaveValue('2027-01-22');
    await expect(page.locator('#welcome-goals .seg-btn')).toHaveText(['10 題', '20 題', '30 題', '50 題']);
    await expect(page.locator('#welcome-goals [aria-pressed="true"]')).toHaveText('30 題');
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await audit(page, `第一次開啟的設定（${scheme}）`);
    }

    // 快速選擇：自然組是國英數＋物理、化學、生物、地科；社會組是國英數＋歷史、地理、公民
    await page.locator('#welcome-tracks button', { hasText: '自然組' }).click();
    await expect(pressed).toHaveText(['國文', '英文', '數學', '物理', '化學', '生物', '地科']);
    await page.locator('#welcome-tracks button', { hasText: '社會組' }).click();
    await expect(pressed).toHaveText(['國文', '英文', '數學', '歷史', '地理', '公民']);
    await expect(page.locator('#welcome-note')).toHaveText('已選 6 科');
    // 自己再調一科：就不是任何一個快速選擇了；調回來又是社會組
    await page.locator('#welcome-subjects .chip', { hasText: '公民' }).click();
    await expect(page.locator('#welcome-tracks [aria-pressed="true"]')).toHaveCount(0);
    // 一科都沒選：不能開始
    for (const name of ['國文', '英文', '數學', '歷史', '地理']) await page.locator('#welcome-subjects .chip', { hasText: name }).click();
    await expect(pressed).toHaveCount(0);
    await expect(page.locator('#welcome-start')).toBeDisabled();
    await expect(page.locator('#welcome-note')).toHaveText('至少選一科才能開始');
    await page.locator('#welcome-tracks button', { hasText: '社會組' }).click();
    await expect(page.locator('#welcome-start')).toBeEnabled();
    await audit(page, '第一次開啟的設定（選了社會組）');

    await page.locator('#welcome-goals button', { hasText: '20 題' }).click();
    await page.locator('#welcome-date').fill('2027-01-23');
    // 還沒按開始：設定沒動（還沒存過檔，或存的還是十科）
    expect((await saved(page))?.settings?.subjects?.length ?? 10).toBe(10);
    await page.locator('#welcome-start').click();

    // 直接進自由練習（不計題數的「第 1 題」），面板關掉、設定存好、記下看過了
    await expect(sheet).toBeHidden();
    await expect(page.locator('#play')).toBeVisible();
    await expect(page.locator('#play-progress')).toHaveText('第 1 題');
    await expect(page.locator('#q-subject')).toHaveText(/^(國文|英文|數學|歷史|地理|公民)$/);
    // 新手的第一題是點一下就作答的單題：不是題組、多選、演算題或非選擇題
    await expect(page.locator('#q-passage')).toBeHidden();
    await expect(page.locator('#q-topic .topic-fixed')).toHaveCount(0);
    const s = await saved(page);
    expect(s.settings).toMatchObject({ subjects: ['chinese', 'english', 'math', 'history', 'geography', 'civics'], goal: 20, examDate: '2027-01-23' });
    expect(Number(await welcomed(page))).toBeGreaterThan(Date.now() - 60_000);

    // 還沒作答就離開：回首頁，科目是那 6 科、每日目標 20 題
    await page.locator('#quit').click();
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#subject-chips .chip[aria-pressed="true"] .chip-name')).toHaveText(['國文', '英文', '數學', '歷史', '地理', '公民']);
    await expect(page.locator('#daily-goal')).toHaveText('20');

    // 重新整理：還是沒有作答紀錄，但已經看過，不再出現
    await page.reload();
    await waitForBoot(page);
    await expect(page.locator('#home')).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect(page.locator('#subject-chips .chip[aria-pressed="true"]')).toHaveCount(6);
  });

  test('選了數學才問考哪一份；選數學 A 開始後，選單元的數學分頁也是數學 A、不出數B 專屬主題', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await waitForBoot(page);
    const math = page.locator('#welcome-math');
    const pressed = page.locator('#welcome-math-seg [aria-pressed="true"]');
    await expect(math).toBeVisible();
    await expect(page.locator('#welcome-math-seg .seg-btn')).toHaveText(['數學 A', '數學 B', '都考']);
    await expect(page.locator('#welcome-math-seg')).toHaveAccessibleName('數學考哪一份？');
    await expect(pressed).toHaveText('都考');
    // 沒選數學就不問
    await page.locator('#welcome-subjects .chip', { hasText: '數學' }).click();
    await expect(math).toBeHidden();
    await page.locator('#welcome-tracks button', { hasText: '自然組' }).click();
    await expect(math).toBeVisible();
    await page.locator('#welcome-math-seg button', { hasText: '數學 A' }).click();
    await expect(pressed).toHaveText('數學 A');
    await audit(page, '第一次開啟的設定：數學考哪一份');
    await page.locator('#welcome-start').click();
    await expect(page.locator('#play')).toBeVisible();
    expect((await saved(page)).settings.excludedUnits).toEqual(['math/數B 專屬主題']);
    await page.locator('#quit').click();
    await page.locator('#open-units').click();
    await page.locator('#units-tabs button', { hasText: '數學' }).click();
    await expect(page.locator('#units-math-seg [aria-pressed="true"]')).toHaveText('數學 A');
  });

  test('「之後再說」和 Esc 都不改設定，只記下看過了；焦點在面板裡', async ({ page }) => {
    await page.goto('./');
    await waitForBoot(page);
    const sheet = page.locator('#welcome-sheet');
    await expect(sheet).toBeVisible();
    // 焦點移進面板（鍵盤、螢幕閱讀器從面板開始）
    expect(await page.evaluate(() => !!document.activeElement?.closest('#welcome-sheet'))).toBe(true);
    // 改了選項但按「之後再說」：不存
    await page.locator('#welcome-tracks button', { hasText: '自然組' }).click();
    await page.locator('#welcome-skip').click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('#subject-chips .chip[aria-pressed="true"]')).toHaveCount(10);
    await expect(page.locator('#daily-goal')).toHaveText('30');
    expect(await welcomed(page)).not.toBeNull();
    // 首頁照常能用
    await page.locator('[data-mode="ten"]').click();
    await expect(page.locator('#play')).toBeVisible();

    // 清掉旗標重來：Esc 也是「之後再說」
    await page.evaluate(() => localStorage.removeItem('gsat-quiz:welcome'));
    await page.reload();
    await waitForBoot(page);
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    expect(await welcomed(page)).not.toBeNull();
    await page.reload();
    await waitForBoot(page);
    await expect(sheet).toBeHidden();
  });

  test('已經有作答紀錄（舊使用者、從同步或匯入還原進度）就不出現', async ({ page }) => {
    await seedVeteran(page, {}, 1);
    await openHome(page);
    await expect(page.locator('#welcome-sheet')).toBeHidden();
    await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
    // 沒顯示就不必記旗標
    expect(await welcomed(page)).toBeNull();
  });
});

test('首頁今日進度卡：左半「開始 ›」直接開始自由練習，右半進學習分析；一科都沒選時開始不了', async ({ page }) => {
  await openHome(page);
  const start = page.locator('#daily-start');
  await expect(start).toHaveAccessibleName(/^開始今天的練習：\s*今日 0 \/ 30 題/);
  await expect(start.locator('.daily-go')).toHaveText('開始 ›');
  await start.click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play-progress')).toHaveText('第 1 題');
  await page.locator('#quit').click();
  await expect(page.locator('#home')).toBeVisible();

  // 右半（距學測天數、「分析 ›」）照舊開學習分析
  await expect(page.locator('#daily')).toContainText('分析 ›');
  await page.locator('#daily').click();
  await expect(page.locator('#stats')).toBeVisible();
  await page.locator('#stats-back').click();

  // 全部清除：開始不了，分析還是能看
  await page.locator('#toggle-all').click();
  await expect(page.locator('#subject-chips .chip[aria-pressed="true"]')).toHaveCount(0);
  await expect(start).toBeDisabled();
  await expect(page.locator('#daily')).toBeEnabled();
});

test('首頁標題在 320–412 寬都是一行；頂列與今日進度卡不超出畫面、文字不互相擠到', async ({ page }) => {
  // 連續 123 天、今日 120 / 120 題：頂列和今日進度卡最寬的情況
  await page.addInitScript(() => {
    if (localStorage.getItem('gsat-quiz:v1')) return;
    const t = new Date();
    const day = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    localStorage.setItem(
      'gsat-quiz:v1',
      JSON.stringify({ version: 1, cards: {}, daily: { [day]: { answered: 120, right: 96 } }, streak: { count: 123, last: day }, settings: { goal: 120 } }),
    );
  });
  await page.setViewportSize({ width: 412, height: 800 });
  await openHome(page);
  await expect(page.locator('#streak b')).toHaveText('123');
  for (const width of [412, 390, 375, 360, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const m = await page.evaluate(() => {
      const textRects = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...range.getClientRects()];
      };
      const box = (sel) => document.querySelector(sel).getBoundingClientRect();
      const title = textRects(document.querySelector('.brand h1'));
      return {
        titleLines: new Set(title.map((r) => Math.round(r.top))).size,
        titleRight: Math.max(...title.map((r) => r.right)),
        actionsLeft: box('.top-actions').left,
        actionsRight: box('.top-actions').right,
        pageWidth: document.documentElement.scrollWidth,
        // 今日題數那一行放不下時會截掉（字型較寬的裝置）：量這一行的框，不量文字本身
        lineRight: box('.daily-line').right,
        goLeft: box('.daily-go').left,
        goRight: box('.daily-go').right,
        statsLeft: box('.daily-stats').left,
        statsRight: box('.daily-stats').right,
        cardRight: box('#daily-card').right,
      };
    });
    expect(m.titleLines, `${width}px：標題一行`).toBe(1);
    expect(m.titleRight, `${width}px：標題不壓到右邊的按鈕`).toBeLessThanOrEqual(m.actionsLeft);
    expect(m.actionsRight, `${width}px：頂列在畫面內`).toBeLessThanOrEqual(width);
    expect(m.pageWidth, `${width}px：不能左右捲動`).toBeLessThanOrEqual(width);
    expect(m.lineRight, `${width}px：今日題數不壓到「開始 ›」`).toBeLessThanOrEqual(m.goLeft);
    expect(m.goRight, `${width}px：「開始 ›」不壓到學測倒數`).toBeLessThanOrEqual(m.statsLeft);
    expect(m.statsRight, `${width}px：學測倒數在卡片裡`).toBeLessThanOrEqual(m.cardRight);
  }
});

// ── 只出單題 ─────────────────────────────────────────
// 單元用物理的第一關（單元闖關一開始就闖得到）
const base = { subject: 'physics', topic: '科學方法與單位', formula: false, level: 2 };
const SINGLE = { ...base, id: 'physics-9921', type: 'mc', q: '物體所受合力為零時，下列何者一定為零？', choices: ['加速度', '速度', '動量', '動能'], answer: 0, explain: '合力為零，加速度為零；速度可以不為零。' };
const MIXED = [
  SINGLE,
  { ...base, id: 'physics-9922', type: 'ms', q: '下列哪些是向量？', choices: ['力', '質量', '加速度', '時間', '溫度'], answer: [0, 2], explain: '力與加速度有方向，是向量。' },
  {
    ...base,
    id: 'physics-9923',
    type: 'mc',
    q: '速度與時間的關係如圖，哪一段合力為零？',
    fig: { type: 'line', x: { label: '時間 (s)' }, y: { label: '速度 (m/s)' }, series: [{ points: [[0, 0], [2, 8], [6, 8], [8, 0]] }] },
    choices: ['0–2 秒', '2–6 秒', '6–8 秒', '全程'],
    answer: 1,
    explain: '2–6 秒速度不變，合力為零。',
  },
  { ...base, id: 'physics-9924', type: 'mc', scratch: true, q: '質量 2 kg 的物體受 6 N 的合力，加速度是多少 m/s²？', choices: ['3', '12', '4', '8'], answer: 0, explain: '$a=F/m=6/2=3$。' },
];

/** 把物理題庫換成這幾題 */
async function mockPhysics(page, questions) {
  await page.route('**/assets/physics-*.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    // 同樣開頭的還有重點卡的檔案：只換題庫
    if (Array.isArray(body) && body[0]?.id?.startsWith('physics-')) await route.fulfill({ response: res, json: questions });
    else await route.fulfill({ response: res });
  });
}

const total = async (page) => Number((await page.locator('#play-progress').textContent()).split('/')[1]);

test('新手期（作答紀錄不到 20 題）：10 題一輪、自由練習只出單題；選的範圍沒有單題時照常出，不會變成沒有題目', async ({ page }) => {
  await mockPhysics(page, MIXED);
  await page.addInitScript(() => {
    if (!localStorage.getItem('gsat-quiz:v1')) localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, settings: { subjects: ['physics'] } }));
  });
  await openHome(page);
  // 題庫有單題、多選題、圖表題、演算題各一：只出那一題單題
  await page.locator('[data-mode="ten"]').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 1');
  await expect(page.locator('#q-text')).toHaveText(SINGLE.q);
  await page.locator('#quit').click();
  await page.locator('[data-mode="free"]').click();
  await expect(page.locator('#q-text')).toHaveText(SINGLE.q);
  await page.locator('#quit').click();
  // 單元闖關不受影響：四題都出
  await page.locator('#open-path').click();
  await expect(page.locator('#path-go')).toHaveText(`開始：${SINGLE.topic}`);
  await page.locator('#path-go').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 4');
});

test('新手期但選的範圍沒有單題：照一般方式出題', async ({ page }) => {
  await mockPhysics(page, MIXED.slice(1));
  await page.addInitScript(() => {
    if (!localStorage.getItem('gsat-quiz:v1')) localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, settings: { subjects: ['physics'] } }));
  });
  await openHome(page);
  await page.locator('[data-mode="ten"]').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play-progress')).toHaveText('1 / 3');
});

test('設定的「只出單題」：開了以後 10 題一輪、自由練習不出多選、圖表題與演算題；指定的題目不受影響；重新整理後還開著', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockPhysics(page, MIXED);
  // 作答紀錄滿 20 題（過了新手期）：預設四題都出
  await seedVeteran(page, { subjects: ['physics'] });
  await openHome(page);
  await page.locator('[data-mode="ten"]').click();
  expect(await total(page)).toBe(4);
  await page.locator('#quit').click();

  await page.locator('#open-settings').click();
  const toggle = page.locator('#quick-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(toggle).toHaveAccessibleName('只出單題');
  await expect(toggle).toHaveAccessibleDescription(/通勤、零碎時間用：不出題組、圖表題、多選、演算題與非選擇題/);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `設定：只出單題（${scheme}）`);
  }
  expect((await saved(page)).settings.quickOnly).toBe(true);
  await page.locator('#settings-close').click();

  await page.locator('[data-mode="ten"]').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 1');
  await expect(page.locator('#q-text')).toHaveText(SINGLE.q);
  await page.locator('#quit').click();
  await page.locator('[data-mode="free"]').click();
  await expect(page.locator('#q-text')).toHaveText(SINGLE.q);
  await page.locator('#quit').click();

  // 指定的題目（錯題本搜尋到的）照出：多選題還是練得到
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="search"]').click();
  await page.locator('#notebook-search').fill('physics-9922');
  await expect(page.locator('#notebook-count')).toHaveText('1');
  await page.locator('#notebook-train').click();
  await expect(page.locator('#q-topic')).toContainText('・多選');
  await page.locator('#quit').click();

  // 重新整理：開關還開著
  await page.reload();
  await waitForBoot(page);
  await page.locator('#open-settings').click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  // 關掉就恢復
  await toggle.click();
  await page.locator('#settings-close').click();
  await page.locator('[data-mode="ten"]').click();
  expect(await total(page)).toBe(4);
});
