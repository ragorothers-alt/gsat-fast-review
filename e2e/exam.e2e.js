// 模擬考與複習預報
import { audit, expect, openHome, test, waitForBoot } from './fixtures.js';

const KEY = 'gsat-quiz:v1';
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);

async function startPaper(page, paper) {
  await page.locator('#open-exam').click();
  await expect(page.locator('#exam-sheet')).toBeVisible();
  // 說明要寫對：國文、數學、自然卷有多選題（以前寫成「只有單選」）
  await expect(page.locator('#exam-sheet .sheet-tip')).toContainText('國文、數學、自然卷含多選題');
  await expect(page.locator('#exam-sheet .sheet-tip')).not.toContainText('只有單選');
  await page.locator(`[data-paper="${paper}"]`).click();
  await expect(page.locator('#play')).toHaveClass(/exam/);
}

test('模擬考：作答時不對答案，可以標記、跳題、回頭改；交卷後看成績單，作答算進今日進度', async ({ page }) => {
  await openHome(page);
  await startPaper(page, 'social');
  await expect(page.locator('#play-progress')).toHaveText('1 / 40');
  await expect(page.locator('#exam-clock')).toHaveText(/^(34:00|33:5\d)$/);
  // 作答畫面的計分、看解答都收起來
  await expect(page.locator('#skip')).toBeHidden();
  await expect(page.locator('.score')).toBeHidden();

  // 選了答案只標出選了哪個，不對答案；第一次選就自動換下一題
  await page.locator('#answers .answer').nth(1).click();
  await expect(page.locator('#play-progress')).toHaveText('2 / 40');
  await expect(page.locator('#answers .correct, #answers .wrong, #q-explain:visible')).toHaveCount(0);

  // 標記這題，回上一題看得到剛剛選的；再按一次取消作答（取消不會換題）
  await page.locator('#exam-mark').click();
  await expect(page.locator('#exam-mark')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#exam-prev').click();
  await expect(page.locator('#play-progress')).toHaveText('1 / 40');
  await expect(page.locator('#answers .answer').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#answers .answer').nth(1).click();
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('#play-progress')).toHaveText('1 / 40');

  // 鍵盤：數字鍵作答、右鍵下一題
  for (let i = 1; i <= 5; i++) {
    await page.keyboard.press(String(((i - 1) % 4) + 1));
    await expect(page.locator('#play-progress')).toHaveText(`${i + 1} / 40`);
  }
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#play-progress')).toHaveText('7 / 40');
  // 整卷計時真的在走
  await expect(page.locator('#exam-clock')).not.toHaveText('30:00');

  // 題號一覽：已作答、標記；點題號跳過去
  await page.locator('#exam-index-btn').click();
  await expect(page.locator('#exam-grid .cell')).toHaveCount(40);
  await expect(page.locator('#exam-grid .cell.done')).toHaveCount(5);
  await expect(page.locator('#exam-grid .cell.marked')).toHaveCount(1);
  await page.locator('#exam-grid .cell').nth(9).click();
  await expect(page.locator('#play-progress')).toHaveText('10 / 40');

  // 還有沒作答的：交卷要按兩次
  await page.keyboard.press('Escape');
  await expect(page.locator('#exam-index')).toBeVisible();
  await page.locator('#exam-submit').click();
  await expect(page.locator('#exam-submit')).toHaveText('還有 35 題沒作答，確定交卷');
  await page.locator('#exam-submit').click();

  await expect(page.locator('#exam-report')).toBeVisible();
  await expect(page.locator('#x-big')).toHaveText(/^\d+ \/ 40$/);
  // 社會卷的單題都是單選；抽到的題組偶爾有多選題（約 3% 的社會題組有，抽 3 組約一成機率），有的話照學測部分給分、改稱得分率
  await expect(page.locator('#x-acc-label')).toHaveText(/^(答對率|得分率)$/);
  await expect(page.locator('#x-blank')).toHaveText('35');
  await expect(page.locator('#x-units li').first()).toBeVisible();
  await expect(page.locator('#x-slow li')).toHaveCount(5);
  // 答錯、沒作答、標記過的都列出來（至少沒作答的 35 題）
  expect(await page.locator('#x-list .r-item').count()).toBeGreaterThanOrEqual(35);

  // 作答的 5 題寫進排程與今日題數；沒作答又只瞄一眼的不記；考卷不再存著，成績記下來
  const s = await saved(page);
  expect(s.exam).toBeNull();
  expect(s.examLog).toHaveLength(1);
  expect(s.examLog[0]).toMatchObject({ paper: 'social', total: 40, blank: 35 });
  expect(Object.keys(s.cards)).toHaveLength(5);
  expect(Object.values(s.daily)[0].answered).toBe(5);

  // 從成績單看花最久的題目：當時的選項與作答
  await page.locator('#x-slow .x-slow-item').first().click();
  await expect(page.locator('#past-sheet')).toBeVisible();
  await expect(page.locator('#past-back')).toHaveText('回到成績單');
  await page.locator('#past-back').click();

  // 練這份的錯題：練的就是成績單列的那些（含答對但標記過的），一般的作答畫面
  const listed = await page.locator('#x-list .r-item').count();
  await expect(page.locator('#x-train')).toHaveText(`練這份的錯題（${listed} 題）`);
  await page.locator('#x-train').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#play-progress')).toHaveText(`1 / ${listed}`);
  await expect(page.locator('#play')).not.toHaveClass(/exam/);
  await expect(page.locator('#skip')).toBeVisible();

  // 首頁的模擬考按鈕顯示上次的成績
  await page.locator('#quit').click();
  if (await page.locator('#r-home').isVisible()) await page.locator('#r-home').click();
  await expect(page.locator('#exam-sub')).toHaveText(/^上次社會 \d+%$/);
});

test('模擬考的多選題：題目卡標「多選題」，點選項切換、不自動換題；交卷後照學測規則部分給分', async ({ page }) => {
  await openHome(page);
  await startPaper(page, 'math');
  // 往後翻到第一題多選題（單選題的單元名稱是空的）
  for (let i = 0; i < 24 && (await page.locator('#q-topic').textContent()) !== '多選題'; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('#q-topic')).toHaveText('多選題');
  const at = await page.locator('#play-progress').textContent();
  await expect(page.locator('#answers .answer')).toHaveCount(5);

  // 點一個、按數字鍵再選一個：兩個都標成選了，不會自動換題
  await page.locator('#answers .answer').nth(0).click();
  await page.keyboard.press('3');
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator('#answer-status')).toHaveText('已選第 1、3 個選項');
  await page.waitForTimeout(600);
  await expect(page.locator('#play-progress')).toHaveText(at);
  // 再按一次取消其中一個；全部取消就是沒作答
  await page.keyboard.press('1');
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(1);
  await page.keyboard.press('3');
  await expect(page.locator('#answer-status')).toHaveText('已取消作答');
  await page.keyboard.press('2');
  await page.keyboard.press('5');

  // 換到別題再回來，選的都還在
  const first = at.startsWith('1 /');
  await page.locator(first ? '#exam-next' : '#exam-prev').click();
  await page.locator(first ? '#exam-prev' : '#exam-next').click();
  await expect(page.locator('#play-progress')).toHaveText(at);
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(2);

  await page.locator('#exam-index-btn').click();
  await expect(page.locator('#exam-grid .cell.done')).toHaveCount(1);
  await page.locator('#exam-submit').click();
  await page.locator('#exam-submit').click();
  await expect(page.locator('#exam-report')).toBeVisible();
  await expect(page.locator('#x-acc-label')).toHaveText('得分率');
  await expect(page.locator('#x-big')).toHaveText(/^\d+(\.\d)? \/ 25$/);
  const s = await saved(page);
  expect(s.examLog[0]).toMatchObject({ paper: 'math', total: 25, blank: 24 });
  expect(s.examLog[0].points).toBeGreaterThanOrEqual(0);
  expect(s.examLog[0].points).toBeLessThanOrEqual(1);
});

