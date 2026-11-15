// 抽查：第一次就答對的單選題（照題號抽到的），3 天後從同一個考點出一題沒做過的，作答畫面標「抽查」；
// 沒過（答錯、或答對後標成猜的）時，原本那題改成等確認、隔天再考；取消標記就放回去
import { CONFIRM_BOX, spotSampled } from '../src/srs.js';
import { audit, expect, openHome, test } from './fixtures.js';

const DAY = 86_400_000;
const pick = (want) => {
  for (let i = 0; ; i++) {
    const id = `physics-9${String(800 + i)}`;
    if (spotSampled({ id, kp: '01-01', type: 'mc' }) === want) return id;
  }
};
const S = pick(true);
const base = { subject: 'physics', topic: '牛頓運動定律', type: 'mc', level: 2 };
const samples = [
  { ...base, id: S, kp: '01-01', q: '靜止的物體不受外力時會如何？', choices: ['保持靜止', '開始加速', '開始減速', '來回振動'], answer: 0, explain: '慣性定律：不受外力時保持原來的運動狀態。' },
  { ...base, id: 'physics-9701', kp: '01-01', q: '等速度前進的車子突然沒有任何外力作用，車子接下來會怎樣？', choices: ['維持等速度前進', '逐漸停下', '立刻停下', '轉彎'], answer: 0, explain: '沒有外力就保持原來的速度，這是慣性。' },
  { ...base, id: 'physics-9702', kp: '01-02', q: '施力相同時，質量越大的物體加速度如何？', choices: ['越小', '越大', '不變', '變成零'], answer: 0, explain: '$a=F/m$，質量越大加速度越小。' },
  { ...base, id: 'physics-9703', kp: '01-03', q: '甲推乙時，乙對甲的反作用力大小如何？', choices: ['和甲推乙的力一樣大', '比較大', '比較小', '等於零'], answer: 0, explain: '作用力與反作用力大小相等、方向相反。' },
];

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/assets/physics-*.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (Array.isArray(body) && body[0]?.id?.startsWith('physics-')) await route.fulfill({ response: res, json: samples });
    else await route.fulfill({ response: res });
  });
  await page.addInitScript(
    ({ S, DAY }) => {
      if (localStorage.getItem('gsat-quiz:v1')) return;
      const now = Date.now();
      const cards = {};
      // 有作答紀錄的老手（不在題庫裡的題號），出題才不會只出新手的單題
      for (let i = 0; i < 20; i++) cards[`seed-${900 + i}`] = { box: 2, due: now + DAY, seen: 1, right: 1, wrong: 0, parked: false, missed: 0, last: now - DAY };
      // 4 天前第一次就答對、被抽到的那題
      cards[S] = { box: 2, due: now - 3 * DAY, seen: 1, right: 1, wrong: 0, parked: false, missed: 0, last: now - 4 * DAY };
      localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, cards, settings: { subjects: ['physics'] } }));
    },
    { S, DAY },
  );
});

const cardOf = (page, id) => page.evaluate((id) => JSON.parse(localStorage.getItem('gsat-quiz:v1')).cards[id] ?? null, id);

test('抽查答錯：題目標「抽查」，解析說明原本那題明天再考，原本那題改成等確認', async ({ page }) => {
  await openHome(page);
  await page.locator('[data-mode="free"]').click();
  await expect(page.locator('#play')).toBeVisible();
  await expect(page.locator('#q-text')).toContainText('等速度前進的車子');
  await expect(page.locator('#q-topic')).toContainText('抽查');
  await audit(page, '抽查');

  await page.locator('#answers .answer').filter({ hasNotText: '維持等速度前進' }).first().click();
  await expect(page.locator('#q-explain .spot-note')).toContainText('這題是抽查');
  const doubted = await cardOf(page, S);
  expect(doubted).toMatchObject({ box: CONFIRM_BOX, seen: 1, right: 1 });
  expect(doubted.due).toBeGreaterThan(Date.now());
  expect(doubted.due).toBeLessThan(Date.now() + 2 * DAY);

  // 下一題是別的考點的新題，不標抽查
  await page.locator('#next').click();
  await expect(page.locator('#q-topic')).not.toContainText('抽查');
});

test('抽查答對：原本那題不動；標成猜的就拉回來，取消標記再放回去', async ({ page }) => {
  await openHome(page);
  await page.locator('[data-mode="free"]').click();
  await expect(page.locator('#q-topic')).toContainText('抽查');
  const before = await cardOf(page, S);

  await page.locator('#answers .answer', { hasText: '維持等速度前進' }).click();
  await expect(page.locator('#certain')).toBeVisible();
  await expect(page.locator('#q-explain .spot-note')).toHaveCount(0);
  expect(await cardOf(page, S)).toEqual(before);

  await page.locator('#guess').click();
  await expect(page.locator('#guess')).toHaveAttribute('aria-pressed', 'true');
  expect(await cardOf(page, S)).toMatchObject({ box: CONFIRM_BOX, seen: 1 });

  await page.locator('#guess').click();
  await expect(page.locator('#guess')).toHaveAttribute('aria-pressed', 'false');
  const back = await cardOf(page, S);
  expect({ ...back, last: before.last }).toEqual(before);
});
