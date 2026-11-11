// 題型：演算題的填答（像學測選填）、多選題
import { audit, expect, openHome, seedVeteran, test } from './fixtures.js';

/** 從錯題本搜尋題號，只練這一題 */
async function practice(page, id) {
  await openHome(page);
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="search"]').click();
  await page.locator('#notebook-search').fill(id);
  await expect(page.locator('#notebook-count')).toHaveText('1');
  await page.locator('#notebook-train').click();
  await expect(page.locator('#play')).toBeVisible();
}

test('英文單字題答錯：解析標出正解在參考詞彙表的級數，結算畫面也看得到', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // english-1711：正解 abrupt 是《高中英文參考詞彙表》第 5 級
  await practice(page, 'english-1711');
  await page.locator('#answers .answer').filter({ hasNotText: 'abrupt' }).first().click();
  await expect(page.locator('#q-explain .lv-tag')).toHaveText('詞彙表第 5 級');
  // 考點和級數兩個標籤並排，各自一個
  await expect(page.locator('#q-explain .kp-tag')).toHaveText(/^考點：.{2,14}$/);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `詞彙表級數（${scheme}）`);
  }
  await page.locator('#next').click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#r-list .lv-tag')).toHaveText('詞彙表第 5 級');
});

test('演算題填答：不先看選項，自己算出答案用數字鍵填；填的不是任何一個選項也記下來', async ({ page }) => {
  // 關掉動畫：題目卡淡入到一半時檢查對比度會誤判
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // math-4565：選項是 1/6、5/24、1/8、1/24 這種分數
  await practice(page, 'math-4565');
  await expect(page.locator('#answers .answer')).toHaveCount(0);
  await expect(page.locator('#answers .fill-value')).toHaveText('算出答案後填入');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    // App 收到系統深淺色改變後才換主題（appearance.js），等換好再檢查
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `填答（${scheme}）`);
  }

  // 沒填就送出：提示怎麼填
  await page.locator('#answers .fill-send').click();
  await expect(page.locator('#answer-status')).toContainText('先填入答案');

  // 點數字鍵：分數線只能接在數字後面、只能有一條；負號是切換；⌫ 刪一個字
  for (const k of ['/', '2', '/', '/', '7', '5', '-']) await page.locator(`#answers .fill-key[data-k="${k}"]`).click();
  await expect(page.locator('#answers .fill-value')).toHaveText('-2/75');
  await page.locator('#answers .fill-key[data-k="-"]').click();
  for (let i = 0; i < 4; i++) await page.locator('#answers .fill-key[data-k="back"]').click();
  await expect(page.locator('#answers .fill-value')).toHaveText('算出答案後填入');
  // 也可以直接打字（點數字鍵不會搶走焦點，接著按 Enter 是送出）：.3 補成 0.3
  await page.keyboard.type('.3');
  await expect(page.locator('#answers .fill-value')).toHaveText('0.3');
  await page.keyboard.press('Enter');

  // 0.3 不是任何一個選項：答錯，換回選項標出正解，解析上面寫出你填的
  await expect(page.locator('#answers .answer')).toHaveCount(4);
  await expect(page.locator('#answers .answer.correct')).toHaveCount(1);
  await expect(page.locator('#answers .answer.wrong')).toHaveCount(0);
  await expect(page.locator('#q-explain .ms-score')).toHaveText('你填的 0.3 不是任何一個選項的值');
  await expect(page.locator('#answer-status')).toContainText('你填 0.3');
  await page.locator('#next').click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#r-list .r-mine')).toHaveText('你填：0.3');
});

test('演算題填答：填的值和選項相同就是選了那個選項（1/8 = 0.125）；算不出來可以改用選項作答', async ({ page }) => {
  await practice(page, 'math-4565');
  await page.keyboard.type('0.125');
  await page.keyboard.press('Enter');
  // 0.125 就是選項 1/8：標成你填的那個選項
  await expect(page.locator('#answers .answer.wrong')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /^1\/8\s*（你填的）$/ })).toHaveClass(/wrong/);
  await expect(page.locator('#answer-status')).toContainText('你填 0.125');

  // 帶單位的演算題：單位寫在填答框後面；改用選項作答就出現四個選項
  await page.locator('#quit').click();
  if (await page.locator('#r-home').isVisible()) await page.locator('#r-home').click();
  await page.locator('#open-notebook').click();
  await page.locator('#notebook-views [data-view="search"]').click();
  await page.locator('#notebook-search').fill('physics-3352');
  // 上一次搜尋也是 1 題：等清單換成這題再開始
  await expect(page.locator('#notebook-list .tag')).toHaveText('物理');
  await page.locator('#notebook-train').click();
  await expect(page.locator('#answers .fill-unit')).toHaveText('N');
  await page.locator('#answers .fill-switch').click();
  await expect(page.locator('#answers .answer')).toHaveCount(4);
  await expect(page.locator('#answers .fill-box')).toHaveCount(0);
});