test('模擬考的選填題：不給選項，用數字鍵填數值、填好了換下一題，回頭看填的還在；交卷後照填的值對答案', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // 數學題庫換成 30 題能填答的演算題（選項 1、2、3、4，正解 1）：這份卷每題都是選填題
  const samples = Array.from({ length: 30 }, (_, i) => ({
    id: `math-${9001 + i}`,
    subject: 'math',
    topic: '數與式',
    type: 'mc',
    scratch: true,
    level: 2,
    q: `求 $${i + 3}-${i + 2}$ 的值。`,
    choices: ['1', '2', '3', '4'],
    answer: 0,
    explain: `$${i + 3}-${i + 2}=1$。`,
  }));
  await page.route('**/assets/math-*.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    // 同樣開頭的還有重點卡的檔案：只換題庫
    if (Array.isArray(body) && body[0]?.id?.startsWith('math-')) await route.fulfill({ response: res, json: samples });
    else await route.fulfill({ response: res });
  });
  await openHome(page);
  await page.locator('#open-exam').click();
  await expect(page.locator('li:has([data-paper="math"]) .exam-paper-meta')).toContainText('有選填題');
  await expect(page.locator('li:has([data-paper="science"]) .exam-paper-meta')).not.toContainText('選填');
  await page.locator('[data-paper="math"]').click();
  await expect(page.locator('#play')).toHaveClass(/exam/);

  // 題目卡標「選填題」：沒有選項、也不能改看選項，草稿區的鉛筆按鈕提示要動筆算
  await expect(page.locator('#q-topic')).toHaveText('選填題');
  await expect(page.locator('#answers .answer')).toHaveCount(0);
  await expect(page.locator('#answers .fill-switch')).toHaveCount(0);
  await expect(page.locator('#answers .fill-send')).toHaveText('填好了');
  await expect(page.locator('#answers .fill-value')).toHaveText('算出答案後填入');
  await expect(page.locator('#scratch-toggle')).toHaveClass(/nudge/);
  await audit(page, '模擬考的選填題');

  // 點數字鍵填 1、按「填好了」：存起來、換下一題
  await page.locator('#answers .fill-key[data-k="1"]').click();
  await expect(page.locator('#answers .fill-value')).toHaveText('1');
  await page.locator('#answers .fill-send').click();
  await expect(page.locator('#play-progress')).toHaveText('2 / 25');

  // 實體鍵盤：還沒填完（7/）按 Enter 只提示格式、不換題；改好再按 Enter 才換題
  await page.keyboard.press('7');
  await page.keyboard.press('/');
  await page.keyboard.press('Enter');
  await expect(page.locator('#answer-status')).toHaveText('先填入答案：整數、小數或分數，例如 -3、2.5、7/4');
  // 看得到的提示寫在填答框下面：缺的是分母
  await expect(page.locator('#answers .fill-hint')).toHaveText('分數還缺分母：填整數、小數或分數，例如 -3、2.5、7/4');
  await expect(page.locator('#play-progress')).toHaveText('2 / 25');
  await page.keyboard.press('Backspace');
  await expect(page.locator('#answers .fill-hint')).toHaveCount(0);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#play-progress')).toHaveText('3 / 25');
  // 第 3 題填一個不是任何選項的數，直接用右鍵換題（填的照樣存著）
  await page.keyboard.press('-');
  await page.keyboard.press('5');
  await expect(page.locator('#answers .fill-value')).toHaveText('-5');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#play-progress')).toHaveText('4 / 25');
  // 第 4 題只填到「3/」就換題：存著，回來時直接說缺分母
  await page.keyboard.press('3');
  await page.keyboard.press('/');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#play-progress')).toHaveText('5 / 25');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#answers .fill-value')).toHaveText('3/');
  await expect(page.locator('#answers .fill-hint')).toHaveText('分數還缺分母');

  // 回頭看：填的都還在，題號一覽算已作答；沒填完的另外標出來，交卷前也提醒
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#answers .fill-value')).toHaveText('-5');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#answers .fill-value')).toHaveText('2');
  expect((await saved(page)).exam.answers.slice(0, 5)).toEqual(['1', '2', '-5', '3/', null]);
  await page.locator('#exam-index-btn').click();
  await expect(page.locator('#exam-grid .cell.done')).toHaveCount(3);
  await expect(page.locator('#exam-grid .cell.half')).toHaveCount(1);
  await expect(page.locator('#exam-grid .cell').nth(3)).toHaveAttribute('aria-label', '第 4 題，沒填完');
  await expect(page.locator('#exam-index-sum')).toContainText('1 題選填沒填完');
  await page.locator('#exam-submit').click();
  await expect(page.locator('#exam-submit')).toHaveText('還有 21 題沒作答、1 題沒填完，確定交卷');
  await page.locator('#exam-submit').click();

  // 成績單：填 1 的答對；填 2（等於另一個選項）與 -5（不是任何選項）答錯，列出你填的
  await expect(page.locator('#exam-report')).toBeVisible();
  await expect(page.locator('#x-big')).toHaveText('1 / 25');
  await expect(page.locator('#x-list .r-mine').filter({ hasText: '你填：-5' })).toHaveCount(1);
  await expect(page.locator('#x-list .r-mine').filter({ hasText: /^你填：2$/ })).toHaveCount(1);
  const s = await saved(page);
  // 沒填完的「3/」照學測算答錯（不是沒作答）
  expect(s.examLog[0]).toMatchObject({ paper: 'math', total: 25, right: 1, blank: 21 });
  expect(Object.keys(s.cards)).toHaveLength(4);
});

