// 共用的測試前置：擋掉同步後端（測試不能寫到正式資料庫，錯誤回報也不能送出去），
// 並記下頁面上的未捕捉錯誤，每個測試結束時必須是零。
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  // iPhone 的 Safari 練過一輪後會跳出「加入主畫面」的提醒，蓋住首頁。預設當成已經看過；要測提醒本身的測試用 test.use({ installHint: true })
  installHint: [false, { option: true }],
  page: async ({ page, installHint }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (!installHint) {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('gsat-quiz:install-hint', String(Date.now()));
        } catch {
          // 存不了就算了
        }
      });
    }
    // 固定亂數種子：每次跑都出同一批題目、同樣的選項順序，無障礙檢查掃到的畫面一樣，失敗才重現得出來
    await page.addInitScript(() => {
      let seed = 20261104;
      Math.random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    await page.route('https://gsat-sync.ragorothers.workers.dev/**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"blocked in e2e"}' }),
    );
    await use(page);
    expect(errors, '頁面上不該有未捕捉的錯誤').toEqual([]);
  },
});

export { expect };

/** 無障礙檢查（axe）：只看嚴重的問題；3D 畫布是裝飾（aria-hidden），不檢查 */
export async function audit(page, where) {
  // 剛換深淺色時文字顏色還在過場：繼承來的顏色在 Safari 是一層一層接力換的（html → body → … → 題幹，約 0.2 秒），
  // 等內文換成這個主題的墨色、而且沒有任何過場還在跑再檢查，不然會量到換到一半的對比
  await page.waitForFunction(() => {
    const probe = document.createElement('i');
    probe.style.cssText = 'color:var(--ink);transition:none;position:absolute;visibility:hidden';
    document.body.append(probe);
    const ink = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(document.body).color === ink && !document.getAnimations().some((a) => a instanceof CSSTransition);
  });
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('#world').analyze();
  const serious = violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${where}｜${v.id}：${v.help}\n${v.nodes.slice(0, 5).map((n) => `  ${n.target.join(' ')}｜${n.failureSummary?.split('\n').slice(1, 2).join('')}`).join('\n')}`);
  expect(serious, serious.join('\n\n')).toEqual([]);
}

/** 等題庫載入完成：題庫有兩萬多題，平行跑的測試一起下載、解析時會超過預設的 10 秒，所以放寬 */
export async function waitForBoot(page) {
  await expect(page.locator('#boot')).toBeHidden({ timeout: 30_000 });
}

/** 開首頁並等題庫載入完成 */
export async function openHome(page) {
  await page.goto('./');
  await waitForBoot(page);
  await expect(page.locator('#home')).toBeVisible();
}

/** 從首頁開始一個模式 */
export async function startMode(page, mode) {
  await page.locator(`[data-mode="${mode}"]`).click();
  await expect(page.locator('#play')).toBeVisible();
}

/** 按「不會？看解答」再按「繼續」，一題一題看完直到結算 */
export async function skipToResult(page, max = 30) {
  for (let i = 0; i < max; i++) {
    if (await page.locator('#result').isVisible()) return;
    await page.locator('#skip').click();
    await page.locator('#next').click();
  }
  await expect(page.locator('#result')).toBeVisible();
}

/** 這一輪的總題數（「1 / 11」→ 11）：題組不拆開，最後一組放不下也整組出，所以一輪可能比 10 題多 */
export async function roundSize(page) {
  return Number((await page.locator('#play-progress').textContent()).split('/')[1]);
}

/** 跳過多選題、填答的演算題與非選擇題（按「不會？看解答」再「繼續」），停在點一下就作答的題目。
 * 題庫一變，固定種子抽到的第一題也會變，假設「點第一個選項就作答」的測試先呼叫這個 */
export async function skipToSingle(page, max = 30) {
  for (let i = 0; i < max; i++) {
    await expect(page.locator('#answers .answer, #answers .fill-switch, #answers .open-reveal').first()).toBeVisible();
    let single = true;
    for (const sel of ['#ms-send', '#answers .fill-switch', '#answers .open-reveal']) if (await page.locator(sel).isVisible()) single = false;
    if (single) return;
    await page.locator('#skip').click();
    await page.locator('#next').click();
  }
  throw new Error(`連續 ${max} 題都是多選題、演算題或非選擇題`);
}

/** 作答這一題：點第一個選項（演算題改用選項作答、多選題選一個就送出；非選擇題看了參考答案、勾第一個要點就送出） */
export async function answerFirst(page) {
  if (await page.locator('#answers .fill-switch').isVisible()) await page.locator('#answers .fill-switch').click();
  if (await page.locator('#answers .open-reveal').isVisible()) await page.locator('#answers .open-reveal').click();
  await page.locator('#answers .answer').first().click();
  if (await page.locator('#ms-send').isVisible()) await page.locator('#ms-send').click();
}

/** 每題都點第一個選項作答（答錯就按「繼續」），直到結算 */
export async function answerToResult(page, max = 30) {
  for (let i = 0; i < max; i++) {
    if (await page.locator('#result').isVisible()) return;
    const progress = await page.locator('#play-progress').textContent();
    await answerFirst(page);
    // 答對會自己換下一題；答錯或要看解析時等「繼續」出現
    await page.waitForFunction(
      (p) => !document.querySelector('#next').hidden || document.querySelector('#play').hidden || document.querySelector('#play-progress').textContent !== p,
      progress,
    );
    if (await page.locator('#next').isVisible()) await page.locator('#next').click();
  }
  await expect(page.locator('#result')).toBeVisible();
}