test('多選題：點選項切換、按「送出」作答；沒全對時標出漏選，並照學測規則說明這題還拿得到幾分', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // chinese-1375：寫信給祖父，正解是「開頭稱祖父大人」「末尾署孫女怡文」
  await practice(page, 'chinese-1375');
  await expect(page.locator('#q-topic')).toContainText('多選');
  await expect(page.locator('#answers .answer')).toHaveCount(5);
  // 一個都沒選時送不出去
  await expect(page.locator('#ms-send')).toBeDisabled();
  await page.keyboard.press('Enter');
  await expect(page.locator('#answer-status')).toContainText('先選選項');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `多選題作答（${scheme}）`);
  }

  // 選一個對的、一個錯的；點兩次是取消
  const option = (name) => page.locator('#answers .answer', { hasText: name });
  await option('開頭稱祖父大人').click();
  await option('以世伯稱呼德成').click();
  await option('以世伯稱呼德成').click();
  await option('末尾署姪女怡文').click();
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(2);
  await expect(page.locator('#ms-send')).toBeEnabled();
  await page.locator('#ms-send').click();

  // 選對的打圈、選錯的打叉、該選沒選的標漏選；錯 2 個選項，學測這題得 1/5
  await expect(page.locator('#ms-send')).toBeHidden();
  await expect(option('開頭稱祖父大人')).toHaveClass(/correct/);
  await expect(option('末尾署姪女怡文')).toHaveClass(/wrong/);
  await expect(option('末尾署孫女怡文')).toHaveClass(/missed/);
  await expect(option('末尾署孫女怡文').locator('.miss-tag')).toHaveText('漏選');
  await expect(option('以世伯稱呼德成')).toHaveClass(/dim/);
  await expect(page.locator('#q-explain .ms-score')).toHaveText('答錯 2 個選項：學測這題可得 1/5 的分數');
  await audit(page, '多選題作答後');

  await page.locator('#next').click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#r-list .r-mine')).toHaveText('你選：開頭稱祖父大人。；末尾署姪女怡文。');
  await expect(page.locator('#r-list .r-right')).toHaveText('正解：開頭稱祖父大人。；末尾署孫女怡文。');
});

test('卡關的題目：同一題失手第三次時，解析下面提醒先看這個單元的重點', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // english-1711 已經失手過兩次
  await page.addInitScript(() => {
    if (localStorage.getItem('gsat-quiz:v1')) return;
    const now = Date.now();
    const card = { box: 0, due: now - 1000, seen: 2, right: 0, wrong: 2, parked: false, missed: 1, last: now - 3_600_000 };
    localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, cards: { 'english-1711': card } }));
  });
  await practice(page, 'english-1711');
  await page.locator('#answers .answer').filter({ hasNotText: 'abrupt' }).first().click();
  const note = page.locator('#q-explain .leech-note');
  await expect(note).toContainText('這題已經失手 3 次');
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `卡關提示（${scheme}）`);
  }
  await note.getByRole('button', { name: '看這個單元的重點' }).click();
  await expect(page.locator('#kp-unit')).toHaveText('進階單字');
  await expect(page.locator('#kp-body')).toBeVisible();
});

test('作答速度：一般題記下每題花的秒數，學習分析列出各科平均與「會但花得久」的單元', async ({ page }) => {
  // 數學：機率答對平均 40 秒，其他單元 15 秒
  await page.addInitScript(() => {
    if (localStorage.getItem('gsat-quiz:v1')) return;
    const pace = { 'math/機率': { n: 10, t: 400, rn: 8, rt: 320 }, 'math/矩陣': { n: 30, t: 450, rn: 30, rt: 450 } };
    localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, pace, settings: { subjects: ['math'] } }));
  });
  await openHome(page);
  await page.locator('#daily').click();
  await expect(page.locator('#stats-pace')).toBeVisible();
  await expect(page.locator('#pace-subjects li')).toHaveText(/數學\s*平均每題 21 秒・計時 40 題・學測每題約 77 秒/);
  await expect(page.locator('#pace-slow li')).toHaveText(/數學\s*機率\s*答對平均 40 秒（這科 20 秒）/);
  await audit(page, '作答速度');

  // 再答一題一般題：計時的題數多一題
  await page.locator('#stats-back').click();
  await page.locator('[data-mode="free"]').click();
  await expect(page.locator('#play')).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await expect(page.locator('#answers .answer, #answers .fill-switch, #answers .open-reveal').first()).toBeVisible();
    const plain =
      !(await page.locator('#ms-send').isVisible()) &&
      !(await page.locator('#answers .fill-switch').isVisible()) &&
      !(await page.locator('#answers .open-reveal').isVisible()) &&
      !(await page.locator('#q-passage').isVisible());
    if (plain) break;
    await page.locator('#skip').click();
    await page.locator('#next').click();
  }
  await page.locator('#answers .answer').first().click();
  const timed = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('gsat-quiz:v1')).pace).reduce((a, p) => a + p.n, 0));
  expect(timed).toBe(41);
});