test('考過的卷：交卷後列在模擬考面板，點了重開那一份的成績單與錯題，不再記進今日題數', async ({ page }) => {
  // 面板滑上來的動畫中途顏色是半透明的：無障礙檢查要在減少動態下跑
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  await startPaper(page, 'social');
  for (let i = 1; i <= 3; i++) {
    await page.locator('#answers .answer').first().click();
    await expect(page.locator('#play-progress')).toHaveText(`${i + 1} / 40`);
  }
  await page.locator('#exam-index-btn').click();
  await page.locator('#exam-submit').click();
  await page.locator('#exam-submit').click();
  await expect(page.locator('#exam-report')).toBeVisible();
  const big = await page.locator('#x-big').textContent();
  const listed = await page.locator('#x-list .r-item').count();
  const answered = Object.values((await saved(page)).daily)[0].answered;
  expect((await saved(page)).examPapers).toHaveLength(1);

  await page.locator('#x-home').click();
  await page.locator('#open-exam').click();
  await expect(page.locator('#exam-history')).toBeVisible();
  await expect(page.locator('#exam-past li')).toHaveCount(1);
  await expect(page.locator('#exam-past button')).toContainText('社會');
  await audit(page, '模擬考面板（考過的卷）');
  await page.locator('#exam-past button').click();
  await expect(page.locator('#exam-report')).toBeVisible();
  await expect(page.locator('#x-paper')).toHaveText(/^社會模擬考・\d+\/\d+ 考的$/);
  await expect(page.locator('#x-big')).toHaveText(big);
  await expect(page.locator('#x-list .r-item')).toHaveCount(listed);
  // 重開是回頭訂正：不再寫進排程、今日題數與成績紀錄
  const after = await saved(page);
  expect(Object.values(after.daily)[0].answered).toBe(answered);
  expect(after.examLog).toHaveLength(1);
});

