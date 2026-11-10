import { describe, expect, it } from 'vitest';
import { checkFigure, figureHTML, figureText, fmt, scale } from '../src/figure.js';
import { questionPrompt } from '../src/prompt.js';
import { buildQueue } from '../src/srs.js';

const line = {
  type: 'line',
  title: '甲車的速度',
  x: { label: '時間 (s)' },
  y: { label: '速度 (m/s)' },
  series: [{ points: [[0, 0], [2, 8], [6, 8], [8, 0]] }],
};
const bar = {
  type: 'bar',
  x: { cats: ['甲', '乙', '丙'] },
  y: { label: '產量 (公噸)' },
  series: [{ name: '2000 年', values: [30, 45, 12] }, { name: '2020 年', values: [20, 60, 40] }],
};
const climate = {
  type: 'climate',
  temp: [16, 17, 19, 22, 25, 28, 29, 29, 27, 24, 21, 18],
  rain: [80, 140, 170, 160, 230, 320, 240, 310, 250, 120, 70, 70],
};
const table = { type: 'table', title: '三種金屬的性質', cols: ['金屬', '密度 (g/cm³)', '熔點 (°C)'], rows: [['甲', 2.7, 660], ['乙', 7.9, 1538], ['丙', '$\\mathrm{19.3}$', 1064]] };

describe('scale', () => {
  it('取整齊的範圍與刻度；資料不小於 0、最小值不到最大值一半時從 0 開始', () => {
    expect(scale([0, 8])).toMatchObject({ min: 0, max: 8, step: 2, ticks: [0, 2, 4, 6, 8] });
    expect(scale([3, 47]).ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(scale([62, 98])).toMatchObject({ min: 60, max: 100 });
    expect(scale([-3, 4]).ticks).toEqual([-4, -2, 0, 2, 4]);
    expect(scale([0.1, 0.52]).ticks).toEqual([0, 0.2, 0.4, 0.6]);
    expect(scale([0.1, 0.45]).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
  });

  it('可以自己指定 min、max、step；所有值都一樣時也畫得出來', () => {
    expect(scale([1, 9], { min: 0, max: 10, step: 5 }).ticks).toEqual([0, 5, 10]);
    expect(scale([5, 5]).ticks.length).toBeGreaterThan(1);
    expect(fmt(0.1 + 0.2)).toBe('0.3');
    expect(fmt(-2)).toBe('−2');
  });
});

describe('checkFigure', () => {
  it('五種圖都通過', () => {
    for (const f of [line, bar, climate, table, { ...line, type: 'scatter', series: [{ points: [[1, 2], [2, 3], [3, 5]] }] }]) expect(checkFigure(f)).toEqual([]);
    expect(checkFigure({ ...line, marks: [{ x: 2, y: 8, label: 'P' }] })).toEqual([]);
  });

  it('擋下格式錯誤', () => {
    const bad = (f, re) => expect(checkFigure(f).join('\n')).toMatch(re);
    bad(null, /必須是物件/);
    bad({ type: 'pie' }, /fig\.type/);
    bad({ ...line, extra: 1 }, /未知欄位/);
    bad({ ...line, x: { label: '$t$' } }, /不能用 LaTeX/);
    bad({ ...line, series: [{ points: [[0, 0], [0, 3]] }] }, /由小到大/);
    bad({ ...line, series: [{ points: [[0, 0]] }] }, /2–40 個點/);
    bad({ ...line, series: [{ points: [[0, 0], [1, 1]] }, { points: [[0, 1], [1, 2]] }] }, /要有 name/);
    bad({ ...line, y: { label: '速度', max: 5 } }, /畫不進去/);
    bad({ ...line, x: { label: '時間', step: 0.1 } }, /刻度有/);
    bad({ ...bar, series: [{ values: [1, 2] }] }, /一一對應/);
    bad({ ...bar, x: { cats: ['甲', '甲'] } }, /不可重複/);
    bad({ ...climate, rain: climate.rain.slice(1) }, /12 個月/);
    bad({ ...table, rows: [['甲', 1]] }, /2–7 列/);
    bad({ ...table, rows: [['甲', 1, 2], ['乙', 1]] }, /要有 3 格/);
    bad({ ...table, cols: ['這個欄位的標題實在是寫得太長了啊', '乙'] }, /每欄標題/);
  });
});

describe('figureHTML / figureText', () => {
  it('折線圖：SVG 帶文字敘述，資料點畫出來；曲線不畫點', () => {
    const html = figureHTML(line);
    expect(html).toContain('<figure class="fig">');
    expect(html).toContain('role="img"');
    expect(html).toContain('折線圖「甲車的速度」，橫軸：時間 (s)，縱軸：速度 (m/s)。(0, 0)、(2, 8)、(6, 8)、(8, 0)');
    expect(html.match(/<circle class="fig-dot/g)).toHaveLength(4);
    const curve = figureHTML({ ...line, series: [{ smooth: true, points: [[0, 0], [1, 1], [2, 4], [3, 9]] }] });
    expect(curve).not.toContain('fig-dot');
    expect(curve).toMatch(/d="M[\d. ]+C/);
  });

  it('長條圖與氣候圖有圖例；表格的儲存格交給 rich 處理（公式）、數字照原樣', () => {
    expect(figureHTML(bar)).toContain('<li>');
    expect(figureHTML(bar).match(/<rect class="fig-bar/g)).toHaveLength(6 + 2);
    expect(figureHTML(climate)).toContain('月降水量 (mm)');
    const html = figureHTML(table, (t) => `[${t}]`);
    expect(html).toContain('<th scope="col">[密度 (g/cm³)]</th>');
    expect(html).toContain('<td>[2.7]</td>');
    expect(html).toContain('[$\\mathrm{19.3}$]');
  });

  it('文字會跳脫，不會變成標籤', () => {
    const html = figureHTML({ ...bar, x: { cats: ['<b>', '乙', '丙'] } });
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('文字敘述寫出全部數據', () => {
    expect(figureText(bar)).toBe('長條圖，縱軸：產量 (公噸)。甲 2000 年 30、2020 年 20；乙 2000 年 45、2020 年 60；丙 2000 年 12、2020 年 40');
    expect(figureText(climate)).toMatch(/^氣候圖（1–12 月）：月均溫 16、17.*°C；月降水量 80、140.*mm$/);
    expect(figureText(table)).toContain('甲｜2.7｜660');
  });
});

describe('圖表題在其他地方', () => {
  const q = { id: 'physics-9001', subject: 'physics', topic: '牛頓運動定律', type: 'mc', q: '依圖，甲車在哪一段時間加速度為零？', choices: ['0–2 秒', '2–6 秒', '6–8 秒', '全程'], answer: 1, explain: '速度不變時加速度為零。', formula: false, level: 2, fig: line };

  it('複製給 AI 時附上圖的數據', () => {
    expect(questionPrompt(q)).toContain('（題目附的折線圖「甲車的速度」，橫軸：時間 (s)');
  });

  it('60 秒快閃不出圖表題，其他模式照出', () => {
    const opts = { subjects: ['physics'], size: 5, now: 1_700_000_000_000 };
    expect(buildQueue([q], {}, opts)).toHaveLength(1);
    expect(buildQueue([q], {}, { ...opts, quickOnly: true })).toHaveLength(0);
  });
});