test('圖表題：題幹下面畫出圖或資料表，圖帶文字敘述；深淺色與結算都看得到', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // 把物理題庫換成兩題範例（折線圖、資料表）：不靠題庫裡剛好抽到哪一題
  const base = { subject: 'physics', type: 'mc', formula: false, level: 2 };
  const figs = [
    {
      ...base,
      id: 'physics-9901',
      topic: '牛頓運動定律',
      q: '一輛玩具車沿直線運動，速度與時間的關係如圖。哪一段時間內車子所受的合力為零？',
      fig: { type: 'line', x: { label: '時間 (s)' }, y: { label: '速度 (m/s)' }, series: [{ points: [[0, 0], [2, 8], [6, 8], [8, 0]] }] },
      choices: ['0–2 秒', '2–6 秒', '6–8 秒', '0–8 秒全程'],
      answer: 1,
      explain: '2–6 秒速度不變，加速度為零，合力為零。',
    },
    {
      ...base,
      id: 'physics-9902',
      topic: '克卜勒定律與萬有引力',
      q: '甲、乙兩顆行星繞同一恆星運行，資料如表。乙的公轉週期是甲的幾倍？',
      fig: { type: 'table', cols: ['行星', '軌道半徑', '週期 (年)'], rows: [['甲', '$R$', 1], ['乙', '$4R$', '？']] },
      choices: ['$8$', '$4$', '$16$', '$2$'],
      answer: 0,
      explain: '克卜勒第三定律 $T^2\\propto R^3$：$4^3=64=8^2$，週期是 8 倍。',
    },
  ];
  await page.route('**/assets/physics-*.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    // 同樣開頭的還有重點卡的檔案：只換題庫
    if (Array.isArray(body) && body[0]?.id?.startsWith('physics-')) await route.fulfill({ response: res, json: figs });
    else await route.fulfill({ response: res });
  });
  // 過了新手期（作答紀錄滿 20 題）10 題一輪才出圖表題
  await seedVeteran(page, { subjects: ['physics'] });
  await openHome(page);
  await page.locator('[data-mode="ten"]').click();
  await expect(page.locator('#play')).toBeVisible();

  const seen = [];
  for (let i = 0; i < 2; i++) {
    const fig = page.locator('#q-text .fig');
    await expect(fig).toBeVisible();
    if (await fig.locator('table').count()) {
      seen.push('table');
      await expect(fig.locator('tbody tr')).toHaveCount(2);
      // 儲存格裡的公式照樣排版
      await expect(fig.locator('tbody .katex').first()).toBeVisible();
    } else {
      seen.push('line');
      const svg = fig.locator('svg[role="img"]');
      await expect(svg).toHaveAttribute('aria-label', /折線圖，橫軸：時間 \(s\)，縱軸：速度 \(m\/s\)。\(0, 0\)、\(2, 8\)、\(6, 8\)、\(8, 0\)/);
      await expect(svg.locator('.fig-line')).toHaveCount(1);
      await expect(svg.locator('.fig-dot')).toHaveCount(4);
      // 圖不會把題目卡撐出畫面
      const box = await svg.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    }
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
      await audit(page, `圖表題 ${seen.at(-1)}（${scheme}）`);
    }
    await page.locator('#skip').click();
    await page.locator('#next').click();
  }
  expect(seen.sort()).toEqual(['line', 'table']);
  await expect(page.locator('#result')).toBeVisible();
  // 結算列出題目時圖表也在
  await expect(page.locator('#r-list .fig')).toHaveCount(2);
});

// ── 小螢幕作答後：沒選到的錯誤選項收成一行，高度讓給題目卡 ──────────
const foldBase = { subject: 'physics', type: 'mc', topic: '牛頓運動定律', formula: false, level: 2 };
// 題幹、選項與解析都長：375×667 上作答後題目卡一定放不下
const FOLD_LONG = {
  ...foldBase,
  id: 'physics-9911',
  q: '小安在水平桌面上用彈簧秤沿水平方向拉一個質量 2 kg 的木塊。彈簧秤讀數由 0 慢慢增加，讀數到 6 N 時木塊才開始滑動；滑動之後，他調整拉力讓木塊維持等速度前進，這時讀數穩定在 4 N。接著他把拉力加大到 10 N 並維持不變。若重力加速度取 10 m/s²，關於這個實驗，下列敘述何者正確？',
  choices: [
    '木塊開始滑動前，桌面給它的靜摩擦力一直等於 6 N，和拉力大小無關',
    '木塊與桌面之間的動摩擦係數是 0.2，拉力 10 N 時加速度是 3 m/s²',
    '木塊等速度前進時所受合力不為零，因為彈簧秤的讀數不是零',
    '拉力加大到 10 N 之後，動摩擦力也跟著變大成 10 N，所以木塊仍然等速',
  ],
  answer: 1,
  explain:
    '滑動前靜摩擦力隨拉力改變，最大值才是 6 N。等速時合力為零，動摩擦力等於拉力 4 N，所以動摩擦係數 = 4 ÷ (2 × 10) = 0.2。動摩擦力和拉力大小無關，拉力變成 10 N 時合力是 10 − 4 = 6 N，加速度 = 6 ÷ 2 = 3 m/s²。常見的錯誤是把最大靜摩擦力當成動摩擦力，或以為摩擦力會跟著拉力一起變大。',
};
// 題幹、選項、解析都短：作答後題目卡放得下
const FOLD_SHORT = { ...foldBase, id: 'physics-9912', q: '力的 SI 單位是什麼？', choices: ['牛頓', '焦耳', '瓦特', '帕'], answer: 0, explain: '力的單位是牛頓（N）。' };

