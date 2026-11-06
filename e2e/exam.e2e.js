// 模擬考與複習預報
import { expect, openHome, test, waitForBoot } from './fixtures.js';

const KEY = 'gsat-quiz:v1';
const saved = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);

async function startPaper(page, paper) {
  await page.locator('#open-exam').click();
  await expect(page.locator('#exam-sheet')).toBeVisible();
  await page.locator(`[data-paper="${paper}"]`).click();
  await expect(page.locator('#play')).toHaveClass(/exam/);
}

test('模擬考：作答時不對答案，可以標記、跳題、回頭改；交卷後看成績單，作答算進今日進度', async ({ page }) => {
  await openHome(page);
  await startPaper(page, 'social');
  await expect(page.locator('#play-progress')).toHaveText('1 / 40');
  await expect(page.locator('#exam-clock')).toHaveText(/^(30:00|29:5\d)$/);
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
  // 社會卷只有單選：得分就是答對題數
  await expect(page.locator('#x-acc-label')).toHaveText('答對率');
  await expect(page.locator('#x-blank')).toHaveText('35');
  await expect(page.locator('#x-units li').first()).toBeVisible();
  await expect(page.locator('#x-slow li')).toHaveCount(5);
  // 答錯、沒作答、標記過的都列出來（至少沒作答的 35 題）
  expect(await page.locator('#x-list .r-item').count()).toBeGreaterThanOrEqual(35);

  // 作答的 5 題寫進排程與今日題數；沒作答的不記；考卷不再存著，成績記下來
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

  // 練這份的錯題：一般的作答畫面
  await page.locator('#x-train').click();
  await expect(page.locator('#play')).toBeVisible();
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
  await expect(page.locator('#forecast-chart .bar')).toHaveCount(14);
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
