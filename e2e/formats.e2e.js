// 題型：演算題的填答（像學測選填）、多選題
import { audit, expect, openHome, test } from './fixtures.js';

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
  await page.addInitScript(() => {
    if (!localStorage.getItem('gsat-quiz:v1')) localStorage.setItem('gsat-quiz:v1', JSON.stringify({ version: 1, settings: { subjects: ['physics'] } }));
  });
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