/** 把物理題庫換成這幾題，首頁只選物理，開始 10 題一輪 */
async function mockFold(page, questions) {
  await page.route('**/assets/physics-*.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    // 同樣開頭的還有重點卡的檔案：只換題庫
    if (Array.isArray(body) && body[0]?.id?.startsWith('physics-')) await route.fulfill({ response: res, json: questions });
    else await route.fulfill({ response: res });
  });
  await seedVeteran(page, { subjects: ['physics'] });
  await openHome(page);
  await page.locator('[data-mode="ten"]').click();
  await expect(page.locator('#play')).toBeVisible();
}

test('小螢幕（375×667）作答後題目卡放不下：沒選到的錯誤選項各收成一行，點一下全部展開；展開後還是不能作答', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 667 });
  await mockFold(page, [FOLD_LONG]);
  const answers = page.locator('#answers');
  await expect(answers.locator('.answer')).toHaveCount(4);
  await expect(answers).not.toHaveClass(/folded/);
  // 選一個錯的：正解、你選錯的照原樣，另外兩個變淡的收成一行
  await answers.locator('.answer', { hasText: '合力不為零' }).click();
  await expect(page.locator('#q-explain')).toBeVisible();
  await expect(answers).toHaveClass(/folded/);
  await expect(answers.locator('.answer.dim')).toHaveCount(2);

  const measure = () =>
    page.evaluate(() => {
      const h = (el) => Math.round(el.getBoundingClientRect().height);
      const all = [...document.querySelectorAll('#answers .answer')];
      // 選項的字排成幾行（看文字每一行的位置，不是按鈕的外框）
      const lines = (b) => {
        const range = document.createRange();
        range.selectNodeContents(b.querySelector('.answer-text'));
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      };
      return {
        dim: all.filter((b) => b.classList.contains('dim')).map((b) => ({ h: h(b), lines: lines(b), clipped: b.querySelector('.answer-text').scrollWidth > b.querySelector('.answer-text').clientWidth })),
        kept: all.filter((b) => !b.classList.contains('dim')).map(h),
        right: Math.max(...all.map((b) => b.getBoundingClientRect().right)),
        pageWidth: document.documentElement.scrollWidth,
        card: h(document.querySelector('#card')),
        answers: h(document.querySelector('#answers')),
        screenOverflow: document.querySelector('#play').scrollHeight - document.querySelector('#play').clientHeight,
      };
    });
  const folded = await measure();
  // 收起來的每個一行、超出省略；正解與選錯的那個還是完整的兩行
  for (const d of folded.dim) {
    expect(d.h).toBeLessThanOrEqual(34);
    expect(d.lines).toBe(1);
    expect(d.clipped).toBe(true);
  }
  for (const k of folded.kept) expect(k).toBeGreaterThanOrEqual(44);
  // 不換行的字不能把選項撐出畫面
  expect(folded.right).toBeLessThanOrEqual(375);
  expect(folded.pageWidth).toBeLessThanOrEqual(375);
  expect(folded.screenOverflow).toBeLessThanOrEqual(1);
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `作答後收起錯誤選項（${scheme}）`);
  }

  // 點選項之間的空隙、點正解都不展開
  await answers.locator('.answer.correct').click({ force: true });
  await expect(answers).toHaveClass(/folded/);
  // 點其中一個收起來的（它是停用的按鈕，點擊落在選項區）：全部展開回原樣，題目卡把高度還回去
  const box = await answers.locator('.answer.dim').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(answers).not.toHaveClass(/folded/);
  const open = await measure();
  for (const d of open.dim) {
    expect(d.h).toBeGreaterThanOrEqual(44);
    expect(d.lines).toBeGreaterThan(1);
  }
  expect(open.answers).toBeGreaterThan(folded.answers + 30);
  expect(open.card).toBeLessThan(folded.card - 30);
  // 展開後還是批改完的狀態：選項都停用，再點也不會重新作答
  await expect(answers.locator('.answer:disabled')).toHaveCount(4);
  const again = await answers.locator('.answer.dim').first().boundingBox();
  await page.mouse.click(again.x + again.width / 2, again.y + again.height / 2);
  await expect(answers).not.toHaveClass(/folded/);
  await expect(answers.locator('.answer.correct')).toHaveCount(1);
  await expect(answers.locator('.answer.wrong')).toHaveCount(1);
  await expect(page.locator('#play-progress')).toHaveText('1 / 1');
  await page.locator('#next').click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#r-big')).toHaveText('0 / 1');
});