test('模擬考：先離開之後接著考，作答和剩餘時間都還在；時間到自動交卷', async ({ page }) => {
  await openHome(page);
  await startPaper(page, 'english');
  await page.locator('#answers .answer').first().click();
  await expect(page.locator('#play-progress')).toHaveText('2 / 30');
  await page.locator('#answers .answer').first().click();
  await expect(page.locator('#play-progress')).toHaveText('3 / 30');
  await page.locator('#exam-quit').click();
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#exam-sub')).toHaveText('英文考到一半・2/30 題');

  // 只剩 2 秒：重新整理後接著考，時間一到自動交卷
  await page.evaluate((k) => {
    const s = JSON.parse(localStorage.getItem(k));
    s.exam.elapsed = s.exam.limit - 2;
    localStorage.setItem(k, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await waitForBoot(page);
  await page.locator('#open-exam').click();
  await expect(page.locator('#exam-resume-text')).toContainText('已作答 2／30 題，還剩 0:02');
  // 考到一半時不能另開一份
  await expect(page.locator('[data-paper="math"]')).toBeDisabled();
  await page.locator('#exam-continue').click();
  await expect(page.locator('#play-progress')).toHaveText('3 / 30');
  await expect(page.locator('#exam-report')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#x-paper')).toHaveText('英文模擬考・時間到，自動交卷');
  await expect(page.locator('#x-blank')).toHaveText('28');
});

test('學習分析的複習預報：未來 14 天每天到期的題數；複習跟不上時可以一鍵調高每日目標', async ({ page }) => {
  await openHome(page);
  // 12 題答錯過、明天到期的題目；每日目標 10 題（複習和新題交錯，複習只分到一半，跟不上）
  await page.evaluate((k) => {
    // 剛開的 App 還沒存過檔
    const s = JSON.parse(localStorage.getItem(k) ?? '{"cards":{},"settings":{}}');
    const now = Date.now();
    for (let i = 1; i <= 12; i++) {
      s.cards[`math-${String(i).padStart(3, '0')}`] = { box: 2, due: now + 86_400_000, seen: 2, right: 1, wrong: 1, parked: false, missed: 1, last: now };
    }
    s.settings.goal = 10;
    localStorage.setItem(k, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await waitForBoot(page);
  await page.locator('#daily').click();
  // 學習分析要等全部題庫下載完才畫：CI 上比較慢，放寬
  await expect(page.locator('#forecast-chart .bar')).toHaveCount(14, { timeout: 30_000 });
  // 明天：這 12 題，加上今天的新題預估會答錯、隔天要複習的
  const tomorrow = Number(await page.locator('#forecast-chart .bar').nth(1).locator('.bar-n').textContent());
  expect(tomorrow).toBeGreaterThanOrEqual(12);
  await expect(page.locator('#forecast-text')).toContainText(`今天到期 0 題，明天約 ${tomorrow} 題`);
  await expect(page.locator('#forecast-text')).toContainText('會越積越多');
  await expect(page.locator('#forecast-goal')).toHaveText(/^把每日目標改成 \d+ 題$/);
  await page.locator('#forecast-goal').click();
  await expect(page.locator('#forecast-goal')).toBeHidden();
  await expect(page.locator('#forecast-text')).toContainText('複習做得完');
  expect((await saved(page)).settings.goal).toBeGreaterThan(10);
});

test('學習分析的考前規劃：三個數字方塊加一兩句話；範圍太大時不寫每天要做幾千題，範圍小時寫每天做幾題就練得完一輪', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openHome(page);
  /** 改設定後重新整理（學測日期用「幾天後」，測試哪一天跑都一樣） */
  const reopen = async (settings, daysLeft) => {
    await page.evaluate(
      ({ k, settings, daysLeft }) => {
        const s = JSON.parse(localStorage.getItem(k) ?? '{"cards":{},"settings":{}}');
        const t = new Date(Date.now() + daysLeft * 86_400_000);
        const examDate = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        Object.assign(s.settings, settings, { examDate });
        localStorage.setItem(k, JSON.stringify(s));
      },
      { k: KEY, settings, daysLeft },
    );
    await page.reload();
    await waitForBoot(page);
    await page.locator('#daily').click();
    await expect(page.locator('#stats-plan')).toBeVisible({ timeout: 30_000 });
  };
  const tiles = page.locator('#plan-tiles .plan-tile');
  const text = page.locator('#plan-text');

  // 十科全選（三萬多題）、每日目標 30 題、剩 60 天：全部練過一輪每天要做上千題
  await reopen({ goal: 30 }, 60);
  await expect(tiles).toHaveCount(3);
  await expect(tiles.locator('span')).toHaveText(['範圍題數', '已練題數', '考前可練新題']);
  await expect(tiles.nth(0).locator('b')).toHaveText(/^\d{1,3}(,\d{3})+$/);
  await expect(tiles.nth(1).locator('b')).toHaveText('0');
  await expect(tiles.nth(2).locator('b')).toHaveText(/^約 [\d,]+$/);
  await expect(text).toContainText('距學測 60 天');
  await expect(text).toContainText('這個範圍考前練不完一輪是正常的');
  await expect(text).toContainText('首頁的「單元」縮小範圍');
  await expect(text).toContainText('弱點加強');
  // 不寫每天要做幾題，也不建議把每日目標調到做不到的題數
  await expect(text).not.toContainText('每天做約');
  await expect(text).not.toContainText('每天要做');
  await expect(page.locator('#plan-goal')).toBeHidden();
  // 進度條與圖例還在
  await expect(page.locator('#stats-plan .plan-meter')).toBeVisible();
  await expect(page.locator('#plan-legend')).toHaveText(/^已練過 0%・照每日目標 30 題的步調，考前約 \d+%$/);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `考前規劃（${scheme}）`);
  }
  // 三個方塊不會把卡片撐出畫面
  const fit = await page.evaluate(() => {
    const plan = document.querySelector('#stats-plan').getBoundingClientRect();
    return [...document.querySelectorAll('#plan-tiles .plan-tile')].every((t) => {
      const r = t.getBoundingClientRect();
      return r.left >= plan.left && r.right <= plan.right && t.scrollWidth <= t.clientWidth;
    });
  });
  expect(fit).toBe(true);

  // 只選地科、考期還有 400 天：每天做的題數在每日目標的 3 倍以內，寫出每天做幾題就練得完
  await reopen({ subjects: ['earth'], goal: 30 }, 400);
  await expect(tiles).toHaveCount(3);
  await expect(text).toHaveText(/^距學測 400 天。每天做約 [\d,]+ 題（其中複習約 [\d,]+ 題），就能在考前把選的範圍練完一輪。$/);
  const need = Number((await text.textContent()).match(/每天做約 ([\d,]+) 題/)[1].replace(/,/g, ''));
  expect(need).toBeLessThanOrEqual(90);
  await expect(text).not.toContainText('練不完一輪是正常的');

  // 一科都沒選：不顯示數字方塊
  await reopen({ subjects: [] }, 400);
  await expect(text).toHaveText('先在首頁選要練的科目。');
  await expect(page.locator('#plan-tiles')).toBeHidden();
});

test('學習分析只列選了的科目：沒選的科目練過的接在後面標「沒選」，沒練過的不列；沒選英文就不列單字級數', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    if (localStorage.getItem('gsat-quiz:v1')) return;
    const now = Date.now();
    // 練過一題歷史（現在沒選社會）
    const cards = { 'history-001': { box: 2, due: now + 86_400_000, seen: 1, right: 1, wrong: 0, parked: false, missed: 0, last: now - 86_400_000 } };
    localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, cards, settings: { subjects: ['math', 'physics'] } }));
  });
  await openHome(page);
  await page.locator('#daily').click();
  const rows = page.locator('#stats-subjects li');
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  await expect(rows.nth(0)).toContainText('數學');
  await expect(rows.nth(1)).toContainText('物理');
  await expect(rows.nth(2)).toContainText('歷史');
  await expect(rows.nth(2).locator('.subject-done')).toHaveText(/^沒選・練過 1／/);
  await expect(page.locator('#stats-subjects-note')).toHaveText('另外 7 科沒選、也還沒練過，不列出來；在首頁選了就會出現。');
  await expect(page.locator('#stats-vocab')).toBeHidden();
  await expect(page.locator('#stats-tiles')).toContainText('範圍內熟練度');
  await audit(page, '學習分析：只選兩科');
});

test('學習分析的英文單字：依詞彙表級數列出練過題數與正確率，「練這一級」只出那一級的單字題', async ({ page }) => {
  await openHome(page);
  await page.locator('#daily').click();
  await expect(page.locator('#stats-vocab')).toBeVisible();
  // 題庫的單字題在第 1–5 級（學測詞彙題不考第 6 級，題庫也沒有）
  await expect(page.locator('#vocab-levels li')).toHaveCount(5);
  await expect(page.locator('#vocab-levels li').first()).toContainText('第 1 級');
  await expect(page.locator('#vocab-levels li').last()).toContainText(/練過 0／\d+ 題・正確率 —/);
  await page.locator('#vocab-levels .vocab-train[data-lv="5"]').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#q-subject')).toHaveText('英文');
  await expect(page.locator('#q-topic')).toHaveText(/單字/);
});