test('作答後題目卡放得下就不收：小螢幕與大螢幕（412×915）上的短題，沒選到的選項都維持原樣', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 667 });
  await mockFold(page, [FOLD_SHORT]);
  const answers = page.locator('#answers');
  await answers.locator('.answer', { hasText: '焦耳' }).click();
  await expect(page.locator('#q-explain')).toBeVisible();
  await expect(answers.locator('.answer.dim')).toHaveCount(2);
  await expect(answers).not.toHaveClass(/folded/);
  expect(await page.locator('#card').evaluate((c) => c.scrollHeight - c.clientHeight)).toBeLessThanOrEqual(2);

  // 大螢幕重來一次
  await page.locator('#next').click();
  await expect(page.locator('#result')).toBeVisible();
  await page.setViewportSize({ width: 412, height: 915 });
  await page.locator('#r-again').click();
  await expect(page.locator('#play')).toBeVisible();
  await answers.locator('.answer', { hasText: '瓦特' }).click();
  await expect(page.locator('#q-explain')).toBeVisible();
  await expect(answers).not.toHaveClass(/folded/);
});

test('小螢幕按「不會」看解答的長題：三個錯誤選項都收成一行，正解完整顯示', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 375, height: 667 });
  await mockFold(page, [FOLD_LONG]);
  await page.locator('#skip').click();
  await expect(page.locator('#q-explain')).toBeVisible();
  await expect(page.locator('#answers')).toHaveClass(/folded/);
  await expect(page.locator('#answers .answer.dim')).toHaveCount(3);
  const heights = await page.locator('#answers .answer').evaluateAll((list) => list.map((b) => [b.classList.contains('correct'), Math.round(b.getBoundingClientRect().height)]));
  for (const [correct, h] of heights) {
    if (correct) expect(h).toBeGreaterThanOrEqual(44);
    else expect(h).toBeLessThanOrEqual(34);
  }
  // 換下一題（這裡是結算）不會把收起的狀態帶過去：再來一輪的選項是完整的
  await page.locator('#next').click();
  await page.locator('#r-again').click();
  await expect(page.locator('#answers')).not.toHaveClass(/folded/);
  await expect(page.locator('#answers .answer:disabled')).toHaveCount(0);
});

// ── 非選擇題（type: "open"）：題庫還沒有這種題，把英文題庫換成樣本題來測 ──────────
const openBase = { subject: 'english', type: 'open' };
const OPEN_SHORT = {
  ...openBase,
  id: 'english-9901',
  topic: '假設語氣與特殊句構',
  level: 2,
  q: '我當初不該把她的幫助視為理所當然。',
  answer: 'I should not have taken her help for granted.',
  points: ['should not have + 過去分詞', '片語 take … for granted', '受詞是 her help'],
  explain: '對過去做過的事後悔，用 should not have + 過去分詞；「視為理所當然」是 take … for granted。',
};
// 參考答案和要點都接近長度上限、四個要點：小螢幕上作答區放不下、要捲動
const OPEN_LONG = {
  ...openBase,
  id: 'english-9902',
  topic: '時態與語態',
  level: 3,
  q: '他抵達車站時，那班開往台南的火車已經離開十分鐘了，所以他只好改搭客運。',
  answer: 'By the time he arrived at the station, the train bound for Tainan had already been gone for ten minutes, so he had no choice but to take an intercity bus instead.',
  points: ['By the time 子句用過去簡單式 arrived', '主要子句用過去完成式 had been gone', '片語 have no choice but to + 原形動詞', '「開往台南的」寫成 bound for Tainan'],
  explain: '先發生的事（火車離開）用過去完成式，後發生的用過去簡單式；「只好」是 have no choice but to，後面接原形動詞。',
};

/** 把英文題庫換成這幾題非選擇題，首頁只選英文 */
async function mockOpen(page, questions) {
  await page.route('**/assets/english-*.json', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    // 同樣開頭的還有重點卡的檔案：只換題庫
    if (Array.isArray(body) && body[0]?.id?.startsWith('english-')) await route.fulfill({ response: res, json: questions });
    else await route.fulfill({ response: res });
  });
  // 過了新手期（作答紀錄滿 20 題）10 題一輪才出非選擇題
  await seedVeteran(page, { subjects: ['english'] });
  await openHome(page);
  await page.locator('[data-mode="ten"]').click();
  await expect(page.locator('#play')).toBeVisible();
}

/** 深淺色各檢查一次無障礙 */
async function auditBoth(page, where) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await audit(page, `${where}（${scheme}）`);
  }
}

/** 畫面上這題是哪一題樣本（出題順序是打亂的） */
async function shownOpen(page, questions) {
  const stem = (await page.locator('#q-text').textContent()).trim();
  const q = questions.find((x) => x.q === stem);
  expect(q, `畫面上的題幹「${stem}」不是樣本題`).toBeTruthy();
  return q;
}

test('非選擇題：先自己寫，看參考答案後勾寫到的要點自評；沒全寫到算答錯，全寫到算答對，結算看得到參考答案與自評', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const samples = [OPEN_SHORT, OPEN_LONG];
  await mockOpen(page, samples);
  const points = page.locator('#answers .answer');

  // 一開始只有提示和「看參考答案」：沒有選項、沒有送出，「不會」照常可以按；中文題幹不給英文發音
  const first = await shownOpen(page, samples);
  await expect(page.locator('#q-topic')).toContainText('・非選');
  await expect(page.locator('#answers .open-hint')).toHaveText('先在草稿區或紙上寫出答案，再對照參考答案自己評分');
  await expect(page.locator('#answers .open-reveal')).toHaveText('看參考答案');
  await expect(points).toHaveCount(0);
  await expect(page.locator('#ms-send')).toBeHidden();
  await expect(page.locator('#skip')).toBeVisible();
  await expect(page.locator('#speak')).toBeHidden();
  await auditBoth(page, '非選擇題作答前');

  // 看參考答案：作答區換成參考答案和每個要點一顆按鈕，一個都沒勾也可以送出
  await page.locator('#answers .open-reveal').click();
  await expect(page.locator('#answers .open-ref-text')).toHaveText(first.answer);
  await expect(page.locator('#answers .open-ask')).toHaveText('你寫到了哪幾個要點？');
  await expect(page.locator('#answers .answer .answer-text')).toHaveText(first.points);
  await expect(page.locator('#ms-send')).toHaveText('送出自評');
  await expect(page.locator('#ms-send')).toBeEnabled();
  await expect(page.locator('#answer-status')).toContainText(`參考答案：${first.answer}`);
  // 勾第一個；第二個點兩次是取消
  await points.nth(0).click();
  await points.nth(1).click();
  await points.nth(1).click();
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(1);
  await auditBoth(page, '非選擇題自評');
  await page.locator('#ms-send').click();

  // 沒全寫到：算答錯，寫到的要點打圈；沒寫到的正是最該看的，不淡化、標「沒寫到」（螢幕閱讀器也念得到）。顯示解析；不問「猜的／不太確定」
  const n = first.points.length;
  await expect(page.locator('#ms-send')).toBeHidden();
  await expect(points.nth(0)).toHaveClass(/correct/);
  await expect(page.locator('#answers .answer.correct')).toHaveCount(1);
  await expect(page.locator('#answers .answer.dim')).toHaveCount(0);
  await expect(page.locator('#answers .answer.missed')).toHaveCount(n - 1);
  await expect(page.locator('#answers .answer.missed .miss-tag')).toHaveText(Array(n - 1).fill('沒寫到'));
  await expect(points.nth(0)).toHaveAccessibleName(/（寫到了）$/);
  await expect(points.nth(1)).toHaveAccessibleName(/（沒寫到）$/);
  expect(await points.nth(1).evaluate((b) => getComputedStyle(b).opacity)).toBe('1');
  await expect(page.locator('#answers .answer:disabled')).toHaveCount(n);
  await expect(page.locator('#answer-status')).toHaveText(`自評：寫到 1／${n} 個要點`);
  await expect(page.locator('#q-explain')).toContainText(first.explain);
  await expect(page.locator('#certain')).toBeHidden();
  await auditBoth(page, '非選擇題作答後');
  await page.locator('#next').click();

  // 下一題：回看上一題看得到當時的自評、參考答案與要點
  const second = await shownOpen(page, samples);
  expect(second).not.toBe(first);
  await expect(page.locator('#answers .open-reveal')).toBeVisible();
  await page.locator('#back').click();
  await expect(page.locator('#past-sheet')).toBeVisible();
  await expect(page.locator('#past-card .open-note')).toHaveText(`自評：寫到 1／${n} 個要點`);
  await expect(page.locator('#past-card .open-ref-text')).toHaveText(first.answer);
  await expect(page.locator('#past-card .open-point')).toHaveCount(n);
  await expect(page.locator('#past-card .open-point .open-got')).toHaveCount(1);
  await audit(page, '回看非選擇題');
  await page.locator('#past-back').click();
  await expect(page.locator('#past-sheet')).toBeHidden();

  // 每個要點都勾：算答對（10 題一輪答對會自己換題，這是最後一題，直接到結算）
  await page.locator('#answers .open-reveal').click();
  await expect(points).toHaveCount(second.points.length);
  for (let i = 0; i < second.points.length; i++) await points.nth(i).click();
  await page.locator('#ms-send').click();
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#r-big')).toHaveText('1 / 2');
  // 作答畫面停在答對那題：要點全部打圈，沒有出現「猜的／不太確定」
  await expect(page.locator('#answers .answer.correct')).toHaveCount(second.points.length);
  await expect(page.locator('#certain')).toHaveAttribute('hidden', '');

  // 結算：答錯那題列出自評、參考答案與評分要點
  await expect(page.locator('#r-list .r-item')).toHaveCount(1);
  await expect(page.locator('#r-list .r-mine')).toHaveText(`自評：寫到 1／${n} 個要點`);
  await expect(page.locator('#r-list .r-right')).toHaveText(`參考答案：${first.answer}`);
  await expect(page.locator('#r-list .open-point')).toHaveText(first.points);
  await auditBoth(page, '非選擇題結算');
});

test('非選擇題在小螢幕（360×640）：參考答案加四個要點放不下時作答區自己捲動，題目卡與送出按鈕都留在畫面裡', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 360, height: 640 });
  await mockOpen(page, [OPEN_LONG]);
  await page.locator('#answers .open-reveal').click();
  const points = page.locator('#answers .answer');
  await expect(points).toHaveCount(4);

  const layout = () =>
    page.evaluate(() => {
      const box = (sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
      };
      const play = document.querySelector('#play');
      const answers = document.querySelector('#answers');
      return {
        pageWidth: document.documentElement.scrollWidth,
        // 整個作答畫面不捲動：多出來的在作答區裡捲
        screenOverflow: play.scrollHeight - play.clientHeight,
        answersOverflow: answers.scrollHeight - answers.clientHeight,
        card: box('#card'),
        stem: box('#q-text'),
        answers: box('#answers'),
        ref: box('#answers .open-ref'),
        send: box('#ms-send'),
        next: box('#next'),
        explain: box('#q-explain'),
        cardOverflow: document.querySelector('#card').scrollHeight - document.querySelector('#card').clientHeight,
        widest: Math.max(...[...answers.children].map((c) => c.getBoundingClientRect().right)),
      };
    });

  const before = await layout();
  expect(before.pageWidth).toBeLessThanOrEqual(360);
  expect(before.screenOverflow).toBeLessThanOrEqual(1);
  expect(before.widest).toBeLessThanOrEqual(360);
  // 題幹看得到，題目卡沒有被擠扁：題目卡留住內容需要的高度（不用捲），放不下的是作答區在捲
  expect(before.card.height).toBeGreaterThanOrEqual(150);
  expect(before.stem.top).toBeGreaterThanOrEqual(before.card.top);
  expect(before.cardOverflow).toBeLessThanOrEqual(2);
  expect(before.answersOverflow).toBeGreaterThan(0);
  // 參考答案在題目卡下面（作答區的框往上多撐了一點留給對錯記號，所以看裡面的參考答案）、作答區在送出按鈕上面，送出按鈕在畫面裡
  expect(before.ref.top).toBeGreaterThanOrEqual(before.card.bottom);
  expect(before.answers.bottom).toBeLessThanOrEqual(before.send.top + 1);
  expect(before.send.bottom).toBeLessThanOrEqual(640);
  await audit(page, '非選擇題（360×640）');

  // 每個要點都按得到（放不下的捲進來再按），送出後算答對
  for (let i = 0; i < 4; i++) await points.nth(i).click();
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(4);
  await page.locator('#skip').click();
  // 按了「不會」：勾的不算，參考答案與要點還在、不能按，解析與「繼續」都在畫面裡
  await expect(page.locator('#answers .answer:disabled')).toHaveCount(4);
  await expect(page.locator('#answers .answer.correct')).toHaveCount(0);
  await expect(page.locator('#q-explain')).toBeVisible();
  const after = await layout();
  expect(after.pageWidth).toBeLessThanOrEqual(360);
  expect(after.screenOverflow).toBeLessThanOrEqual(1);
  expect(after.next.bottom).toBeLessThanOrEqual(640);
  expect(after.card.height).toBeGreaterThanOrEqual(150);
  await audit(page, '非選擇題看解答（360×640）');
});

test('非選擇題在一般手機（412×915）：看了參考答案後題目卡只占內容的高度，四個要點不用捲就全部看得到', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 412, height: 915 });
  // 參考答案和要點都接近長度上限的那一題
  await mockOpen(page, [OPEN_LONG]);
  await page.locator('#answers .open-reveal').click();
  const points = page.locator('#answers .answer');
  await expect(points).toHaveCount(4);

  const layout = () =>
    page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const answers = document.querySelector('#answers');
      const card = document.querySelector('#card');
      const list = [...answers.querySelectorAll('.answer')].map((b) => b.getBoundingClientRect());
      return {
        answersOverflow: answers.scrollHeight - answers.clientHeight,
        cardOverflow: card.scrollHeight - card.clientHeight,
        lastPointBottom: Math.max(...list.map((b) => b.bottom)),
        firstPointTop: Math.min(...list.map((b) => b.top)),
        refTop: r('#answers .open-ref').top,
        cardBottom: r('#card').bottom,
        sendTop: r('#ms-send').top,
        nextTop: r('#next').top,
        screenOverflow: document.querySelector('#play').scrollHeight - document.querySelector('#play').clientHeight,
      };
    });

  // 作答區不用捲：參考答案與四個要點都在送出按鈕上面，題目卡也沒被擠到要捲
  const revealed = await layout();
  expect(revealed.answersOverflow).toBeLessThanOrEqual(1);
  expect(revealed.cardOverflow).toBeLessThanOrEqual(2);
  expect(revealed.lastPointBottom).toBeLessThanOrEqual(revealed.sendTop);
  expect(revealed.refTop).toBeGreaterThanOrEqual(revealed.cardBottom);
  expect(revealed.screenOverflow).toBeLessThanOrEqual(1);
  await expect(page.locator('#card-more')).toBeHidden();
  await auditBoth(page, '非選擇題看參考答案（412×915）');

  // 只勾第一個就送出：沒寫到的三個標「沒寫到」、不淡化，標籤不占文字的寬度（要點不會多折一行）
  const before = await points.evaluateAll((list) => list.map((b) => Math.round(b.getBoundingClientRect().height)));
  await points.nth(0).click();
  await page.locator('#ms-send').click();
  await expect(page.locator('#q-explain')).toBeVisible();
  await expect(page.locator('#answers .answer.missed .miss-tag')).toHaveText(['沒寫到', '沒寫到', '沒寫到']);
  await expect(page.locator('#answers .answer.dim')).toHaveCount(0);
  const after = await points.evaluateAll((list) => list.map((b) => Math.round(b.getBoundingClientRect().height)));
  expect(after).toEqual(before);
  // 「沒寫到」在要點的框裡看得到（沒被作答區切掉）
  const tags = await page.locator('#answers .miss-tag').evaluateAll((list) => {
    const box = document.querySelector('#answers').getBoundingClientRect();
    return list.map((t) => {
      const r = t.getBoundingClientRect();
      return r.top >= box.top && r.right <= box.right && r.width > 0;
    });
  });
  expect(tags).toEqual([true, true, true]);
  await auditBoth(page, '非選擇題自評後（412×915）');
});

test('非選擇題的鍵盤操作：Enter 看參考答案、數字鍵勾要點、Enter 送出；還沒看就按 ? 是不會', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '鍵盤快捷鍵只看桌機');
  const samples = [OPEN_SHORT, OPEN_LONG];
  await mockOpen(page, samples);
  const points = page.locator('#answers .answer');
  const first = await shownOpen(page, samples);
  const n = first.points.length;

  // 還沒看參考答案：數字鍵沒有作用，Enter 才是看
  await page.keyboard.press('1');
  await expect(page.locator('#answers .open-reveal')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#answers .open-ref-text')).toHaveText(first.answer);
  // 「看參考答案」不見了，焦點接到第一個要點
  await expect(points.first()).toBeFocused();

  // 數字鍵勾要點（再按一次取消）；超過要點數的數字沒有作用
  await page.keyboard.press('1');
  await page.keyboard.press('2');
  await page.keyboard.press('2');
  await page.keyboard.press('9');
  await expect(points.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#answers .answer[aria-pressed="true"]')).toHaveCount(1);
  // Enter 送出自評（焦點停在要點上也是送出，不是再切換一次）
  await page.keyboard.press('Enter');
  await expect(page.locator('#answer-status')).toHaveText(`自評：寫到 1／${n} 個要點`);
  await expect(points.nth(0)).toHaveClass(/correct/);
  await expect(page.locator('#q-explain')).toBeVisible();

  // Enter 換下一題：焦點在「看參考答案」上，還沒看就按 ? 是不會
  await page.keyboard.press('Enter');
  const second = await shownOpen(page, samples);
  expect(second).not.toBe(first);
  await expect(page.locator('#answers .open-reveal')).toBeFocused();
  await page.keyboard.press('?');
  // 顯示參考答案與要點，都不勾、不能按；解析標「解答」
  await expect(page.locator('#answers .open-ref-text')).toHaveText(second.answer);
  await expect(page.locator('#answers .answer:disabled')).toHaveCount(second.points.length);
  await expect(page.locator('#answers .answer.correct')).toHaveCount(0);
  await expect(page.locator('#answers .answer.dim')).toHaveCount(0);
  await expect(page.locator('#q-explain b')).toContainText('解答');
  await expect(page.locator('#answer-status')).toHaveText(`參考答案：${second.answer}`);
  await page.keyboard.press('Enter');
  await expect(page.locator('#result')).toBeVisible();
  await expect(page.locator('#r-big')).toHaveText('0 / 2');
});
